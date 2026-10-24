import { collectionGrants, collections, type Database, documents } from "@jangka/db";
import { can, isSelfOrDescendant, personalOwnerOf, resolveLevel } from "@jangka/permissions";
import {
  type CollectionDetail,
  createCollectionRequest,
  updateCollectionRequest,
} from "@jangka/shared/access";
import { AppError } from "@jangka/shared/errors";
import { desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "../lib/audit";
import { requireAuth } from "../lib/session";
import { zValidate } from "../lib/validate";
import {
  type AccessData,
  accessView,
  type CollectionRow,
  isHidden,
  loadAccess,
  requireEdit,
  resolveDocLevel,
  subtreeIds,
  summary,
  viewableRow,
  visibleTree,
} from "../services/access";
import { documentsIn, summaries } from "../services/documents";
import type { AppEnv, RouteDeps } from "../types";

const idParam = z.object({ id: z.uuid() });
const itemsParam = z.object({ id: z.union([z.literal("root"), z.uuid()]) });

async function detail(
  db: Database,
  data: AccessData,
  row: CollectionRow | null,
): Promise<CollectionDetail> {
  if (row === null) {
    const rootViewable = resolveLevel(data.ctx, null) !== "none";
    return {
      collection: null,
      archivedAt: null,
      inPersonalTree: false,
      breadcrumbs: [],
      access: accessView(data, null),
      children: visibleTree(data).filter(
        (item) => item.parentId === null && item.personalOwnerId === null,
      ),
      documents: rootViewable ? await documentsIn(db, null) : [],
    };
  }

  // Nearest viewable ancestors only: stops at the first one the viewer can't see.
  const breadcrumbs: { id: string; name: string }[] = [];
  for (let parentId = row.parentId; parentId !== null; ) {
    const parent = data.rows.get(parentId);
    if (!parent || resolveLevel(data.ctx, parent.id) === "none") break;
    breadcrumbs.unshift({ id: parent.id, name: parent.name });
    parentId = parent.parentId;
  }

  const children = [...data.rows.values()]
    .filter(
      (child) =>
        child.parentId === row.id &&
        !child.archivedAt &&
        resolveLevel(data.ctx, child.id) !== "none",
    )
    .map((child) => summary(data, child))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    collection: summary(data, row),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    inPersonalTree: personalOwnerOf(data.ctx, row.id) !== null,
    breadcrumbs,
    access: accessView(data, row.id),
    children,
    documents: await documentsIn(db, row.id),
  };
}

function assertUsableParent(data: AccessData, parentId: string | null): void {
  if (parentId === null) return;
  viewableRow(data, parentId);
  if (isHidden(data, parentId)) {
    throw new AppError("conflict", 409, "The destination collection is archived");
  }
}

function assertNotPersonalRoot(row: CollectionRow): void {
  if (row.personalOwnerId !== null) {
    throw new AppError("conflict", 409, "Personal collections can't be renamed, moved or archived");
  }
}

