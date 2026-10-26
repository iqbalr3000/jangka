import { comments, documentSections, users } from "@jangka/db";
import { can } from "@jangka/permissions";
import { AppError } from "@jangka/shared/errors";
import {
  type CommentThread,
  type CommentView,
  commentQuery,
  createCommentRequest,
  updateCommentRequest,
} from "@jangka/shared/review";
import { and, asc, eq, inArray } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { audit } from "../lib/audit";
import { requireAuth } from "../lib/session";
import { zValidate } from "../lib/validate";
import { type AccessData, loadAccess } from "../services/access";
import { type DocumentRow, viewableDocument } from "../services/documents";
import type { AppEnv, RouteDeps } from "../types";

const idParam = z.object({ id: z.uuid() });

type CommentRow = typeof comments.$inferSelect;

export function commentRoutes({ db }: RouteDeps) {
  async function context(c: Context<AppEnv>) {
    const auth = requireAuth(c);
    const data = await loadAccess(db, {
      userId: auth.user.id,
      isAdmin: auth.user.isAdmin,
      groupIds: auth.groupIds,
    });
    return { auth, data };
  }

  /** Viewable document the viewer may comment on (view access is enough); 404 otherwise. */
  async function commentableDocument(data: AccessData, id: string): Promise<DocumentRow> {
    const row = await viewableDocument(db, data, id);
    if (!can(data.ctx, { action: "comment", collectionId: row.collectionId })) {
      throw new AppError("not_found", 404, "Document not found");
    }
    return row;
  }

  /** The comment, if its document is viewable by this user; 404 otherwise (no existence leak). */
  async function findComment(data: AccessData, id: string) {
    const [row] = await db.select().from(comments).where(eq(comments.id, id));
    if (!row) throw new AppError("not_found", 404, "Comment not found");
    try {
      return { comment: row, document: await commentableDocument(data, row.documentId) };
    } catch {
      throw new AppError("not_found", 404, "Comment not found");
    }
  }

  function requireAuthor(comment: CommentRow, userId: string): void {
    if (comment.authorId !== userId) {
      throw new AppError("forbidden", 403, "Only the author can change this comment");
    }
    if (comment.deletedAt) throw new AppError("conflict", 409, "This comment was deleted");
  }

  function canEditDocument(data: AccessData, document: DocumentRow): boolean {
    return can(data.ctx, { action: "edit", collectionId: document.collectionId });
  }

  return new Hono<AppEnv>()
    .get(
      "/documents/:id/comments",
      zValidate("param", idParam),
      zValidate("query", commentQuery),
      async (c) => {
        const { auth, data } = await context(c);
        const document = await commentableDocument(data, c.req.valid("param").id);
        const { state } = c.req.valid("query");
        const rows = await db
          .select()
          .from(comments)
          .where(eq(comments.documentId, document.id))
          .orderBy(asc(comments.id));
        const people = [
          ...new Set(rows.flatMap((r) => [r.authorId, ...(r.resolvedBy ? [r.resolvedBy] : [])])),
        ];
        const names = new Map(
          people.length
            ? (
                await db
                  .select({ id: users.id, name: users.name })
                  .from(users)
                  .where(inArray(users.id, people))
              ).map((u) => [u.id, u.name])
            : [],
        );
        const ref = (id: string | null) => {
          const name = id ? names.get(id) : undefined;
          return id && name ? { id, name } : null;
        };
        const view = (row: CommentRow): CommentView => ({
          id: row.id,
          sectionKey: row.sectionKey,
          parentId: row.parentId,
          author: ref(row.authorId),
          body: row.deletedAt ? null : row.body,
          deleted: row.deletedAt !== null,
          editedAt: row.editedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
          canEdit: row.authorId === auth.user.id && row.deletedAt === null,
        });

        const editor = canEditDocument(data, document);
        const roots = rows.filter((r) => r.parentId === null);
        const openCountBySection: Record<string, number> = {};
        for (const root of roots) {
          if (root.resolvedAt || root.deletedAt) continue;
          openCountBySection[root.sectionKey] = (openCountBySection[root.sectionKey] ?? 0) + 1;
        }
        const threads: CommentThread[] = roots
          .filter((root) => state === "all" || (!root.resolvedAt && !root.deletedAt))
          .map((root) => ({
            root: view(root),
            replies: rows.filter((r) => r.parentId === root.id).map(view),
            resolvedAt: root.resolvedAt?.toISOString() ?? null,
            resolvedBy: ref(root.resolvedBy),
            canResolve: editor || root.authorId === auth.user.id,
          }));
        return c.json({ threads, openCountBySection });
      },
    )
    .post(
      "/documents/:id/comments",
      zValidate("param", idParam),
      zValidate("json", createCommentRequest),
      async (c) => {
        const { auth, data } = await context(c);
        const document = await commentableDocument(data, c.req.valid("param").id);
        const { sectionKey, parentId, body } = c.req.valid("json");
        const [section] = await db
          .select({ id: documentSections.id })
          .from(documentSections)
          .where(
            and(
              eq(documentSections.documentId, document.id),
              eq(documentSections.sectionKey, sectionKey),
            ),
          );
        if (!section) throw new AppError("not_found", 404, "Section not found");
        if (parentId) {
          const [parent] = await db.select().from(comments).where(eq(comments.id, parentId));
          if (!parent || parent.documentId !== document.id || parent.sectionKey !== sectionKey) {
            throw new AppError("not_found", 404, "Comment not found");
          }
          if (parent.parentId !== null) {
            throw new AppError("validation_failed", 400, "Reply to the thread, not to a reply");
          }
        }
        const [row] = await db
          .insert(comments)
          .values({
            documentId: document.id,
            sectionKey,
            parentId: parentId ?? null,
            authorId: auth.user.id,
            body,
          })
          .returning();
        if (!row) throw new Error("comment not created");
        await audit(c, {
          action: "comment.create",
          targetType: "document",
          targetId: document.id,
          metadata: { commentId: row.id, section: sectionKey, reply: parentId !== undefined },
        });
        return c.json({ id: row.id }, 201);
      },
    )
    .patch(
      "/comments/:id",
      zValidate("param", idParam),
      zValidate("json", updateCommentRequest),
      async (c) => {
        const { auth, data } = await context(c);
        const { comment, document } = await findComment(data, c.req.valid("param").id);
        requireAuthor(comment, auth.user.id);
        await db
          .update(comments)
          .set({ body: c.req.valid("json").body, editedAt: new Date() })
          .where(eq(comments.id, comment.id));
        await audit(c, {
          action: "comment.update",
          targetType: "document",
          targetId: document.id,
          metadata: { commentId: comment.id },
        });
        return c.body(null, 204);
      },
    )
    .delete("/comments/:id", zValidate("param", idParam), async (c) => {
      const { auth, data } = await context(c);
      const { comment, document } = await findComment(data, c.req.valid("param").id);
      requireAuthor(comment, auth.user.id);
      await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, comment.id));
      await audit(c, {
        action: "comment.delete",
        targetType: "document",
        targetId: document.id,
        metadata: { commentId: comment.id },
      });
      return c.body(null, 204);
    })
    .post(
      "/comments/:id/:action{resolve|reopen}",
      zValidate("param", idParam.extend({ action: z.enum(["resolve", "reopen"]) })),
      async (c) => {
        const { auth, data } = await context(c);
        const { id, action } = c.req.valid("param");
        const { comment, document } = await findComment(data, id);
        if (comment.parentId !== null) {
          throw new AppError("validation_failed", 400, "Resolve the thread, not a reply");
        }
        if (comment.authorId !== auth.user.id && !canEditDocument(data, document)) {
          throw new AppError("forbidden", 403, "Only the thread's author or an editor can do this");
        }
        const resolving = action === "resolve";
        await db
          .update(comments)
          .set(
            resolving
              ? { resolvedAt: new Date(), resolvedBy: auth.user.id }
              : { resolvedAt: null, resolvedBy: null },
          )
          .where(eq(comments.id, comment.id));
        await audit(c, {
          action: resolving ? "comment.resolve" : "comment.reopen",
          targetType: "document",
          targetId: document.id,
          metadata: { commentId: comment.id, section: comment.sectionKey },
        });
        return c.body(null, 204);
      },
    );
}
