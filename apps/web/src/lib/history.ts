import { sectionVersionList } from "@jangka/shared/document";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./api";

export const versionsKey = (documentId: string, key: string) =>
  ["documents", documentId, "versions", key] as const;

/** Newest first; the first page covers the recent history the panel shows. */
export const versionsQuery = (documentId: string, key: string) =>
  queryOptions({
    queryKey: versionsKey(documentId, key),
    queryFn: () =>
      apiFetch(`/documents/${documentId}/sections/${key}/versions?limit=100`, {
        schema: sectionVersionList,
      }),
  });
