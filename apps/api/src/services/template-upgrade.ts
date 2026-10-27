import { type Database, documentSections, documents, requirements, templates } from "@jangka/db";
import type { InterviewState } from "@jangka/shared/assistant";
import { type DocNode, docContent, type TemplateUpgradePreview } from "@jangka/shared/document";
import { and, asc, count, eq, notInArray, sql } from "drizzle-orm";
import { loadState, saveState } from "./assistant";
import type { DocumentRow } from "./documents";
import { indexRequirements } from "./requirements";
import { definitionOf, latestPublished, type TemplateRow } from "./templates";

/** The newest published version of the document's template family, when it is newer. */
export async function newerTemplate(
  db: Database,
  row: DocumentRow,
): Promise<{ current: TemplateRow; target: TemplateRow } | null> {
  const [current] = await db.select().from(templates).where(eq(templates.id, row.templateId));
  if (!current) throw new Error("document template missing");
  const target = await latestPublished(db, current.docType, current.name);
  return target && target.version > current.version ? { current, target } : null;
}

export async function upgradePreview(
  db: Database,
  row: DocumentRow,
  { current, target }: { current: TemplateRow; target: TemplateRow },
): Promise<TemplateUpgradePreview> {
  const from = definitionOf(current);
  const to = definitionOf(target);
  const toByKey = new Map(to.sections.map((s) => [s.key, s]));
  const rows = await db
    .select({ key: documentSections.sectionKey, completeness: documentSections.completeness })
    .from(documentSections)
    .where(eq(documentSections.documentId, row.id));
  const present = new Map(rows.map((r) => [r.key, r.completeness]));
  const counts = await db
    .select({ key: requirements.sectionKey, n: count() })
    .from(requirements)
    .where(eq(requirements.documentId, row.id))
    .groupBy(requirements.sectionKey);
  const requirementCount = new Map(counts.map((c) => [c.key, c.n]));

  return {
    from: { templateId: current.id, name: current.name, version: current.version },
    to: { templateId: target.id, name: target.name, version: target.version },
    added: to.sections
      .filter((s) => !present.has(s.key))
      .map((s) => ({ key: s.key, title: s.title })),
    retired: from.sections
      .filter((s) => !toByKey.has(s.key) && present.has(s.key))
      .map((s) => ({ key: s.key, title: s.title, hasContent: present.get(s.key) !== "empty" })),
    renamed: from.sections.flatMap((s) => {
      const next = toByKey.get(s.key);
      return next && next.title !== s.title ? [{ key: s.key, from: s.title, to: next.title }] : [];
    }),
    requirementChanges: from.sections.flatMap((s) => {
      const before = s.requirementKind ?? null;
      const after = toByKey.get(s.key)?.requirementKind ?? null;
      return before === after
        ? []
        : [
            {
              key: s.key,
              title: s.title,
              from: before,
              to: after,
              requirementCount: requirementCount.get(s.key) ?? 0,
            },
          ];
    }),
  };
}

/**
 * Moves the document to `target`. Section content and history are never touched: new template
 * sections are added empty, sections the template dropped stay as retired rows after the rest.
 */
export async function applyUpgrade(
  db: Database,
  row: DocumentRow,
  target: TemplateRow,
): Promise<void> {
  const to = definitionOf(target);
  const toKeys = new Set(to.sections.map((s) => s.key));
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(documentSections)
      .where(eq(documentSections.documentId, row.id))
      .orderBy(asc(documentSections.position))
      .for("update");
    const byKey = new Map(rows.map((r) => [r.sectionKey, r]));

    await tx
      .update(documents)
      .set({ templateId: target.id, updatedAt: sql`now()` })
      .where(eq(documents.id, row.id));

    const empty: DocNode = { type: "doc", content: [{ type: "paragraph" }] };
    const added = to.sections.filter((s) => !byKey.has(s.key));
    if (added.length > 0) {
      await tx.insert(documentSections).values(
        added.map((s) => ({
          documentId: row.id,
          sectionKey: s.key,
          position: 0,
          content: empty,
          contentMd: "",
          completeness: "empty" as const,
        })),
      );
    }

    const order = [
      ...to.sections.map((s) => s.key),
      ...rows.filter((r) => !toKeys.has(r.sectionKey)).map((r) => r.sectionKey),
    ];
    for (const [position, key] of order.entries()) {
      await tx
        .update(documentSections)
        .set({ position })
        .where(and(eq(documentSections.documentId, row.id), eq(documentSections.sectionKey, key)));
    }

    // The index follows the new template: requirement sections are re-read, the rest dropped.
    const indexed: string[] = [];
    for (const section of to.sections) {
      const existing = byKey.get(section.key);
      if (!section.requirementKind || !existing) continue;
      indexed.push(section.key);
      await indexRequirements(tx, {
        documentId: row.id,
        sectionKey: section.key,
        kind: section.requirementKind,
        content: docContent.parse(existing.content),
      });
    }
    await tx
      .delete(requirements)
      .where(
        and(
          eq(requirements.documentId, row.id),
          indexed.length > 0 ? notInArray(requirements.sectionKey, indexed) : undefined,
        ),
      );

    const state = await loadState(tx, row.id);
    if (state) {
      const coverage = new Map(state.sections.map((s) => [s.key, s]));
      const sections = to.sections.map(
        (s) => coverage.get(s.key) ?? { key: s.key, coverage: "missing" as const, note: "" },
      );
      const withContent = new Set(
        rows.filter((r) => r.completeness !== "empty").map((r) => r.sectionKey),
      );
      const next: InterviewState = {
        ...state,
        sections,
        readyToDraft: to.sections.every(
          (s, i) => !s.required || sections[i]?.coverage !== "missing",
        ),
        suggestions: state.suggestions.filter((s) => toKeys.has(s.key) && withContent.has(s.key)),
      };
      await saveState(tx, row.id, next);
    }
  });
}
