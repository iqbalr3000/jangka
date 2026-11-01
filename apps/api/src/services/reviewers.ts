import { type Database, documentReviewers, type Transaction, users } from "@jangka/db";
import { resolveLevel } from "@jangka/permissions";
import type { ReviewerView } from "@jangka/shared/review";
import { and, asc, eq, inArray } from "drizzle-orm";
import { contextsFor } from "./access";

type Db = Database | Transaction;
type Document = { id: string; collectionId: string | null };

/** Active and able to view the document: whether a user may review it (and still counts). */
export async function canReview(
  db: Db,
  document: Document,
  userIds: readonly string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const candidates = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, [...userIds]), eq(users.isActive, true)))
  ).map((u) => u.id);
  const contexts = await contextsFor(db, candidates);
  return new Set(
    candidates.filter((id) => {
      const ctx = contexts.get(id);
      return ctx !== undefined && resolveLevel(ctx, document.collectionId) !== "none";
    }),
  );
}

/** Reviewers in assignment order; `counted` = their verdict gates approval. */
export async function reviewersOf(db: Db, document: Document): Promise<ReviewerView[]> {
  const rows = await db
    .select({
      userId: documentReviewers.userId,
      name: users.name,
      verdict: documentReviewers.verdict,
      decidedAt: documentReviewers.decidedAt,
    })
    .from(documentReviewers)
    .innerJoin(users, eq(users.id, documentReviewers.userId))
    .where(eq(documentReviewers.documentId, document.id))
    .orderBy(asc(documentReviewers.id));
  const counted = await canReview(
    db,
    document,
    rows.map((r) => r.userId),
  );
  return rows.map((r) => ({
    user: { id: r.userId, name: r.name },
    verdict: r.verdict,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    counted: counted.has(r.userId),
  }));
}

/** Counted reviewers who haven't approved yet. */
export async function pendingReviewers(
  db: Db,
  document: Document,
): Promise<{ id: string; name: string }[]> {
  return (await reviewersOf(db, document))
    .filter((r) => r.counted && r.verdict !== "approved")
    .map((r) => r.user);
}

/** A new round: back to draft clears every verdict. */
export async function clearVerdicts(db: Db, documentId: string): Promise<void> {
  await db
    .update(documentReviewers)
    .set({ verdict: null, decidedAt: null })
    .where(eq(documentReviewers.documentId, documentId));
}
