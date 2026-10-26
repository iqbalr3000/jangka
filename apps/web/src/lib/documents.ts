import {
  type Completeness,
  documentDetail,
  documentList,
  type Section,
} from "@jangka/shared/document";
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { versionsKey } from "./history";
import { traceKey } from "./trace";

export const documentsKey = ["documents"] as const;

export const documentQuery = (id: string) =>
  queryOptions({
    queryKey: [...documentsKey, id],
    queryFn: () => apiFetch(`/documents/${id}`, { schema: documentDetail }),
  });

/** Viewable, non-archived documents of one type (source document picker). */
export const documentsOfTypeQuery = (docType: "brd" | "prd" | "tsd") =>
  queryOptions({
    queryKey: [...documentsKey, "of-type", docType],
    queryFn: () => apiFetch(`/documents?docType=${docType}&limit=200`, { schema: documentList }),
  });

export const completenessLabels: Record<Completeness, string> = {
  empty: "Empty",
  partial: "Partial",
  complete: "Complete",
};

/** "7 of 12 complete · 2 partial" */
export function completenessSummary(sections: Pick<Section, "completeness">[]): string {
  const complete = sections.filter((s) => s.completeness === "complete").length;
  const partial = sections.filter((s) => s.completeness === "partial").length;
  return `${complete} of ${sections.length} complete${partial ? ` · ${partial} partial` : ""}`;
}

export const sectionAnchor = (key: string) => `section-${key}`;

/** Keeps outline/completeness live after a section save, without re-seeding open editors. */
export function applySavedSection(queryClient: QueryClient, documentId: string, saved: Section) {
  // Requirement tables are indexed on save, and a save may add a version.
  void queryClient.invalidateQueries({ queryKey: traceKey(documentId) });
  void queryClient.invalidateQueries({ queryKey: versionsKey(documentId, saved.key) });
  queryClient.setQueryData(documentQuery(documentId).queryKey, (current) =>
    current
      ? { ...current, sections: current.sections.map((s) => (s.key === saved.key ? saved : s)) }
      : current,
  );
}
