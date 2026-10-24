import { type Database, groupMembers, groups, type Transaction, users } from "@jangka/db";
import { addMemberRequest, type Group, groupNameRequest } from "@jangka/shared/access";
import { AppError } from "@jangka/shared/errors";
import { and, asc, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/session";
import { zValidate } from "../lib/validate";
import type { AppEnv, RouteDeps } from "../types";

type Db = Database | Transaction;
type GroupRow = typeof groups.$inferSelect;

const idParam = z.object({ id: z.uuid() });
const memberParam = z.object({ id: z.uuid(), userId: z.uuid() });
const systemOrder = { admins: 0, all_users: 1 } as const;

/** System groups first, then by name. All Users counts every active user. */
export async function listGroups(db: Db): Promise<Group[]> {
  const [rows, counts, [active]] = await Promise.all([
    db.select().from(groups),
    db
      .select({ groupId: groupMembers.groupId, members: count() })
      .from(groupMembers)
      .groupBy(groupMembers.groupId),
    db.select({ members: count() }).from(users).where(eq(users.isActive, true)),
  ]);
  const byGroup = new Map(counts.map((row) => [row.groupId, row.members]));
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      systemKey: row.systemKey,
      memberCount:
        row.systemKey === "all_users" ? (active?.members ?? 0) : (byGroup.get(row.id) ?? 0),
    }))
    .sort((a, b) => {
      const rank = (group: Group) => (group.systemKey ? systemOrder[group.systemKey] : 2);
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
}

async function findGroup(db: Db, id: string): Promise<GroupRow> {
  const [row] = await db.select().from(groups).where(eq(groups.id, id));
  if (!row) throw new AppError("not_found", 404, "Group not found");
  return row;
}

function assertCustom(group: GroupRow): void {
  if (group.systemKey) {
    throw new AppError("conflict", 409, "System groups can't be renamed or deleted");
  }
}

async function assertNameFree(db: Db, name: string, exceptId?: string): Promise<void> {
  const [existing] = await db.select({ id: groups.id }).from(groups).where(eq(groups.name, name));
  if (existing && existing.id !== exceptId) {
    throw new AppError("conflict", 409, "A group with this name already exists");
  }
}

export function adminGroupRoutes({ db }: RouteDeps) {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    requireAdmin(c);
    await next();
  });

  return app
    .get("/", async (c) => c.json({ items: await listGroups(db) }))
    .post("/", zValidate("json", groupNameRequest), async (c) => {
      const { name } = c.req.valid("json");
      await assertNameFree(db, name);
      const [row] = await db
        .insert(groups)
        .values({ name })
        .onConflictDoNothing({ target: groups.name })
        .returning();
      if (!row) throw new AppError("conflict", 409, "A group with this name already exists");
      await audit(c, { action: "group.create", targetType: "group", targetId: row.id });
      const group: Group = { id: row.id, name: row.name, systemKey: null, memberCount: 0 };
      return c.json(group, 201);
    })
    .patch("/:id", zValidate("param", idParam), zValidate("json", groupNameRequest), async (c) => {
      const { id } = c.req.valid("param");
      const { name } = c.req.valid("json");
      assertCustom(await findGroup(db, id));
      await assertNameFree(db, name, id);
      await db.update(groups).set({ name }).where(eq(groups.id, id));
      await audit(c, { action: "group.rename", targetType: "group", targetId: id });
      return c.body(null, 204);
    })
    .delete("/:id", zValidate("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      assertCustom(await findGroup(db, id));
      await db.delete(groups).where(eq(groups.id, id));
      await audit(c, { action: "group.delete", targetType: "group", targetId: id });
      return c.body(null, 204);
    })
    .get("/:id/members", zValidate("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const row = await findGroup(db, id);
      const columns = { id: users.id, name: users.name, email: users.email };
      const implicit = row.systemKey === "all_users";
      const items = implicit
        ? await db
            .select(columns)
            .from(users)
            .where(eq(users.isActive, true))
            .orderBy(asc(users.name))
        : await db
            .select(columns)
            .from(groupMembers)
            .innerJoin(users, eq(users.id, groupMembers.userId))
            .where(eq(groupMembers.groupId, id))
            .orderBy(asc(users.name));
      const group = (await listGroups(db)).find((g) => g.id === id);
      return c.json({ group, implicit, items });
    })
    .post(
      "/:id/members",
      zValidate("param", idParam),
      zValidate("json", addMemberRequest),
      async (c) => {
        const { id } = c.req.valid("param");
        const { userId } = c.req.valid("json");
        const row = await findGroup(db, id);
        if (row.systemKey === "all_users") {
          throw new AppError("conflict", 409, "Everyone is in All Users automatically");
        }
        const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
        if (!user) throw new AppError("not_found", 404, "User not found");
        await db.insert(groupMembers).values({ groupId: id, userId }).onConflictDoNothing();
        await audit(c, {
          action: "group.add_member",
          targetType: "group",
          targetId: id,
          metadata: { userId },
        });
        return c.body(null, 204);
      },
    )
    .delete("/:id/members/:userId", zValidate("param", memberParam), async (c) => {
      const actor = requireAdmin(c);
      const { id, userId } = c.req.valid("param");
      const row = await findGroup(db, id);
      if (row.systemKey === "all_users") {
        throw new AppError("conflict", 409, "Everyone is in All Users automatically");
      }
      if (row.systemKey === "admins" && userId === actor.user.id) {
        throw new AppError("conflict", 409, "You can't remove yourself from Administrators");
      }
      await db
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, id), eq(groupMembers.userId, userId)));
      await audit(c, {
        action: "group.remove_member",
        targetType: "group",
        targetId: id,
        metadata: { userId },
      });
      return c.body(null, 204);
    });
}
