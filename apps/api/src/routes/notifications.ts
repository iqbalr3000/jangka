import { comments, documents, notifications, templates, users } from "@jangka/db";
import { can, resolveLevel } from "@jangka/permissions";
import { AppError } from "@jangka/shared/errors";
import {
  markReadRequest,
  mentionableQuery,
  type NotificationView,
  notificationQuery,
  plainBody,
} from "@jangka/shared/notifications";
import { retiredSectionTitle } from "@jangka/templates";
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { auditExempt } from "../lib/audit";
import { requireAuth } from "../lib/session";
import { zValidate } from "../lib/validate";
import { type AccessData, contextsFor, loadAccess, resolveDocLevel } from "../services/access";
import { viewableDocument } from "../services/documents";
import { purgeOld } from "../services/notifications";
import { escapeLike } from "../services/search-query";
import { definitionOf } from "../services/templates";
import type { AppEnv, RouteDeps } from "../types";

const idParam = z.object({ id: z.uuid() });
const EXCERPT = 160;
const MENTIONABLE = 8;
/** Candidates checked for access per suggestion request; plenty for one organisation. */
const CANDIDATES = 200;

function excerpt(body: string): string {
  const text = plainBody(body).replace(/\s+/g, " ").trim();
  return text.length > EXCERPT ? `${text.slice(0, EXCERPT - 1)}…` : text;
}

export function notificationRoutes({ db }: RouteDeps) {
  async function access(c: Context<AppEnv>) {
    const auth = requireAuth(c);
    const data = await loadAccess(db, {
      userId: auth.user.id,
      isAdmin: auth.user.isAdmin,
      groupIds: auth.groupIds,
    });
    return { auth, data };
  }

  /** Unread notifications on documents the reader can still view. */
  async function unread(data: AccessData, userId: string): Promise<number> {
    const rows = await db
      .select({ collectionId: documents.collectionId, unread: count() })
      .from(notifications)
      .innerJoin(documents, eq(documents.id, notifications.documentId))
      .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)))
      .groupBy(documents.collectionId);
    return rows
      .filter((row) => resolveDocLevel(data, row) !== "none")
      .reduce((sum, row) => sum + row.unread, 0);
  }

  return new Hono<AppEnv>()
    .get("/notifications", zValidate("query", notificationQuery), async (c) => {
      const { auth, data } = await access(c);
      const { cursor, limit } = c.req.valid("query");
      if (cursor !== undefined && !z.uuid().safeParse(cursor).success) {
        throw new AppError("validation_failed", 400, "Invalid cursor");
      }
      if (!cursor) await purgeOld(db, auth.user.id);

      const page = await db
        .select({ notification: notifications, document: documents })
        .from(notifications)
        .innerJoin(documents, eq(documents.id, notifications.documentId))
        .where(
          and(
            eq(notifications.recipientId, auth.user.id),
            cursor ? lt(notifications.id, cursor) : undefined,
          ),
        )
        .orderBy(desc(notifications.id))
        .limit(limit + 1);
      const more = page.length > limit;
      const raw = page.slice(0, limit);
      // Pages are cut before the access filter, so one can be short; the cursor stays exact.
      const rows = raw.filter((row) => resolveDocLevel(data, row.document) !== "none");

      const commentIds = rows.flatMap((r) =>
        r.notification.commentId ? [r.notification.commentId] : [],
      );
      const actorIds = [
        ...new Set(rows.flatMap((r) => (r.notification.actorId ? [r.notification.actorId] : []))),
      ];
      const templateIds = [...new Set(rows.map((r) => r.document.templateId))];
      const [commentRows, actorRows, templateRows] = await Promise.all([
        commentIds.length ? db.select().from(comments).where(inArray(comments.id, commentIds)) : [],
        actorIds.length
          ? db
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(inArray(users.id, actorIds))
          : [],
        templateIds.length
          ? db.select().from(templates).where(inArray(templates.id, templateIds))
          : [],
      ]);
      const commentById = new Map(commentRows.map((row) => [row.id, row]));
      const actors = new Map(actorRows.map((row) => [row.id, row]));
      const sectionTitles = new Map(
        templateRows.flatMap((t) =>
          definitionOf(t).sections.map((s) => [`${t.id}:${s.key}`, s.title] as const),
        ),
      );

      const items: NotificationView[] = rows.map(({ notification: n, document: d }) => {
        const comment = n.commentId ? commentById.get(n.commentId) : undefined;
        const status = z.enum(["draft", "in_review", "approved"]).safeParse(n.status);
        return {
          id: n.id,
          kind: n.kind,
          document: { id: d.id, title: d.title, docType: d.docType },
          sectionKey: n.sectionKey,
          sectionTitle: n.sectionKey
            ? (sectionTitles.get(`${d.templateId}:${n.sectionKey}`) ??
              retiredSectionTitle(n.sectionKey))
            : null,
          threadId: comment ? (comment.parentId ?? comment.id) : null,
          actor: (n.actorId && actors.get(n.actorId)) || null,
          excerpt: comment && !comment.deletedAt ? excerpt(comment.body) : null,
          status: status.success ? status.data : null,
          read: n.readAt !== null,
          createdAt: n.createdAt.toISOString(),
        };
      });
      const last = raw.at(-1);
      return c.json({
        items,
        nextCursor: more && last ? last.notification.id : null,
        unreadCount: await unread(data, auth.user.id),
      });
    })
    .get("/notifications/unread-count", async (c) => {
      const { auth, data } = await access(c);
      return c.json({ count: await unread(data, auth.user.id) });
    })
    .post("/notifications/read", zValidate("json", markReadRequest), async (c) => {
      const auth = requireAuth(c);
      const body = c.req.valid("json");
      auditExempt(c, "personal read state");
      await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.recipientId, auth.user.id),
            isNull(notifications.readAt),
            "ids" in body ? inArray(notifications.id, body.ids) : undefined,
          ),
        );
      return c.body(null, 204);
    })
    .get(
      "/documents/:id/mentionable",
      zValidate("param", idParam),
      zValidate("query", mentionableQuery),
      async (c) => {
        const { auth, data } = await access(c);
        const document = await viewableDocument(db, data, c.req.valid("param").id);
        if (!can(data.ctx, { action: "comment", collectionId: document.collectionId })) {
          throw new AppError("not_found", 404, "Document not found");
        }
        const q = escapeLike(c.req.valid("query").q.toLowerCase());
        const candidates = await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(
            and(
              eq(users.isActive, true),
              ne(users.id, auth.user.id),
              q
                ? or(
                    ilike(users.name, `${q}%`),
                    ilike(users.name, `% ${q}%`),
                    ilike(users.email, `${q}%`),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(users.name), asc(users.id))
          .limit(CANDIDATES);
        const contexts = await contextsFor(
          db,
          candidates.map((u) => u.id),
        );
        const items = candidates
          .filter((u) => {
            const ctx = contexts.get(u.id);
            return ctx !== undefined && resolveLevel(ctx, document.collectionId) !== "none";
          })
          .slice(0, MENTIONABLE);
        return c.json({ items });
      },
    );
}
