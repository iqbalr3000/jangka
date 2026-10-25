import { type Database, instanceSettings, type Transaction, templates } from "@jangka/db";
import { AppError } from "@jangka/shared/errors";
import { builtinTemplates, type TemplateDefinition, templateDefinition } from "@jangka/templates";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";

type Db = Database | Transaction;
export type TemplateRow = typeof templates.$inferSelect;

/** Idempotent: inserts built-in versions not yet present; existing rows are never changed. */
export async function ensureBuiltinTemplates(db: Db): Promise<void> {
  for (const definition of builtinTemplates) {
    await db
      .insert(templates)
      .values({
        docType: definition.docType,
        name: definition.name,
        version: definition.version,
        definition,
        isBuiltin: true,
        publishedAt: new Date(),
      })
      .onConflictDoNothing();
  }
}

/** Stored definitions are trusted rows, but still parsed so a corrupt row fails loudly. */
export function definitionOf(row: TemplateRow): TemplateDefinition {
  return templateDefinition.parse(row.definition);
}

export async function latestBuiltin(db: Db, docType: TemplateRow["docType"]): Promise<TemplateRow> {
  const [row] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.docType, docType), eq(templates.isBuiltin, true)))
    .orderBy(desc(templates.version))
    .limit(1);
  if (!row) throw new Error(`built-in ${docType} template missing (seeded on boot)`);
  return row;
}

export type DocType = TemplateRow["docType"];

const defaultTemplatesSchema = z.object({
  brd: z.string().optional(),
  prd: z.string().optional(),
  tsd: z.string().optional(),
});
export type DefaultTemplates = z.infer<typeof defaultTemplatesSchema>;

/** Doc type → family name chosen by an admin (unset = the built-in). */
export async function defaultTemplates(db: Db): Promise<DefaultTemplates> {
  const [row] = await db
    .select({ value: instanceSettings.defaultTemplates })
    .from(instanceSettings);
  const parsed = defaultTemplatesSchema.safeParse(row?.value ?? {});
  return parsed.success ? parsed.data : {};
}

/** The newest published version of a non-archived family. */
export async function latestPublished(
  db: Db,
  docType: DocType,
  name: string,
): Promise<TemplateRow | undefined> {
  const [row] = await db
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.docType, docType),
        eq(templates.name, name),
        isNotNull(templates.publishedAt),
        isNull(templates.archivedAt),
      ),
    )
    .orderBy(desc(templates.version))
    .limit(1);
  return row;
}

/**
 * The template a new document uses: the requested one (published, not archived, same type), or
 * the type's default family, or the latest built-in.
 */
export async function templateForNewDocument(
  db: Db,
  docType: DocType,
  templateId: string | undefined,
): Promise<TemplateRow> {
  if (templateId) {
    const [row] = await db.select().from(templates).where(eq(templates.id, templateId));
    if (!row || row.docType !== docType || !row.publishedAt || row.archivedAt) {
      throw new AppError(
        "invalid_template",
        400,
        `Pick a published ${docType.toUpperCase()} template`,
      );
    }
    return row;
  }
  const name = (await defaultTemplates(db))[docType];
  return (
    (name ? await latestPublished(db, docType, name) : undefined) ?? latestBuiltin(db, docType)
  );
}
