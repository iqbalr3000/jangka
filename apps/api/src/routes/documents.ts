import { documentSections, documents, sectionVersions, templates, users } from "@jangka/db";
import { can, personalOwnerOf } from "@jangka/permissions";
import {
  createDocumentRequest,
  type DocumentDetail,
  docContent,
  moveDocumentRequest,
  saveSectionRequest,
  updateDocumentRequest,
} from "@jangka/shared/document";
import { AppError } from "@jangka/shared/errors";
import { and, desc, eq, lt } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { audit } from "../lib/audit";
import { requireAuth } from "../lib/session";
import { zValidate } from "../lib/validate";
import { isHidden, loadAccess, requireEdit, resolveDocLevel } from "../services/access";
import {
  assertUsableCollection,
  createDocumentSections,
  type DocumentRow,
  requireDocEdit,
  saveSection,
  sectionByKey,
  sectionsOf,
  summaries,
  viewableDocument,
} from "../services/documents";
import { definitionOf, latestBuiltin } from "../services/templates";
import type { AppEnv, RouteDeps } from "../types";

const idParam = z.object({ id: z.uuid() });
const sectionParam = z.object({ id: z.uuid(), key: z.string().regex(/^[a-z][a-z0-9_]*$/) });
const versionsQuery = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export function templateRoutes({ db }: RouteDeps) {
  return new Hono<AppEnv>().get("/", async (c) => {
    requireAuth(c);
    const rows = await db
      .select()
      .from(templates)
      .orderBy(templates.docType, desc(templates.version));
    return c.json({
      items: rows.map((row) => ({
        id: row.id,
        docType: row.docType,
        name: row.name,
        version: row.version,
        sectionCount: definitionOf(row).sections.length,
      })),
    });
  });
}

