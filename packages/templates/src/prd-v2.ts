import type { TemplateDefinition } from "./index";
import { prdV1 } from "./prd";
import { requirementTableGuidance } from "./requirements";

const guidance: Record<string, string> = {
  functional_requirements: requirementTableGuidance(
    "functional",
    "Requirements describing one testable behavior each, with acceptance criteria in the same cell where known.",
    "BR",
  ),
  non_functional_requirements: requirementTableGuidance(
    "non_functional",
    "Measurable quality requirements (performance, availability, security, privacy, accessibility, compliance) with numbers.",
    "BR",
  ),
};

/** v1 with requirement sections in the indexed table format. */
export const prdV2: TemplateDefinition = {
  ...prdV1,
  version: 2,
  sections: prdV1.sections.map((section) => {
    const next = guidance[section.key];
    return next ? { ...section, guidance: next } : section;
  }),
};
