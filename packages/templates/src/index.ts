import { z } from "zod";
import { brdV1 } from "./brd";
import { prdV1 } from "./prd";
import { prdV2 } from "./prd-v2";
import { REQUIREMENT_KINDS_BY_TYPE, requirementKinds } from "./requirements";
import { tsdV1 } from "./tsd";

export {
  NO_INVENTION,
  REQUIREMENT_KINDS_BY_TYPE,
  REQUIREMENT_PREFIX,
  type RequirementKind,
  requirementKinds,
  requirementTableRule,
  UPSTREAM_DOC_TYPE,
} from "./requirements";

export const docType = z.enum(["brd", "prd", "tsd"]);
export type DocType = z.infer<typeof docType>;

export const templateSection = z.object({
  /** Stable forever: documents and requirements reference sections by key. */
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  title: z.string().min(1),
  required: z.boolean(),
  /** Instructions to the LLM for drafting this section. */
  guidance: z.string().min(1),
  /** What the interview should ask the user about. */
  interviewHints: z.array(z.string().min(1)),
  requirementKind: z.enum(requirementKinds).optional(),
  expectsDiagram: z.enum(["flowchart", "sequence", "erd", "state"]).optional(),
});
export type TemplateSection = z.infer<typeof templateSection>;

export const templateDefinition = z
  .object({
    docType,
    name: z.string().min(1),
    version: z.number().int().min(1),
    sections: z.array(templateSection).min(1),
  })
  .refine((t) => new Set(t.sections.map((s) => s.key)).size === t.sections.length, {
    error: "Section keys must be unique",
  });
export type TemplateDefinition = z.infer<typeof templateDefinition>;

/**
 * Rules custom templates must follow (built-ins do too): at most one section per requirement
 * kind, and only the kinds the document type supports.
 */
export const customTemplateDefinition = templateDefinition.superRefine((template, ctx) => {
  const allowed: readonly string[] = REQUIREMENT_KINDS_BY_TYPE[template.docType];
  const seen = new Set<string>();
  template.sections.forEach((section, index) => {
    const kind = section.requirementKind;
    if (!kind) return;
    if (!allowed.includes(kind)) {
      ctx.addIssue({
        code: "custom",
        path: ["sections", index, "requirementKind"],
        message: `A ${template.docType.toUpperCase()} can't have ${kind.replace("_", "-")} requirements`,
      });
    } else if (seen.has(kind)) {
      ctx.addIssue({
        code: "custom",
        path: ["sections", index, "requirementKind"],
        message: "Only one section per requirement kind",
      });
    }
    seen.add(kind);
  });
});

/** A stable key from a title (`Risks & Mitigations` → `risks_mitigations`), suffixed on clashes. */
export function sectionKeyFor(title: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const slug =
    title
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "s_$1")
      .slice(0, 50) || "section";
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n++) {
    if (!taken.has(`${slug}_${n}`)) return `${slug}_${n}`;
  }
}

/** Seeded on boot; a published version never changes (documents pin it). */
export const builtinTemplates: TemplateDefinition[] = [prdV1, prdV2, brdV1, tsdV1];
