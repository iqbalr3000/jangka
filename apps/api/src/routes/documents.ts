import {
  comments,
  documentSections,
  documents,
  sectionVersions,
  templates,
  users,
} from "@jangka/db";
import { can, personalOwnerOf } from "@jangka/permissions";
import {
  createDocumentRequest,
  type DocumentDetail,
  docContent,
  moveDocumentRequest,
  restoreSectionRequest,
  saveSectionRequest,
  type TemplateSummary,
  updateDocumentRequest,
  upgradeTemplateRequest,
} from "@jangka/shared/document";
import { AppError } from "@jangka/shared/errors";
import { STATUS_TRANSITIONS, setStatusRequest } from "@jangka/shared/review";
import { and, desc, eq, ilike, isNotNull, isNull, lt } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { audit } from "../lib/audit";
import { requireAuth } from "../lib/session";
import { zValidate } from "../lib/validate";
import {
  type AccessData,
  isHidden,
  loadAccess,
  requireEdit,
  resolveDocLevel,
} from "../services/access";
import {
  assertUsableCollection,
  createDocumentSections,
  type DocumentRow,
  linkedSource,
  requireDocEdit,
  requireNotApproved,
  saveSection,
  sectionByKey,
  sectionsOf,
  summaries,
  validSource,
  viewableDocument,
} from "../services/documents";
import { applyUpgrade, newerTemplate, upgradePreview } from "../services/template-upgrade";
import { defaultTemplates, definitionOf, templateForNewDocument } from "../services/templates";
import type { AppEnv, RouteDeps } from "../types";

