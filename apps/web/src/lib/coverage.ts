import type { CoverageLevel, InterviewState } from "@jangka/shared/assistant";
import type { Section } from "@jangka/shared/document";

const fromCompleteness: Record<Section["completeness"], CoverageLevel> = {
  complete: "covered",
  partial: "partial",
  empty: "missing",
};

/**
 * The checklist rows: the interview's assessment, or before any chat, what the sections already
 * hold (an example or imported document is covered by its content). Display only: the draft
 * gate reads the stored assessment.
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
