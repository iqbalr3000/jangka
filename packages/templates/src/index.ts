import { z } from "zod";
import { brdV1 } from "./brd";
import { prdV1 } from "./prd";
import { prdV2 } from "./prd-v2";
import { requirementKinds } from "./requirements";
import { tsdV1 } from "./tsd";

export {
  NO_INVENTION,
  REQUIREMENT_PREFIX,
  type RequirementKind,
  requirementKinds,
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

/** Seeded on boot; a published version never changes (documents pin it). */
export const builtinTemplates: TemplateDefinition[] = [prdV1, prdV2, brdV1, tsdV1];
