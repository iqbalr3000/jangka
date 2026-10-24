import {
  collectionGrants,
  collections,
  type Database,
  documents,
  groupMembers,
  groups,
  type Transaction,
} from "@jangka/db";
import {
  createContext,
  explainAccess,
  type PermissionContext,
  personalOwnerOf,
  resolveLevel,
} from "@jangka/permissions";
import type { AccessView, CollectionSummary } from "@jangka/shared/access";
import { AppError } from "@jangka/shared/errors";
import { count, eq, isNull } from "drizzle-orm";

type Db = Database | Transaction;

export const ROOT_NAME = "Our documents";

export type CollectionRow = typeof collections.$inferSelect;
export type Subject = { userId: string; isAdmin: boolean; groupIds: string[] };

/** Everything a request needs to answer permission questions; all tables involved are small. */
export type AccessData = {
  ctx: PermissionContext;
  rows: Map<string, CollectionRow>;
  groupNames: Map<string, string>;
  /** Non-archived documents directly in each collection (`null` = root). */
  documentCounts: Map<string | null, number>;
};

export async function memberships(
  db: Db,
  userId: string,
): Promise<{ groupIds: string[]; isAdmin: boolean }> {
  const rows = await db
    .select({ groupId: groups.id, systemKey: groups.systemKey })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groupMembers.userId, userId));
  return {
    groupIds: rows.map((row) => row.groupId),
    isAdmin: rows.some((row) => row.systemKey === "admins"),
  };
}

export async function loadAccess(db: Db, subject: Subject): Promise<AccessData> {
  const [collectionRows, grantRows, groupRows, countRows] = await Promise.all([
    db.select().from(collections),
    db
      .select({
        collectionId: collectionGrants.collectionId,
        groupId: collectionGrants.groupId,
        level: collectionGrants.level,
      })
      .from(collectionGrants),
    db.select({ id: groups.id, name: groups.name, systemKey: groups.systemKey }).from(groups),
    db
      .select({ collectionId: documents.collectionId, documents: count() })
      .from(documents)
      .where(isNull(documents.archivedAt))
      .groupBy(documents.collectionId),
  ]);
  const allUsers = groupRows.find((group) => group.systemKey === "all_users");
  const ctx = createContext({
    userId: subject.userId,
    isAdmin: subject.isAdmin,
    groupIds: allUsers ? [...subject.groupIds, allUsers.id] : subject.groupIds,
    collections: collectionRows,
    grants: grantRows,
  });
  return {
    ctx,
    rows: new Map(collectionRows.map((row) => [row.id, row])),
    groupNames: new Map(groupRows.map((group) => [group.id, group.name])),
    documentCounts: new Map(countRows.map((row) => [row.collectionId, row.documents])),
  };
}

/** Archived itself or below an archived ancestor. */
export function isHidden(data: AccessData, id: string): boolean {
  let current: string | null = id;
  const seen = new Set<string>();
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const row = data.rows.get(current);
    if (!row) return true;
    if (row.archivedAt) return true;
    current = row.parentId;
  }
  return false;
}

/** Collection ids of `rootId` and everything below it. */
export function subtreeIds(data: AccessData, rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const row of data.rows.values()) {
    if (row.parentId === null) continue;
    const list = children.get(row.parentId) ?? [];
    list.push(row.id);
    children.set(row.parentId, list);
  }
  const ids: string[] = [];
  const queue = [rootId];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (ids.includes(next)) continue;
    ids.push(next);
    queue.push(...(children.get(next) ?? []));
  }
  return ids;
}

export function summary(data: AccessData, row: CollectionRow): CollectionSummary {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    personalOwnerId: row.personalOwnerId,
    level: resolveLevel(data.ctx, row.id),
    documentCount: data.documentCounts.get(row.id) ?? 0,
  };
}

/** Documents inherit their collection's level (no per-document ACL). */
export function resolveDocLevel(data: AccessData, row: { collectionId: string | null }) {
  return resolveLevel(data.ctx, row.collectionId);
}

export function accessView(data: AccessData, collectionId: string | null): AccessView {
  const { level, reason } = explainAccess(data.ctx, collectionId);
  if (reason.kind !== "grant") return { level, reason };
  return {
    level,
    reason: {
      ...reason,
      groupName: data.groupNames.get(reason.groupId) ?? "",
      collectionName:
        reason.collectionId === null ? ROOT_NAME : (data.rows.get(reason.collectionId)?.name ?? ""),
    },
  };
}

/**
 * Sidebar tree: viewable, not hidden by archive, without other users' personal trees.
 * A collection whose parent isn't listed is lifted to the top level so no parent name leaks.
 */
export function visibleTree(data: AccessData): CollectionSummary[] {
  const items = [...data.rows.values()]
    .filter((row) => {
      if (isHidden(data, row.id)) return false;
      const owner = personalOwnerOf(data.ctx, row.id);
      if (owner !== null && owner !== data.ctx.userId) return false;
      return resolveLevel(data.ctx, row.id) !== "none";
    })
    .map((row) => summary(data, row));
  const listed = new Set(items.map((item) => item.id));
  return items
    .map((item) => ({
      ...item,
      parentId: item.parentId !== null && listed.has(item.parentId) ? item.parentId : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The collection row when the subject can view it; 404 otherwise, so existence never leaks. */
export function viewableRow(data: AccessData, id: string): CollectionRow {
  const row = data.rows.get(id);
  if (!row || resolveLevel(data.ctx, id) === "none") {
    throw new AppError("not_found", 404, "Collection not found");
  }
  return row;
}

export function requireEdit(data: AccessData, collectionId: string | null): void {
  if (resolveLevel(data.ctx, collectionId) !== "edit") {
    throw new AppError("forbidden", 403, "You need edit access to do this");
  }
}

export async function createPersonalCollection(
  db: Db,
  user: { id: string; name: string },
): Promise<void> {
  await db
    .insert(collections)
    .values({ name: `${user.name}'s personal collection`, personalOwnerId: user.id });
}
