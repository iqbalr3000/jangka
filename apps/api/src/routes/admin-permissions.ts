import { collectionGrants, type Database, groups, users } from "@jangka/db";
import { personalOwnerOf } from "@jangka/permissions";
import {
  type AccessCheck,
  accessCheckQuery,
  type PermissionGraph,
  permissionChanges,
} from "@jangka/shared/access";
import { AppError } from "@jangka/shared/errors";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/session";
import { zValidate } from "../lib/validate";
import { type AccessData, accessView, isHidden, loadAccess, memberships } from "../services/access";
import type { AppEnv, RouteDeps } from "../types";
import { listGroups } from "./admin-groups";

/** Collections that take grants: not personal, not hidden by archive. */
function sharedCollections(data: AccessData) {
  return [...data.rows.values()]
    .filter((row) => personalOwnerOf(data.ctx, row.id) === null && !isHidden(data, row.id))
    .map((row) => ({ id: row.id, name: row.name, parentId: row.parentId }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function graph(db: Database): Promise<PermissionGraph> {
  // Subject is irrelevant here: only the tree is used.
  const data = await loadAccess(db, { userId: "", isAdmin: true, groupIds: [] });
  const groupList = await listGroups(db);
  const admins = new Set(groupList.filter((g) => g.systemKey === "admins").map((g) => g.id));
  const collections = sharedCollections(data);
  const listed = new Set(collections.map((c) => c.id));
  const grants = await db
    .select({
      collectionId: collectionGrants.collectionId,
      groupId: collectionGrants.groupId,
      level: collectionGrants.level,
    })
    .from(collectionGrants);
  return {
    groups: groupList,
    collections,
    grants: grants.filter(
      (g) => !admins.has(g.groupId) && (g.collectionId === null || listed.has(g.collectionId)),
    ),
  };
}

export function adminPermissionRoutes({ db }: RouteDeps) {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    requireAdmin(c);
    await next();
  });

  return app
    .get("/", async (c) => c.json(await graph(db)))
    .put("/", zValidate("json", permissionChanges), async (c) => {
      const { changes } = c.req.valid("json");
      const data = await loadAccess(db, { userId: "", isAdmin: true, groupIds: [] });
      const groupRows = await db.select().from(groups);
      const groupById = new Map(groupRows.map((g) => [g.id, g]));

      for (const change of changes) {
        const group = groupById.get(change.groupId);
        if (!group) throw new AppError("not_found", 404, "Group not found");
        if (group.systemKey === "admins") {
          throw new AppError("validation_failed", 400, "Administrators always have edit access");
        }
        if (change.collectionId !== null) {
          if (!data.rows.has(change.collectionId)) {
            throw new AppError("not_found", 404, "Collection not found");
          }
          if (personalOwnerOf(data.ctx, change.collectionId) !== null) {
            throw new AppError(
              "validation_failed",
              400,
              "Personal collections can't be shared with groups",
            );
          }
        }
      }

      await db.transaction(async (tx) => {
        for (const { collectionId, groupId, level } of changes) {
          if (level === null) {
            await tx
              .delete(collectionGrants)
              .where(
                and(
                  collectionId === null
                    ? isNull(collectionGrants.collectionId)
                    : eq(collectionGrants.collectionId, collectionId),
                  eq(collectionGrants.groupId, groupId),
                ),
              );
          } else {
            await tx
              .insert(collectionGrants)
              .values({ collectionId, groupId, level })
              .onConflictDoUpdate({
                target: [collectionGrants.collectionId, collectionGrants.groupId],
                set: { level, updatedAt: sql`now()` },
              });
          }
        }
      });

      await audit(c, {
        action: "permissions.update",
        targetType: "permissions",
        targetId: null,
        metadata: { changes },
      });
      return c.json(await graph(db));
    })
    .get("/check", zValidate("query", accessCheckQuery), async (c) => {
      const { userId } = c.req.valid("query");
      const [user] = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, userId));
      if (!user) throw new AppError("not_found", 404, "User not found");

      const { groupIds, isAdmin } = await memberships(db, userId);
      const data = await loadAccess(db, { userId, isAdmin, groupIds });
      const result: AccessCheck = {
        user: { ...user, isAdmin },
        root: accessView(data, null),
        collections: sharedCollections(data).map((row) => ({
          ...row,
          ...accessView(data, row.id),
        })),
      };
      return c.json(result);
    });
}
