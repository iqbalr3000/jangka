import { type Database, type Transaction, templates } from "@jangka/db";
import { builtinTemplates, type TemplateDefinition, templateDefinition } from "@jangka/templates";
import { and, desc, eq } from "drizzle-orm";

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
