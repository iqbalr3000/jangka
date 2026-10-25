export const requirementKinds = ["business", "functional", "non_functional", "technical"] as const;
export type RequirementKind = (typeof requirementKinds)[number];

export const REQUIREMENT_PREFIX: Record<RequirementKind, string> = {
  business: "BR",
  functional: "FR",
  non_functional: "NFR",
  technical: "TR",
};

/** The document type a document of this type may be generated from. */
export const UPSTREAM_DOC_TYPE = { brd: null, prd: "brd", tsd: "prd" } as const;

export const NO_INVENTION =
  "Use only information from the interview, the source document and existing sections; if something is unknown, leave it out rather than inventing it.";

/**
 * The table convention every requirement section follows; requirements are indexed from it on
 * save (ADR 0003), so the column names matter.
 */
export function requirementTableGuidance(
  kind: RequirementKind,
  what: string,
  upstream: string | null,
): string {
  const prefix = REQUIREMENT_PREFIX[kind];
  const columns = upstream
    ? "ID | Requirement | Priority | Upstream"
    : "ID | Requirement | Priority";
  return [
    `${what} Output a markdown table with the columns ${columns}, one requirement per row.`,
    `IDs are ${prefix}-001, ${prefix}-002, …; keep existing IDs unchanged and never reuse one.`,
    "Priority is Must, Should or Could.",
    upstream
      ? `Upstream lists the ${upstream} codes from the source document this requirement comes from, comma-separated; cite only codes in the source document's requirement list, and leave it empty when there is no source.`
      : "",
    NO_INVENTION,
  ]
    .filter(Boolean)
    .join(" ");
}
