export const levels = ["none", "view", "edit"] as const;
export type Level = (typeof levels)[number];

export type CollectionNode = {
  id: string;
  parentId: string | null;
  personalOwnerId: string | null;
};
export type GrantRow = { collectionId: string | null; groupId: string; level: Level };

export type AccessReason =
  | { kind: "admin" }
  | { kind: "owner" }
  | { kind: "grant"; groupId: string; collectionId: string | null }
  | { kind: "none" };

export type Access = { level: Level; reason: AccessReason };

export type Check =
  | { action: "view" | "edit"; collectionId: string | null }
  | { action: "move_document"; from: string | null; to: string | null }
  | { action: "move_collection"; collectionId: string; to: string | null };

export type PermissionContext = {
  readonly userId: string;
  readonly isAdmin: boolean;
  readonly groupIds: readonly string[];
  readonly collections: ReadonlyMap<string, CollectionNode>;
  /** collectionId (`null` = root) → groupId → level, only for the user's groups. */
  readonly grants: ReadonlyMap<string | null, ReadonlyMap<string, Level>>;
};

const rank: Record<Level, number> = { none: 0, view: 1, edit: 2 };

export function createContext(input: {
  userId: string;
  isAdmin: boolean;
  /** Must include the implicit All Users group. */
  groupIds: string[];
  collections: CollectionNode[];
  grants: GrantRow[];
}): PermissionContext {
  const groupIds = [...new Set(input.groupIds)];
  const member = new Set(groupIds);
  const grants = new Map<string | null, Map<string, Level>>();
  for (const grant of input.grants) {
    if (!member.has(grant.groupId)) continue;
    let byGroup = grants.get(grant.collectionId);
    if (!byGroup) {
      byGroup = new Map();
      grants.set(grant.collectionId, byGroup);
    }
    byGroup.set(grant.groupId, grant.level);
  }
  return {
    userId: input.userId,
    isAdmin: input.isAdmin,
    groupIds,
    collections: new Map(input.collections.map((node) => [node.id, node])),
    grants,
  };
}

/** `[id, parent, …, top]`, or null when the id is unknown or the parent chain is broken. */
function ancestry(ctx: PermissionContext, collectionId: string): string[] | null {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | null = collectionId;
  while (current !== null) {
    const node = ctx.collections.get(current);
    if (!node || seen.has(current)) return null;
    seen.add(current);
    chain.push(current);
    current = node.parentId;
  }
  return chain;
}

function ownerOfChain(ctx: PermissionContext, chain: string[]): string | null {
  const top = chain.at(-1);
  return top === undefined ? null : (ctx.collections.get(top)?.personalOwnerId ?? null);
}

export function explainAccess(ctx: PermissionContext, collectionId: string | null): Access {
  const chain = collectionId === null ? [] : ancestry(ctx, collectionId);
  if (chain === null) return { level: "none", reason: { kind: "none" } };
  if (ctx.isAdmin) return { level: "edit", reason: { kind: "admin" } };

  const owner = ownerOfChain(ctx, chain);
  if (owner !== null) {
    return owner === ctx.userId
      ? { level: "edit", reason: { kind: "owner" } }
      : { level: "none", reason: { kind: "none" } };
  }

  let best: Access = { level: "none", reason: { kind: "none" } };
  for (const groupId of ctx.groupIds) {
    for (const id of [...chain, null]) {
      const level = ctx.grants.get(id)?.get(groupId);
      if (level === undefined) continue;
      if (rank[level] > rank[best.level]) {
        best = { level, reason: { kind: "grant", groupId, collectionId: id } };
      }
      break;
    }
  }
  return best;
}

export function resolveLevel(ctx: PermissionContext, collectionId: string | null): Level {
  return explainAccess(ctx, collectionId).level;
}

function atLeast(ctx: PermissionContext, collectionId: string | null, level: Level): boolean {
  return rank[resolveLevel(ctx, collectionId)] >= rank[level];
}

export function can(ctx: PermissionContext, check: Check): boolean {
  switch (check.action) {
    case "view":
    case "edit":
      return atLeast(ctx, check.collectionId, check.action);
    case "move_document":
      return atLeast(ctx, check.from, "edit") && atLeast(ctx, check.to, "edit");
    case "move_collection": {
      const node = ctx.collections.get(check.collectionId);
      if (!node) return false;
      if (check.to !== null && isSelfOrDescendant(ctx, check.collectionId, check.to)) return false;
      return (
        atLeast(ctx, check.collectionId, "edit") &&
        atLeast(ctx, node.parentId, "edit") &&
        atLeast(ctx, check.to, "edit")
      );
    }
  }
}

export function filterViewable<T extends { collectionId: string | null }>(
  ctx: PermissionContext,
  items: T[],
): T[] {
  return items.filter((item) => atLeast(ctx, item.collectionId, "view"));
}

/** Owner of the personal tree the collection belongs to; null for shared collections and root. */
export function personalOwnerOf(
  ctx: PermissionContext,
  collectionId: string | null,
): string | null {
  if (collectionId === null) return null;
  const chain = ancestry(ctx, collectionId);
  return chain === null ? null : ownerOfChain(ctx, chain);
}

export function isSelfOrDescendant(
  ctx: PermissionContext,
  ancestorId: string,
  collectionId: string | null,
): boolean {
  if (collectionId === null) return false;
  return ancestry(ctx, collectionId)?.includes(ancestorId) ?? false;
}
