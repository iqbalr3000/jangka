import type { DocNode } from "@jangka/shared/document";

export type DiagramResult = { svg: string; png: Buffer } | { error: string };

export type ExportInput = {
  document: {
    title: string;
    docType: "brd" | "prd" | "tsd";
    status: "draft" | "in_review" | "approved";
    author: string | null;
    updatedAt: Date;
    orgName: string | null;
  };
  /** Template order. `empty` sections print as a placeholder, never omitted. */
  sections: { title: string; content: DocNode; empty: boolean }[];
  /** By `diagramHash(source)`; a missing entry prints like a failed render. */
  diagrams: Map<string, DiagramResult>;
  includeCover: boolean;
};

export const DOC_TYPE_LABEL = { brd: "BRD", prd: "PRD", tsd: "TSD" } as const;
export const STATUS_LABEL = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
} as const;
export const EMPTY_SECTION_TEXT = "Not yet specified.";
export const DIAGRAM_MISSING = "Diagram was not rendered";

/** Server-side, so a fixed locale and UTC: "25 Oct 2026". */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function figureCaption(n: number, sectionTitle: string): string {
  return `Figure ${n} — ${sectionTitle}`;
}