export function documentRoutes({ db }: RouteDeps) {
  const access = (c: Context<AppEnv>) => {
    const auth = requireAuth(c);
    return loadAccess(db, {
      userId: auth.user.id,
      isAdmin: auth.user.isAdmin,
      groupIds: auth.groupIds,
    });
  };

  async function summaryOf(row: DocumentRow) {
    const [summary] = await summaries(db, [row]);
    if (!summary) throw new Error("summary missing");
    return summary;
  }

  return new Hono<AppEnv>()
    .post("/", zValidate("json", createDocumentRequest), async (c) => {
      const { title, collectionId, docType } = c.req.valid("json");
      const auth = requireAuth(c);
      const data = await access(c);
      assertUsableCollection(data, collectionId);
      requireEdit(data, collectionId);

      const template = await latestBuiltin(db, docType);
      const keys = definitionOf(template).sections.map((s) => s.key);
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(documents)
          .values({
            title,
            collectionId,
            docType,
            templateId: template.id,
            createdBy: auth.user.id,
          })
          .returning();
        if (!created) throw new Error("document not created");
        await createDocumentSections(tx, created.id, keys);
        return created;
      });
      await audit(c, { action: "document.create", targetType: "document", targetId: row.id });
      return c.json(await summaryOf(row), 201);
    })
    .get("/:id", zValidate("param", idParam), async (c) => {
      const data = await access(c);
      const row = await viewableDocument(db, data, c.req.valid("param").id);
      const collection = row.collectionId ? data.rows.get(row.collectionId) : undefined;
      const detail: DocumentDetail = {
        document: await summaryOf(row),
        level: resolveDocLevel(data, row) === "edit" ? "edit" : "view",
        collection: collection
          ? {
              id: collection.id,
              name: collection.name,
              personalOwnerId: collection.personalOwnerId,
            }
          : null,
        inPersonalTree: personalOwnerOf(data.ctx, row.collectionId) !== null,
        sections: await sectionsOf(db, row),
      };
      return c.json(detail);
    })
    .patch(
      "/:id",
      zValidate("param", idParam),
      zValidate("json", updateDocumentRequest),
      async (c) => {
        const data = await access(c);
        const row = await viewableDocument(db, data, c.req.valid("param").id);
        requireDocEdit(data, row);
        const [updated] = await db
          .update(documents)
          .set({ title: c.req.valid("json").title })
          .where(eq(documents.id, row.id))
          .returning();
        if (!updated) throw new AppError("not_found", 404, "Document not found");
        await audit(c, { action: "document.rename", targetType: "document", targetId: row.id });
        return c.json(await summaryOf(updated));
      },
    )
    .post(
      "/:id/move",
      zValidate("param", idParam),
      zValidate("json", moveDocumentRequest),
      async (c) => {
        const data = await access(c);
        const row = await viewableDocument(db, data, c.req.valid("param").id);
        const { collectionId } = c.req.valid("json");
        assertUsableCollection(data, collectionId);
        if (!can(data.ctx, { action: "move_document", from: row.collectionId, to: collectionId })) {
          throw new AppError(
            "forbidden",
            403,
            "You need edit access to both the current and the destination collection",
          );
        }
        const [moved] = await db
          .update(documents)
          .set({ collectionId })
          .where(eq(documents.id, row.id))
          .returning();
        if (!moved) throw new AppError("not_found", 404, "Document not found");
        await audit(c, {
          action: "document.move",
          targetType: "document",
          targetId: row.id,
          metadata: { from: row.collectionId, to: collectionId },
        });
        return c.json(await summaryOf(moved));
      },
    )
    .post("/:id/archive", zValidate("param", idParam), async (c) => {
      const data = await access(c);
      const row = await viewableDocument(db, data, c.req.valid("param").id);
      requireDocEdit(data, row);
      if (!row.archivedAt) {
        await db.update(documents).set({ archivedAt: new Date() }).where(eq(documents.id, row.id));
        await audit(c, { action: "document.archive", targetType: "document", targetId: row.id });
      }
      return c.body(null, 204);
    })
    .post("/:id/restore", zValidate("param", idParam), async (c) => {
      const data = await access(c);
      const row = await viewableDocument(db, data, c.req.valid("param").id);
      requireDocEdit(data, row);
      if (row.collectionId !== null && isHidden(data, row.collectionId)) {
        throw new AppError("conflict", 409, "Restore the collection first");
      }
      if (row.archivedAt) {
        await db.update(documents).set({ archivedAt: null }).where(eq(documents.id, row.id));
        await audit(c, { action: "document.restore", targetType: "document", targetId: row.id });
      }
      return c.body(null, 204);
    })
    .put(
      "/:id/sections/:key",
      zValidate("param", sectionParam),
      zValidate("json", saveSectionRequest),
      async (c) => {
        const auth = requireAuth(c);
        const { id, key } = c.req.valid("param");
        const { content, revision } = c.req.valid("json");
        const data = await access(c);
        const row = await viewableDocument(db, data, id);
        requireDocEdit(data, row);

        const result = await saveSection(db, row.id, key, {
          content,
          revision,
          userId: auth.user.id,
        });
        const current = await sectionByKey(db, row, key);
        if (result === "conflict") {
          throw new AppError("revision_conflict", 409, "This section was changed by someone else", {
            current,
          });
        }
        await audit(c, {
          action: "document.update_section",
          targetType: "document",
          targetId: row.id,
          metadata: { section: key, revision: current.revision },
        });
        return c.json(current);
      },
    )
    .get(
      "/:id/sections/:key/versions",
      zValidate("param", sectionParam),
      zValidate("query", versionsQuery),
      async (c) => {
        const { id, key } = c.req.valid("param");
        const { cursor, limit } = c.req.valid("query");
        const data = await access(c);
        const row = await viewableDocument(db, data, id);
        const [section] = await db
          .select({ id: documentSections.id })
          .from(documentSections)
          .where(
            and(eq(documentSections.documentId, row.id), eq(documentSections.sectionKey, key)),
          );
        if (!section) throw new AppError("not_found", 404, "Section not found");

        const rows = await db
          .select({ version: sectionVersions, authorName: users.name })
          .from(sectionVersions)
          .leftJoin(users, eq(users.id, sectionVersions.createdBy))
          .where(
            and(
              eq(sectionVersions.sectionId, section.id),
              cursor ? lt(sectionVersions.id, cursor) : undefined,
            ),
          )
          .orderBy(desc(sectionVersions.id))
          .limit(limit + 1);
        const page = rows.slice(0, limit);
        return c.json({
          items: page.map(({ version, authorName }) => ({
            id: version.id,
            revision: version.revision,
            source: version.source,
            createdBy:
              version.createdBy && authorName ? { id: version.createdBy, name: authorName } : null,
            createdAt: version.createdAt.toISOString(),
            content: docContent.parse(version.content),
          })),
          nextCursor: rows.length > limit ? (page.at(-1)?.version.id ?? null) : null,
        });
      },
    );
}
