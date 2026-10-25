import {
  type Database,
  documentExports,
  documentSections,
  documents,
  instanceSettings,
  requirements,
  templates,
  users,
} from "@jangka/db";
import { mermaidBlocks } from "@jangka/export";
import {
  type AppendixRow,
  type DiagramResult,
  diagramHash,
  type ExportInput,
  pdfChrome,
  toDocx,
  toHtml,
} from "@jangka/export/render";
import { docContent, isBlankDoc } from "@jangka/shared/document";
import { templateDefinition } from "@jangka/templates";
import { asc, eq } from "drizzle-orm";

const KIND_ORDER = ["business", "functional", "non_functional", "technical"] as const;

import { renderDiagram } from "./diagrams";
import { fontCss } from "./fonts";
import type { Renderer } from "./renderer";

/** `refunds-self-service.pdf`; falls back to "document" when the title has no usable characters. */
export function exportFileName(title: string, format: "pdf" | "docx"): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return `${slug || "document"}.${format}`;
}

/** The document as it is now (the snapshot is taken when the job runs). */
/** Requirements grouped by kind (BR, FR, NFR, TR), each group in code order. */
async function loadAppendix(db: Database, documentId: string): Promise<AppendixRow[]> {
  const rows = await db
    .select()
    .from(requirements)
    .where(eq(requirements.documentId, documentId))
    .orderBy(asc(requirements.code));
  return rows
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
    .map((r) => ({
      code: r.code,
      text: r.text,
      priority: r.priority,
      upstreamCodes: r.upstreamCodes,
    }));
}

async function loadInput(
  db: Database,
  renderer: Renderer,
  documentId: string,
  options: { includeCover: boolean; includeAppendix: boolean },
): Promise<ExportInput> {
  const [row] = await db
    .select({ document: documents, author: users.name, definition: templates.definition })
    .from(documents)
    .innerJoin(templates, eq(templates.id, documents.templateId))
    .leftJoin(users, eq(users.id, documents.createdBy))
    .where(eq(documents.id, documentId));
  if (!row) throw new Error("document missing");
  const [settings] = await db.select({ orgName: instanceSettings.orgName }).from(instanceSettings);
  const titles = new Map(
    templateDefinition.parse(row.definition).sections.map((s) => [s.key, s.title]),
  );

  const sectionRows = await db
    .select()
    .from(documentSections)
    .where(eq(documentSections.documentId, documentId))
    .orderBy(asc(documentSections.position));
  const sections = sectionRows.map((section) => {
    const content = docContent.parse(section.content);
    return {
      title: titles.get(section.sectionKey) ?? section.sectionKey,
      content,
      empty: section.completeness === "empty" || isBlankDoc(content),
    };
  });

  // Sequential: a document has a handful of diagrams, and each render uses a browser context.
  const diagrams = new Map<string, DiagramResult>();
  for (const source of sections.flatMap((s) => mermaidBlocks(s.content))) {
    const hash = diagramHash(source);
    if (!diagrams.has(hash)) diagrams.set(hash, await renderDiagram(db, renderer, source));
  }

  return {
    document: {
      title: row.document.title,
      docType: row.document.docType,
      status: row.document.status,
      author: row.author,
      updatedAt: row.document.updatedAt,
      orgName: settings?.orgName ?? null,
    },
    sections,
    diagrams,
    includeCover: options.includeCover,
    appendix: options.includeAppendix ? await loadAppendix(db, documentId) : null,
  };
}

/** Runs one export; throws on failure so pg-boss can retry, `markFailed` settles it for good. */
export async function runExport(db: Database, renderer: Renderer, exportId: string): Promise<void> {
  const [job] = await db.select().from(documentExports).where(eq(documentExports.id, exportId));
  // Deleted by cleanup (or with its document) before it ran.
  if (!job || job.status === "done") return;
  await db.update(documentExports).set({ status: "running" }).where(eq(documentExports.id, job.id));

  const input = await loadInput(db, renderer, job.documentId, {
    includeCover: job.includeCover,
    includeAppendix: job.includeAppendix,
  });
  const file =
    job.format === "pdf"
      ? await renderer.pdf(toHtml(input, { fontCss: fontCss() }), pdfChrome(input.document))
      : await toDocx(input);
  await db
    .update(documentExports)
    .set({
      status: "done",
      file,
      fileName: exportFileName(input.document.title, job.format),
      error: null,
    })
    .where(eq(documentExports.id, job.id));
}

/** Users see a generic message; the cause is in the worker log. */
export async function markFailed(db: Database, exportId: string): Promise<void> {
  await db
    .update(documentExports)
    .set({ status: "failed", error: "The export could not be generated. Try again." })
    .where(eq(documentExports.id, exportId));
}
