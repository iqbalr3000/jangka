import { type Database, documentSections, documents, templates } from "@jangka/db";
import type { ChatReference } from "@jangka/shared/assistant";
import { retiredSectionTitle } from "@jangka/templates";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { AccessData } from "./access";
import { definitionOf } from "./templates";
import { viewableScope } from "./visibility";

const MAX_TERMS = 12;
const MIN_TERM_LENGTH = 3;
const CLIP_CHARS = 1_500;

export type RetrievedSection = ChatReference & { markdown: string };

/**
 * Significant words of a message for an OR full-text query. Letters and digits only, so the
 * terms can't carry tsquery operators.
 */
export function searchTerms(message: string): string[] {
  const words = message.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((w) => w.length >= MIN_TERM_LENGTH))].slice(0, MAX_TERMS);
}

/** Up to `limit` sections of other viewable, non-archived documents matching the message. */
export async function retrieveSections(
  db: Database,
  data: AccessData,
  input: { query: string; excludeDocumentIds: string[]; limit?: number },
): Promise<RetrievedSection[]> {
  const terms = searchTerms(input.query);
  const scope = viewableScope(data);
  if (terms.length === 0 || !scope) return [];
  const tsquery = sql`to_tsquery('simple', ${terms.join(" | ")})`;

  const rows = await db
    .select({
      documentId: documents.id,
      title: documents.title,
      docType: documents.docType,
      templateId: documents.templateId,
      sectionKey: documentSections.sectionKey,
      markdown: documentSections.contentMd,
    })
    .from(documentSections)
    .innerJoin(documents, eq(documents.id, documentSections.documentId))
    .where(
      and(
        sql`${documentSections.search} @@ ${tsquery}`,
        isNull(documents.archivedAt),
        scope,
        input.excludeDocumentIds.length > 0
          ? notInArray(documents.id, input.excludeDocumentIds)
          : undefined,
      ),
    )
    .orderBy(sql`ts_rank(${documentSections.search}, ${tsquery}) desc`)
    .limit(input.limit ?? 3);
  if (rows.length === 0) return [];

  const templateRows = await db
    .select()
    .from(templates)
    .where(inArray(templates.id, [...new Set(rows.map((r) => r.templateId))]));
  const titles = new Map(
    templateRows.flatMap((t) =>
      definitionOf(t).sections.map((s) => [`${t.id}:${s.key}`, s.title] as const),
    ),
  );
  return rows.map((row) => ({
    documentId: row.documentId,
    title: row.title,
    docType: row.docType,
    sectionKey: row.sectionKey,
    sectionTitle:
      titles.get(`${row.templateId}:${row.sectionKey}`) ?? retiredSectionTitle(row.sectionKey),
    markdown:
      row.markdown.length > CLIP_CHARS
        ? `${row.markdown.slice(0, CLIP_CHARS)}… (truncated)`
        : row.markdown,
  }));
}