export function collectionRoutes({ db }: RouteDeps) {
  const access = (c: Context<AppEnv>) => {
    const auth = requireAuth(c);
    return loadAccess(db, {
      userId: auth.user.id,
      isAdmin: auth.user.isAdmin,
      groupIds: auth.groupIds,
    });
  };

  return new Hono<AppEnv>()
    .get("/", async (c) => {
      const data = await access(c);
      return c.json({ rootLevel: resolveLevel(data.ctx, null), items: visibleTree(data) });
    })
    .get("/personal", async (c) => {
      const data = await access(c);
      const row = [...data.rows.values()].find((r) => r.personalOwnerId === data.ctx.userId);
      if (!row) throw new AppError("not_found", 404, "Personal collection not found");
      return c.json(await detail(db, data, row));
    })
    .get("/archived", async (c) => {
      const data = await access(c);
      const items = [...data.rows.values()]
        .filter((row) => {
          if (!row.archivedAt || resolveLevel(data.ctx, row.id) !== "edit") return false;
          const owner = personalOwnerOf(data.ctx, row.id);
          return owner === null || owner === data.ctx.userId;
        })
        .map((row) => ({ ...summary(data, row), archivedAt: row.archivedAt?.toISOString() ?? "" }))
        .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
      const archivedDocs = await db
        .select()
        .from(documents)
        .where(isNotNull(documents.archivedAt))
        .orderBy(desc(documents.archivedAt));
      const editable = archivedDocs.filter((doc) => {
        if (resolveDocLevel(data, doc) !== "edit") return false;
        const owner = personalOwnerOf(data.ctx, doc.collectionId);
        return owner === null || owner === data.ctx.userId;
      });
      return c.json({ items, documents: await summaries(db, editable) });
    })
    .get("/:id/items", zValidate("param", itemsParam), async (c) => {
      const { id } = c.req.valid("param");
      const data = await access(c);
      if (id === "root") return c.json(await detail(db, data, null));
      return c.json(await detail(db, data, viewableRow(data, id)));
    })
    .post("/", zValidate("json", createCollectionRequest), async (c) => {
      const { name, parentId } = c.req.valid("json");
      const data = await access(c);
      assertUsableParent(data, parentId);
      requireEdit(data, parentId);

      const [row] = await db.insert(collections).values({ name, parentId }).returning();
      if (!row) throw new Error("collection not created");
      await audit(c, { action: "collection.create", targetType: "collection", targetId: row.id });
      const after = await access(c);
      return c.json(summary(after, row), 201);
    })
    .patch(
      "/:id",
      zValidate("param", idParam),
      zValidate("json", updateCollectionRequest),
      async (c) => {
        const { id } = c.req.valid("param");
        const { name, parentId } = c.req.valid("json");
        const data = await access(c);
        const row = viewableRow(data, id);
        assertNotPersonalRoot(row);
        requireEdit(data, id);

        const moving = parentId !== undefined && parentId !== row.parentId;
        if (moving) {
          assertUsableParent(data, parentId);
          if (parentId !== null && isSelfOrDescendant(data.ctx, id, parentId)) {
            throw new AppError("conflict", 409, "A collection can't be moved into itself");
          }
          if (!can(data.ctx, { action: "move_collection", collectionId: id, to: parentId })) {
            throw new AppError(
              "forbidden",
              403,
              "You need edit access to both the current and the destination collection",
            );
          }
        }

        await db.transaction(async (tx) => {
          await tx
            .update(collections)
            .set({ ...(name !== undefined && { name }), ...(moving && { parentId }) })
            .where(eq(collections.id, id));
          // Personal trees ignore grants, so moving into one makes the subtree private.
          const intoPersonal =
            moving &&
            personalOwnerOf(data.ctx, parentId ?? null) !== null &&
            personalOwnerOf(data.ctx, id) === null;
          if (intoPersonal) {
            await tx
              .delete(collectionGrants)
              .where(inArray(collectionGrants.collectionId, subtreeIds(data, id)));
          }
        });

        await audit(c, {
          action: moving ? "collection.move" : "collection.rename",
          targetType: "collection",
          targetId: id,
          metadata: moving ? { from: row.parentId, to: parentId } : undefined,
        });
        const after = await access(c);
        return c.json(summary(after, viewableRow(after, id)));
      },
    )
    .post("/:id/archive", zValidate("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const data = await access(c);
      const row = viewableRow(data, id);
      assertNotPersonalRoot(row);
      requireEdit(data, id);
      if (!row.archivedAt) {
        await db.update(collections).set({ archivedAt: new Date() }).where(eq(collections.id, id));
        await audit(c, { action: "collection.archive", targetType: "collection", targetId: id });
      }
      return c.body(null, 204);
    })
    .post("/:id/restore", zValidate("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const data = await access(c);
      const row = viewableRow(data, id);
      requireEdit(data, id);
      if (row.parentId !== null && isHidden(data, row.parentId)) {
        throw new AppError("conflict", 409, "Restore the parent collection first");
      }
      if (row.archivedAt) {
        await db.update(collections).set({ archivedAt: null }).where(eq(collections.id, id));
        await audit(c, { action: "collection.restore", targetType: "collection", targetId: id });
      }
      return c.body(null, 204);
    });
}
