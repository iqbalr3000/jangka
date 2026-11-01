import type { CoverageLevel, InterviewState } from "@jangka/shared/assistant";
import type { Section } from "@jangka/shared/document";

const fromCompleteness: Record<Section["completeness"], CoverageLevel> = {
  complete: "covered",
  partial: "partial",
  empty: "missing",
};

/**
 * The interview's assessment, or before any chat, the sections' completeness. Display only: the
 * draft gate reads the stored assessment.
 */
export function coverageItems(
  state: InterviewState | null,
  sections: Pick<Section, "key" | "completeness">[],
): InterviewState["sections"] {
  return (
    state?.sections ??
    sections.map((s) => ({ key: s.key, coverage: fromCompleteness[s.completeness], note: "" }))
  );
}
