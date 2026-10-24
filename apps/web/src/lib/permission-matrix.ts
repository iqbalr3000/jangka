import { createContext, explainAccess, type PermissionContext } from "@jangka/permissions";
import type { Grant, Level, PermissionChange, PermissionGraph } from "@jangka/shared/access";
import { ROOT_NAME, subtreeIds } from "./collections";

/** Staged cell edits keyed by `cellKey`; `level: null` = reset to inherit. */
export type StagedChanges = ReadonlyMap<string, PermissionChange>;

export const cellKey = (collectionId: string | null, groupId: string) =>
  `${collectionId ?? "root"}|${groupId}`;

export type CellState = {
  explicit: Level | null;
  effective: Level;
  /** Where the effective level comes from (null = root). */
  sourceId: string | null;
  /** What "Inherit" would give this cell. */
  inherited: Level;
  inheritedFromId: string | null;
  staged: boolean;
};

export function mergeGrants(grants: Grant[], staged: StagedChanges): Grant[] {
  const merged = new Map(grants.map((g) => [cellKey(g.collectionId, g.groupId), g]));
  for (const [key, change] of staged) {
    if (change.level === null) merged.delete(key);
    else
      merged.set(key, {
        collectionId: change.collectionId,
        groupId: change.groupId,
        level: change.level,
      });
  }
  return [...merged.values()];
}

/** One resolver per group, as if a user were only in that group. */
export function groupContexts(
  graph: PermissionGraph,
  grants: Grant[],
): Map<string, PermissionContext> {
  const collections = graph.collections.map((c) => ({ ...c, personalOwnerId: null }));
  return new Map(
    graph.groups.map((group) => [
      group.id,
      createContext({ userId: "", isAdmin: false, groupIds: [group.id], collections, grants }),
    ]),
  );
}

export function cellState(
  graph: PermissionGraph,
  contexts: Map<string, PermissionContext>,
  grants: Grant[],
  staged: StagedChanges,
  collectionId: string | null,
  groupId: string,
): CellState {
  const ctx = contexts.get(groupId);
  const explicit =
    grants.find((g) => g.collectionId === collectionId && g.groupId === groupId)?.level ?? null;
  const resolve = (id: string | null) => {
    if (!ctx) return { level: "none" as Level, sourceId: null };
    const { level, reason } = explainAccess(ctx, id);
    return { level, sourceId: reason.kind === "grant" ? reason.collectionId : null };
  };
  const own = resolve(collectionId);
  const parentId =
    collectionId === null
      ? undefined
      : (graph.collections.find((c) => c.id === collectionId)?.parentId ?? null);
  const parent =
    parentId === undefined ? { level: "none" as Level, sourceId: null } : resolve(parentId);
  return {
    explicit,
    effective: own.level,
    sourceId: own.sourceId,
    inherited: parent.level,
    inheritedFromId: parent.sourceId,
    staged: staged.has(cellKey(collectionId, groupId)),
  };
}

export function collectionName(graph: PermissionGraph, id: string | null): string {
  return id === null ? ROOT_NAME : (graph.collections.find((c) => c.id === id)?.name ?? "");
}

const levelText: Record<Level, string> = { edit: "Edit", view: "View", none: "No access" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Engineering: No access → Edit on Platform · affects 2 sub-collections, 14 documents". */
export function describeChange(
  graph: PermissionGraph,
  before: Map<string, PermissionContext>,
  after: Map<string, PermissionContext>,
  change: PermissionChange,
): string {
  const group = graph.groups.find((g) => g.id === change.groupId)?.name ?? "";
  const from = levelFor(before, change.groupId, change.collectionId);
  const to = levelFor(after, change.groupId, change.collectionId);
  const subtree =
    change.collectionId === null
      ? new Set(graph.collections.map((c) => c.id))
      : subtreeIds(graph.collections, change.collectionId);
  const descendants = change.collectionId === null ? subtree.size : subtree.size - 1;
  const documents =
    graph.collections
      .filter((c) => subtree.has(c.id))
      .reduce((sum, c) => sum + c.documentCount, 0) +
    (change.collectionId === null ? graph.rootDocumentCount : 0);
  const where = collectionName(graph, change.collectionId);
  const reset = change.level === null ? " (inherit)" : "";
  const parts = [
    ...(descendants > 0 ? [plural(descendants, "sub-collection")] : []),
    ...(documents > 0 ? [plural(documents, "document")] : []),
  ];
  const affects = parts.length > 0 ? ` · affects ${parts.join(", ")}` : "";
  return `${group}: ${levelText[from]} → ${levelText[to]}${reset} on ${where}${affects}`;
}

function levelFor(
  contexts: Map<string, PermissionContext>,
  groupId: string,
  collectionId: string | null,
): Level {
  const ctx = contexts.get(groupId);
  return ctx ? explainAccess(ctx, collectionId).level : "none";
}
