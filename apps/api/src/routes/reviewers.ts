import { collections, documentReviewers, documents } from "@jangka/db";
import { AppError } from "@jangka/shared/errors";
import { type MyReview, setVerdictRequest } from "@jangka/shared/review";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { audit, auditExempt } from "../lib/audit";
import { requireAuth } from "../lib/session";
import { zValidate } from "../lib/validate";
import { loadAccess, ROOT_NAME, resolveDocLevel } from "../services/access";
import {
  lockDocument,
  requireDocEdit,
  requireNotApproved,
  viewableDocument,
} from "../services/documents";
import { notify } from "../services/notifications";
import { canReview, reviewersOf } from "../services/reviewers";
import type { AppEnv, RouteDeps } from "../types";

const idParam = z.object({ id: z.uuid() });
const reviewerParam = z.object({ id: z.uuid(), userId: z.uuid() });
const MY_REVIEWS = 200;

export function reviewerRoutes({ db, logger }: RouteDeps) {
  async function access(c: Context<AppEnv>) {
    const auth = requireAuth(c);
    const data = await loadAccess(db, {
      userId: auth.user.id,
      isAdmin: auth.user.isAdmin,
      groupIds: auth.groupIds,
    });
    return { auth, data };
  }

  return new Hono<AppEnv>()
    .get("/documents/:id/reviewers", zValidate("param", idParam), async (c) => {
      const { auth, data } = await access(c);
      const document = await viewableDocument(db, data, c.req.valid("param").id);
      const items = await reviewersOf(db, document);
      return c.json({
        items,
        canManage: resolveDocLevel(data, document) === "edit" && document.status !== "approved",
        isReviewer: items.some((r) => r.user.id === auth.user.id),
      });
    })
    .put("/documents/:id/reviewers/:userId", zValidate("param", reviewerParam), async (c) => {
      const { auth, data } = await access(c);
      const { id, userId } = c.req.valid("param");
      const document = await viewableDocument(db, data, id);
      requireDocEdit(data, document);
      if (!(await canReview(db, document, [userId])).has(userId)) {
        throw new AppError("validation_failed", 400, "This person can't view the document");
      }
      const added = await db.transaction(async (tx) => {
        requireNotApproved(await lockDocument(tx, document.id, "share"));
        const [row] = await tx
          .insert(documentReviewers)
          .values({ documentId: document.id, userId, assignedBy: auth.user.id })
          .onConflictDoNothing()
          .returning({ id: documentReviewers.id });
        return row;
      });
      if (!added) {
        auditExempt(c, "already a reviewer");
        return c.body(null, 204);
      }
      await audit(c, {
        action: "review.assign",
        targetType: "document",
        targetId: document.id,
        metadata: { userId },
      });
      if (document.status === "in_review") {
        await notify(db, logger, { document, actorId: auth.user.id }, [
          { recipientId: userId, kind: "review_requested" },
        ]);
      }
      return c.body(null, 204);
    })
    .delete("/documents/:id/reviewers/:userId", zValidate("param", reviewerParam), async (c) => {
      const { data } = await access(c);
      const { id, userId } = c.req.valid("param");
      const document = await viewableDocument(db, data, id);
      requireDocEdit(data, document);
      const removed = await db.transaction(async (tx) => {
        requireNotApproved(await lockDocument(tx, document.id, "share"));
        return tx
          .delete(documentReviewers)
          .where(
            and(
              eq(documentReviewers.documentId, document.id),
              eq(documentReviewers.userId, userId),
            ),
          )
          .returning({ id: documentReviewers.id });
      });
      if (removed.length === 0) {
        auditExempt(c, "not a reviewer");
        return c.body(null, 204);
      }
      await audit(c, {
        action: "review.unassign",
        targetType: "document",
        targetId: document.id,
        metadata: { userId },
      });
      return c.body(null, 204);
    })
    .post(
      "/documents/:id/review",
      zValidate("param", idParam),
      zValidate("json", setVerdictRequest),
      async (c) => {
        const { auth, data } = await access(c);
        const document = await viewableDocument(db, data, c.req.valid("param").id);
        const { verdict } = c.req.valid("json");
        // Under a share lock: an approval in progress either sees this verdict or finishes first.
        const row = await db.transaction(async (tx) => {
          const locked = await lockDocument(tx, document.id, "share");
          const [reviewer] = await tx
            .select()
            .from(documentReviewers)
            .where(
              and(
                eq(documentReviewers.documentId, document.id),
                eq(documentReviewers.userId, auth.user.id),
              ),
            );
          if (!reviewer) {
            throw new AppError("forbidden", 403, "You're not a reviewer of this document");
          }
          if (locked.status !== "in_review") {
            throw new AppError("conflict", 409, "The document isn't in review");
          }
          await tx
            .update(documentReviewers)
            .set({ verdict, decidedAt: new Date() })
            .where(eq(documentReviewers.id, reviewer.id));
          return reviewer;
        });
        await audit(c, {
          action: "review.verdict",
          targetType: "document",
          targetId: document.id,
          metadata: { verdict },
        });
        if (row.verdict !== verdict && document.createdBy) {
          await notify(db, logger, { document, actorId: auth.user.id }, [
            { recipientId: document.createdBy, kind: "review_verdict", status: verdict },
          ]);
        }
        return c.body(null, 204);
      },
    )
    .get("/reviews", async (c) => {
      const { auth, data } = await access(c);
      const rows = await db
        .select({ review: documentReviewers, document: documents, collection: collections })
        .from(documentReviewers)
        .innerJoin(documents, eq(documents.id, documentReviewers.documentId))
        .leftJoin(collections, eq(collections.id, documents.collectionId))
        .where(
          and(
            eq(documentReviewers.userId, auth.user.id),
            eq(documents.status, "in_review"),
            isNull(documents.archivedAt),
            or(isNull(documentReviewers.verdict), ne(documentReviewers.verdict, "approved")),
          ),
        )
        .orderBy(desc(documents.statusChangedAt), desc(documents.id))
        .limit(MY_REVIEWS);
      const items: MyReview[] = rows
        .filter((r) => resolveDocLevel(data, r.document) !== "none")
        .map(({ review, document, collection }) => ({
          id: document.id,
          title: document.title,
          docType: document.docType,
          collectionName: !collection
            ? ROOT_NAME
            : collection.personalOwnerId === auth.user.id
              ? "Personal"
              : collection.name,
          myVerdict: review.verdict,
          requestedAt: document.statusChangedAt?.toISOString() ?? null,
        }));
      return c.json({ items });
    });
}
