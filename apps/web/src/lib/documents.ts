import { type Completeness, documentDetail, type Section } from "@jangka/shared/document";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./api";

export const documentsKey = ["documents"] as const;

export const documentQuery = (id: string) =>
  queryOptions({
    queryKey: [...documentsKey, id],
    queryFn: () => apiFetch(`/documents/${id}`, { schema: documentDetail }),
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
