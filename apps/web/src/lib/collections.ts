import {
  type AccessView,
  archivedCollectionList,
  type CollectionSummary,
  collectionDetail,
  collectionList,
  type Level,
} from "@jangka/shared/access";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./api";

/** Prefix for every collection query; invalidate it after any collection or grant change. */
export const collectionsKey = ["collections"] as const;

export const collectionTreeQuery = queryOptions({
  queryKey: [...collectionsKey, "tree"],
  queryFn: () => apiFetch("/collections", { schema: collectionList }),
});

export const collectionItemsQuery = (id: string) =>
  queryOptions({
    queryKey: [...collectionsKey, "items", id],
    queryFn: () => apiFetch(`/collections/${id}/items`, { schema: collectionDetail }),
  });

export const personalCollectionQuery = queryOptions({
  queryKey: [...collectionsKey, "personal"],
  queryFn: () => apiFetch("/collections/personal", { schema: collectionDetail }),
});

export const archivedCollectionsQuery = queryOptions({
  queryKey: [...collectionsKey, "archived"],
  queryFn: () => apiFetch("/collections/archived", { schema: archivedCollectionList }),
});

export const ROOT_NAME = "Our documents";

export const levelLabels: Record<Level, string> = {
  edit: "Edit",
  view: "View",
  none: "No access",
};

export function collectionLabel(collection: CollectionSummary, userId: string): string {
  return collection.personalOwnerId === userId ? "Personal" : collection.name;
}

/** "Edit (via Engineering)" — why the viewer has their level. */
export function describeAccess({ level, reason }: AccessView): string {
  const label = levelLabels[level];
  switch (reason.kind) {
    case "admin":
      return `${label} (admin)`;
    case "owner":
      return `${label} (your personal collection)`;
    case "grant":
      return `${label} (via ${reason.groupName})`;
    case "none":
      return label;
  }
}

/** parentId → children, sorted by name; key `null` holds the top level. */
export function childrenByParent<T extends { id: string; parentId: string | null; name: string }>(
  items: readonly T[],
): Map<string | null, T[]> {
  const map = new Map<string | null, T[]>();
  for (const item of items) {
    const list = map.get(item.parentId) ?? [];
    list.push(item);
    map.set(item.parentId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return map;
}

/** Ids of `rootId` and all its descendants within `items`. */
export function subtreeIds(
  items: readonly { id: string; parentId: string | null }[],
  rootId: string,
): Set<string> {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items) {
      if (item.parentId !== null && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        grew = true;
      }
    }
  }
  return ids;
}
