import {
  type Database,
  documentSections,
  documents,
  sectionVersions,
  type Transaction,
  templates,
  users,
} from "@jangka/db";
import { toMarkdown } from "@jangka/export";
import { resolveLevel } from "@jangka/permissions";
import {
  type Completeness,
  type DocNode,
  type DocumentSummary,
  docContent,
  isBlankDoc,
  type LinkedDocument,
  type Section,
} from "@jangka/shared/document";
import { AppError } from "@jangka/shared/errors";
import { UPSTREAM_DOC_TYPE } from "@jangka/templates";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type AccessData, isHidden, resolveDocLevel } from "./access";
import { indexRequirements } from "./requirements";
import { definitionOf } from "./templates";

type Db = Database | Transaction;
export type DocumentRow = typeof documents.$inferSelect;
type SectionRow = typeof documentSections.$inferSelect;

/** A new editing session starts after this much idle time (or another author / an LLM write). */
export const VERSION_SESSION_MS = 10 * 60 * 1000;

export async function findDocument(db: Db, id: string): Promise<DocumentRow | undefined> {
  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  return row;
}

/** The document when the subject can view it; 404 otherwise, so existence never leaks. */
export async function viewableDocument(db: Db, data: AccessData, id: string): Promise<DocumentRow> {
  const row = await findDocument(db, id);
  if (!row || resolveDocLevel(data, row) === "none") {
    throw new AppError("not_found", 404, "Document not found");
  }
  return row;
}

export function requireDocEdit(data: AccessData, row: DocumentRow): void {
  if (resolveDocLevel(data, row) !== "edit") {
    throw new AppError("forbidden", 403, "You need edit access to do this");
  }
}

/** Collection a document may be created in / moved to: exists, viewable, not archived. */
export function assertUsableCollection(data: AccessData, collectionId: string | null): void {
  if (collectionId === null) return;
  const row = data.rows.get(collectionId);
  if (!row || resolveLevel(data.ctx, collectionId) === "none") {
    throw new AppError("not_found", 404, "Collection not found");
  }
  if (isHidden(data, collectionId)) {
    throw new AppError("conflict", 409, "The collection is archived");
  }
}

/** The document `row` was generated from, as the viewer may see it. */
export async function linkedSource(
  db: Db,
  data: AccessData,
  row: DocumentRow,
): Promise<LinkedDocument | null> {
  if (!row.sourceDocumentId) return null;
  const source = await findDocument(db, row.sourceDocumentId);
  if (!source || resolveDocLevel(data, source) === "none") return { restricted: true };
  return { id: source.id, title: source.title, docType: source.docType };
}

/**
 * A source must be the upstream type (PRD ← BRD, TSD ← PRD), viewable and not archived. An
 * unviewable source gets the same answer as a missing one, so existence never leaks.
 */
export async function validSource(
  db: Db,
  data: AccessData,
  docType: DocumentRow["docType"],
  sourceId: string,
): Promise<DocumentRow> {
  const source = await findDocument(db, sourceId);
  const upstream = UPSTREAM_DOC_TYPE[docType];
  if (
    !upstream ||
    !source ||
    resolveDocLevel(data, source) === "none" ||
    source.archivedAt ||
    source.docType !== upstream
  ) {
    throw new AppError(
      "invalid_source",
      400,
      upstream
        ? `The source must be a ${upstream.toUpperCase()} you can view`
        : `A ${docType.toUpperCase()} has no source document`,
    );
  }
  return source;
}

function completenessOf(content: DocNode): Completeness {
  return isBlankDoc(content) ? "empty" : "complete";
}

export async function summaries(db: Db, rows: DocumentRow[]): Promise<DocumentSummary[]> {
  if (rows.length === 0) return [];
  const sections = await db
    .select({
      documentId: documentSections.documentId,
      completeness: documentSections.completeness,
    })
    .from(documentSections)
    .where(
      inArray(
        documentSections.documentId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(documentSections.position));
  const byDoc = new Map<string, Completeness[]>();
  for (const s of sections) {
    const list = byDoc.get(s.documentId) ?? [];
    list.push(s.completeness);
    byDoc.set(s.documentId, list);
  }
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    docType: row.docType,
    status: row.status,
    collectionId: row.collectionId,
    completeness: byDoc.get(row.id) ?? [],
    createdBy: row.createdBy,
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  }));
}

/** Non-archived documents directly in a collection (`null` = root), newest first. */
export async function documentsIn(db: Db, collectionId: string | null): Promise<DocumentSummary[]> {
  const rows = await db
    .select()
    .from(documents)
    .where(
      and(
        collectionId === null
          ? isNull(documents.collectionId)
          : eq(documents.collectionId, collectionId),
        isNull(documents.archivedAt),
      ),
    )
    .orderBy(desc(documents.updatedAt));
  return summaries(db, rows);
}