const idParam = z.object({ id: z.uuid() });
const sectionParam = z.object({ id: z.uuid(), key: z.string().regex(/^[a-z][a-z0-9_]*$/) });
const listQuery = z.object({
  docType: z.enum(["brd", "prd", "tsd"]).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const versionsQuery = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const templatesQuery = z.object({ docType: z.enum(["brd", "prd", "tsd"]).optional() });

/** Picker for new documents: the newest published version of each non-archived family. */
export function templateRoutes({ db }: RouteDeps) {
  return new Hono<AppEnv>().get("/", zValidate("query", templatesQuery), async (c) => {
    requireAuth(c);
    const { docType } = c.req.valid("query");
    const rows = await db
      .select()
      .from(templates)
      .where(
        and(
          isNotNull(templates.publishedAt),
          isNull(templates.archivedAt),
          docType ? eq(templates.docType, docType) : undefined,
        ),
      )
      .orderBy(templates.docType, templates.name, desc(templates.version));
    const latest = rows.filter(
      (row, i) => i === 0 || rows[i - 1]?.docType !== row.docType || rows[i - 1]?.name !== row.name,
    );
    const defaults = await defaultTemplates(db);
    const items: TemplateSummary[] = latest.map((row) => {
      const chosen = defaults[row.docType];
      const isDefault =
        chosen !== undefined && latest.some((r) => r.docType === row.docType && r.name === chosen)
          ? row.name === chosen
          : row.isBuiltin;
      return {
        id: row.id,
        docType: row.docType,
        name: row.name,
        version: row.version,
        sectionCount: definitionOf(row).sections.length,
        isBuiltin: row.isBuiltin,
        isDefault,
      };
    });
    return c.json({ items });
  });
}

export function documentRoutes({ db, locks }: RouteDeps) {
  const access = (c: Context<AppEnv>) => {
    const auth = requireAuth(c);
    return loadAccess(db, {
      userId: auth.user.id,
      isAdmin: auth.user.isAdmin,
      groupIds: auth.groupIds,
    });
  };

  async function statusChangeOf(row: DocumentRow) {
    if (!row.statusChangedAt) return null;
    const [by] = row.statusChangedBy
      ? await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(eq(users.id, row.statusChangedBy))
      : [];
    return { at: row.statusChangedAt.toISOString(), by: by ?? null };
  }

  async function summaryOf(row: DocumentRow) {
    const [summary] = await summaries(db, [row]);
    if (!summary) throw new Error("summary missing");
    return summary;
  }

  async function detailOf(data: AccessData, row: DocumentRow): Promise<DocumentDetail> {
    const collection = row.collectionId ? data.rows.get(row.collectionId) : undefined;
    const level = resolveDocLevel(data, row) === "edit" ? "edit" : "view";
    const newer = level === "edit" ? await newerTemplate(db, row) : null;
    return {
      document: await summaryOf(row),
      source: await linkedSource(db, data, row),
      statusChange: await statusChangeOf(row),
      level,
      collection: collection
        ? {
            id: collection.id,
            name: collection.name,
            personalOwnerId: collection.personalOwnerId,
          }
        : null,
      inPersonalTree: personalOwnerOf(data.ctx, row.collectionId) !== null,
      sections: await sectionsOf(db, row),
      templateUpgrade: newer
        ? { templateId: newer.target.id, version: newer.target.version }
        : null,
    };
  }

  async function requireNewer(row: DocumentRow) {
    const newer = await newerTemplate(db, row);
    if (!newer) throw new AppError("conflict", 409, "This document uses the newest template");
    return newer;
  }

  return new Hono<AppEnv>()
    .get("/", zValidate("query", listQuery), async (c) => {
      // Picker list (e.g. source documents): viewable, not archived, newest first.
      const { docType, q, limit } = c.req.valid("query");
      const data = await access(c);
      const rows = await db
        .select()
        .from(documents)
        .where(
          and(
            isNull(documents.archivedAt),
            docType ? eq(documents.docType, docType) : undefined,
            q ? ilike(documents.title, `%${q.replace(/[\\%_]/g, "\\$&")}%`) : undefined,
          ),
        )
        .orderBy(desc(documents.updatedAt));
      const visible = rows
        .filter(
          (row) =>
            resolveDocLevel(data, row) !== "none" &&
            (row.collectionId === null || !isHidden(data, row.collectionId)),
        )
        .slice(0, limit);
      return c.json({ items: await summaries(db, visible) });
    })
    .post("/", zValidate("json", createDocumentRequest), async (c) => {
      const { title, collectionId, docType, sourceDocumentId } = c.req.valid("json");
      const auth = requireAuth(c);
      const data = await access(c);
      assertUsableCollection(data, collectionId);
      requireEdit(data, collectionId);
      const source = sourceDocumentId
        ? await validSource(db, data, docType, sourceDocumentId)
        : null;

      const template = await templateForNewDocument(db, docType, c.req.valid("json").templateId);
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
            sourceDocumentId: source?.id ?? null,
          })
          .returning();
        if (!created) throw new Error("document not created");
        await createDocumentSections(tx, created.id, keys);
        return created;
      });
      await audit(c, {
        action: "document.create",
        targetType: "document",
        targetId: row.id,
        metadata: source ? { sourceDocumentId: source.id } : undefined,
      });
      return c.json(await summaryOf(row), 201);
    })
    .get("/:id", zValidate("param", idParam), async (c) => {
      const data = await access(c);
      const row = await viewableDocument(db, data, c.req.valid("param").id);
      return c.json(await detailOf(data, row));
    })
    .get("/:id/template-upgrade", zValidate("param", idParam), async (c) => {
      const data = await access(c);
      const row = await viewableDocument(db, data, c.req.valid("param").id);
      requireDocEdit(data, row);
      return c.json(await upgradePreview(db, row, await requireNewer(row)));
    })
    .post(
      "/:id/template-upgrade",
      zValidate("param", idParam),
      zValidate("json", upgradeTemplateRequest),
      async (c) => {
        const data = await access(c);
        const row = await viewableDocument(db, data, c.req.valid("param").id);
        requireDocEdit(data, row);
        requireNotApproved(row);
        const { current, target } = await requireNewer(row);
        if (target.id !== c.req.valid("json").templateId) {
          throw new AppError("conflict", 409, "The template changed; review the upgrade again");
        }
        // A running draft writes sections by key: it must not interleave with the upgrade.
        const release = locks.acquire(row.id);
        try {
          await applyUpgrade(db, row, target);
        } finally {
          release();
        }
        await audit(c, {
          action: "document.template_upgrade",
          targetType: "document",
          targetId: row.id,
          metadata: {
            from: { templateId: current.id, version: current.version },
            to: { templateId: target.id, version: target.version },
          },
        });
        const upgraded = await viewableDocument(db, data, row.id);
        return c.json(await detailOf(data, upgraded));
      },
    )
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
    .post(
      "/:id/status",
      zValidate("param", idParam),
      zValidate("json", setStatusRequest),
      async (c) => {
        const auth = requireAuth(c);
        const data = await access(c);
        const row = await viewableDocument(db, data, c.req.valid("param").id);
        requireDocEdit(data, row);
        const { status } = c.req.valid("json");
        const allowed: readonly string[] = STATUS_TRANSITIONS[row.status];
        if (!allowed.includes(status)) {
          throw new AppError(
            "validation_failed",
            400,
            `A ${row.status.replace("_", " ")} document can't move to ${status.replace("_", " ")}`,
          );
        }
        if (status === "approved") {
          const open = await db
            .selectDistinct({ sectionKey: comments.sectionKey })
            .from(comments)
            .where(
              and(
                eq(comments.documentId, row.id),
                isNull(comments.parentId),
                isNull(comments.resolvedAt),
                isNull(comments.deletedAt),
              ),
            );
          if (open.length > 0) {
            throw new AppError("open_comments", 409, "Resolve the open comments before approving", {
              sections: open.map((o) => o.sectionKey),
            });
          }
        }
        const [updated] = await db
          .update(documents)
          .set({ status, statusChangedAt: new Date(), statusChangedBy: auth.user.id })
          .where(eq(documents.id, row.id))
          .returning();
        if (!updated) throw new AppError("not_found", 404, "Document not found");
        await audit(c, {
          action: "document.status",
          targetType: "document",
          targetId: row.id,
          metadata: { from: row.status, to: status },
        });
        return c.json(await summaryOf(updated));
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
        const { content, revision, source } = c.req.valid("json");
        const data = await access(c);
        const row = await viewableDocument(db, data, id);
        requireDocEdit(data, row);

        const result = await saveSection(db, row.id, key, {
          content,
          revision,
          userId: auth.user.id,
          source,
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
    .post(
      "/:id/sections/:key/restore",
      zValidate("param", sectionParam),
      zValidate("json", restoreSectionRequest),
      async (c) => {
        const auth = requireAuth(c);
        const { id, key } = c.req.valid("param");
        const { versionId, revision } = c.req.valid("json");
        const data = await access(c);
        const row = await viewableDocument(db, data, id);
        requireDocEdit(data, row);

        const [found] = await db
          .select({ version: sectionVersions })
          .from(sectionVersions)
          .innerJoin(documentSections, eq(documentSections.id, sectionVersions.sectionId))
          .where(
            and(
              eq(sectionVersions.id, versionId),
              eq(documentSections.documentId, row.id),
              eq(documentSections.sectionKey, key),
            ),
          );
        if (!found) throw new AppError("not_found", 404, "Version not found");

        const result = await saveSection(db, row.id, key, {
          content: docContent.parse(found.version.content),
          revision,
          userId: auth.user.id,
          restoredFromRevision: found.version.revision,
        });
        const current = await sectionByKey(db, row, key);
        if (result === "conflict") {
          throw new AppError("revision_conflict", 409, "This section was changed by someone else", {
            current,
          });
        }
        await audit(c, {
          action: "document.restore_section",
          targetType: "document",
          targetId: row.id,
          metadata: { section: key, versionId, fromRevision: found.version.revision },
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
            restoredFromRevision: version.restoredFromRevision,
          })),
          nextCursor: rows.length > limit ? (page.at(-1)?.version.id ?? null) : null,
        });
      },
    );
}
