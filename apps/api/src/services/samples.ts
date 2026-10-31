import {
  collectionGrants,
  collections,
  type Database,
  documentSections,
  documents,
  groups,
  sectionVersions,
} from "@jangka/db";
import { fromMarkdown, toMarkdown } from "@jangka/export";
import { sampleDocuments } from "@jangka/templates";
import { and, eq, isNull, like } from "drizzle-orm";
import { indexRequirements } from "./requirements";
import { definitionOf, latestBuiltin } from "./templates";

const NAME = "Examples";

/**
 * Creates the linked sample BRD → PRD → TSD in a new root collection everyone can view. Content
 * goes in as the admin's own versions, so history, search and the requirements index behave as for
 * any written document.
 */
export async function createSampleDocuments(
  db: Database,
  { userId }: { userId: string },
): Promise<{ collectionId: string; documentIds: string[] }> {
  return db.transaction(async (tx) => {
    const taken = await tx
      .select({ name: collections.name })
      .from(collections)
      .where(and(isNull(collections.parentId), like(collections.name, `${NAME}%`)));
    const names = new Set(taken.map((t) => t.name));
    let name = NAME;
    for (let n = 2; names.has(name); n++) name = `${NAME} ${n}`;

    const [collection] = await tx.insert(collections).values({ name }).returning();
    const [allUsers] = await tx.select().from(groups).where(eq(groups.systemKey, "all_users"));
    if (!collection || !allUsers) throw new Error("examples collection not created");
    await tx
      .insert(collectionGrants)
      .values({ collectionId: collection.id, groupId: allUsers.id, level: "view" });

    const documentIds: string[] = [];
    let sourceId: string | null = null;
    for (const sample of sampleDocuments) {
      const template = await latestBuiltin(tx, sample.docType);
      const [document]: (typeof documents.$inferSelect)[] = await tx
        .insert(documents)
        .values({
          title: sample.title,
          collectionId: collection.id,
          docType: sample.docType,
          templateId: template.id,
          createdBy: userId,
          sourceDocumentId: sourceId,
        })
        .returning();
      if (!document) throw new Error("sample document not created");

      for (const [position, section] of definitionOf(template).sections.entries()) {
        const content = fromMarkdown(sample.sections[section.key] ?? "");
        const [row] = await tx
          .insert(documentSections)
          .values({
            documentId: document.id,
            sectionKey: section.key,
            position,
            content,
            contentMd: toMarkdown(content),
            completeness: "complete",
            revision: 1,
            updatedBy: userId,
          })
          .returning();
        if (!row) throw new Error("sample section not created");
        await tx.insert(sectionVersions).values({
          sectionId: row.id,
          revision: 1,
          content,
          source: "human",
          createdBy: userId,
        });
        if (section.requirementKind) {
          await indexRequirements(tx, {
            documentId: document.id,
            sectionKey: section.key,
            kind: section.requirementKind,
            content,
          });
        }
      }
      documentIds.push(document.id);
      sourceId = document.id;
    }
    return { collectionId: collection.id, documentIds };
  });
}