/** Sections in template order, merged with the template's titles and flags. */
export async function sectionsOf(db: Db, row: DocumentRow): Promise<Section[]> {
  const [template] = await db.select().from(templates).where(eq(templates.id, row.templateId));
  if (!template) throw new Error("document template missing");
  const meta = new Map(definitionOf(template).sections.map((s) => [s.key, s]));

  const rows = await db
    .select({ section: documentSections, updatedByName: users.name })
    .from(documentSections)
    .leftJoin(users, eq(users.id, documentSections.updatedBy))
    .where(eq(documentSections.documentId, row.id))
    .orderBy(asc(documentSections.position));

  return rows.map(({ section, updatedByName }) =>
    sectionView(section, meta.get(section.sectionKey), updatedByName),
  );
}

function sectionView(
  section: SectionRow,
  meta: { title: string; required: boolean; expectsDiagram?: string } | undefined,
  updatedByName: string | null,
): Section {
  return {
    key: section.sectionKey,
    title: meta?.title ?? section.sectionKey,
    required: meta?.required ?? false,
    expectsDiagram: meta?.expectsDiagram ?? null,
    position: section.position,
    content: docContent.parse(section.content),
    completeness: section.completeness,
    revision: section.revision,
    updatedAt: section.updatedAt.toISOString(),
    updatedBy:
      section.updatedBy && updatedByName ? { id: section.updatedBy, name: updatedByName } : null,
  };
}

export async function createDocumentSections(
  tx: Transaction,
  documentId: string,
  keys: string[],
): Promise<void> {
  const empty: DocNode = { type: "doc", content: [{ type: "paragraph" }] };
  await tx.insert(documentSections).values(
    keys.map((sectionKey, position) => ({
      documentId,
      sectionKey,
      position,
      content: empty,
      contentMd: "",
      completeness: "empty" as const,
    })),
  );
}

type SaveInput = {
  content: DocNode;
  revision: number;
  userId: string;
  /** LLM writes (drafts, accepted revisions) are always versioned. */
  source?: "human" | "llm";
  /** From the assistant's completeness check; human saves derive it from the content. */
  completeness?: Completeness;
};

/**
 * Optimistic-locked save. Human versions are per editing session: a new session versions the
 * current (not yet versioned) state first, so each session's end state survives in history.
 * Returns "conflict" when `revision` is stale.
 */
export async function saveSection(
  db: Database,
  documentId: string,
  key: string,
  input: SaveInput,
): Promise<"saved" | "conflict"> {
  return db.transaction(async (tx) => {
    const [section] = await tx
      .select()
      .from(documentSections)
      .where(and(eq(documentSections.documentId, documentId), eq(documentSections.sectionKey, key)))
      .for("update");
    if (!section) throw new AppError("not_found", 404, "Section not found");
    if (section.revision !== input.revision) return "conflict";

    const [latest] = await tx
      .select()
      .from(sectionVersions)
      .where(eq(sectionVersions.sectionId, section.id))
      .orderBy(desc(sectionVersions.revision))
      .limit(1);
    const now = Date.now();
    const source = input.source ?? "human";
    const newSession =
      source === "llm" ||
      latest?.source !== "human" ||
      latest.createdBy !== input.userId ||
      now - latest.createdAt.getTime() > VERSION_SESSION_MS;
    const nextRevision = section.revision + 1;

    if (newSession) {
      if (section.revision > (latest?.revision ?? 0)) {
        await tx.insert(sectionVersions).values({
          sectionId: section.id,
          revision: section.revision,
          content: section.content,
          source: "human",
          createdBy: section.updatedBy,
        });
      }
      await tx.insert(sectionVersions).values({
        sectionId: section.id,
        revision: nextRevision,
        content: input.content,
        source,
        createdBy: input.userId,
      });
    }

    await tx
      .update(documentSections)
      .set({
        content: input.content,
        contentMd: toMarkdown(input.content),
        completeness: isBlankDoc(input.content)
          ? "empty"
          : (input.completeness ?? completenessOf(input.content)),
        revision: nextRevision,
        updatedBy: input.userId,
        // Database clock, like the default timestamps it's compared with.
        updatedAt: sql`now()`,
      })
      .where(eq(documentSections.id, section.id));
    await tx.update(documents).set({ updatedAt: sql`now()` }).where(eq(documents.id, documentId));

    const [template] = await tx
      .select({ template: templates })
      .from(documents)
      .innerJoin(templates, eq(templates.id, documents.templateId))
      .where(eq(documents.id, documentId));
    const kind = template
      ? definitionOf(template.template).sections.find((s) => s.key === key)?.requirementKind
      : undefined;
    if (kind) {
      await indexRequirements(tx, { documentId, sectionKey: key, kind, content: input.content });
    }
    return "saved";
  });
}

export async function sectionByKey(db: Db, row: DocumentRow, key: string): Promise<Section> {
  const section = (await sectionsOf(db, row)).find((s) => s.key === key);
  if (!section) throw new AppError("not_found", 404, "Section not found");
  return section;
}
