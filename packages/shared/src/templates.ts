import { templateDraftSection } from "@jangka/templates";
import { z } from "zod";
import { docTypeSchema } from "./document";

const templateName = z.string().trim().min(1, { error: "Required" }).max(100);

export const templateVersionView = z.object({
  id: z.string(),
  version: z.number(),
  published: z.boolean(),
  publishedAt: z.string().nullable(),
  documentCount: z.number(),
  sectionCount: z.number(),
});

/** One (doc type, name) family with its versions, newest first. */
export const templateFamily = z.object({
  docType: docTypeSchema,
  name: z.string(),
  isBuiltin: z.boolean(),
  archived: z.boolean(),
  isDefault: z.boolean(),
  versions: z.array(templateVersionView),
  /** The family's draft, if any (also listed in `versions`). */
  draftId: z.string().nullable(),
});
export type TemplateFamily = z.infer<typeof templateFamily>;
export const templateFamilyList = z.object({ items: z.array(templateFamily) });

export const templateDetail = z.object({
  id: z.string(),
  docType: docTypeSchema,
  name: z.string(),
  version: z.number(),
  published: z.boolean(),
  isBuiltin: z.boolean(),
  /** Whether the family has a published version (then its name is fixed). */
  familyPublished: z.boolean(),
  /** Published versions always have guidance; drafts may not yet. */
  sections: z.array(templateDraftSection),
});
export type TemplateDetail = z.infer<typeof templateDetail>;

/** Sections without a key are new: the server derives one from the title. */
export const draftSection = templateDraftSection.extend({
  key: templateDraftSection.shape.key.optional(),
});
export type DraftSection = z.infer<typeof draftSection>;

export const saveTemplateDraftRequest = z.object({
  name: templateName.optional(),
  sections: z.array(draftSection).max(60),
});

export const duplicateTemplateRequest = z.object({ name: templateName });

/** No `sourceId` = blank draft; otherwise a copy of that published version. */
export const createTemplateRequest = z.object({
  docType: docTypeSchema,
  name: templateName,
  sourceId: z.uuid().optional(),
});

export const setDefaultTemplateRequest = z.object({
  docType: docTypeSchema,
  /** Family name; null = back to the built-in. */
  name: templateName.nullable(),
});
