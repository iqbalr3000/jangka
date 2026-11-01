import { comments, type Database, notifications, users } from "@jangka/db";
import { resolveLevel } from "@jangka/permissions";
import { mentionsIn, type NotificationKind } from "@jangka/shared/notifications";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Logger } from "../logger";
import { contextsFor } from "./access";

export const RETENTION_DAYS = 90;

type Source = {
  document: { id: string; collectionId: string | null };
  actorId: string;
};

export type NotificationEvent = {
  recipientId: string;
  kind: NotificationKind;
  sectionKey?: string;
  commentId?: string;
  status?: string;
};

const uuid = z.uuid();

/**
 * Inserts notifications for recipients who are active and can view the document. Never for the
 * actor; one per recipient, the first event wins (pass mentions before replies). A failure is
 * logged and swallowed: the action that caused it already happened.
 */
export async function notify(
  db: Database,
  logger: Logger,
  source: Source,
  events: NotificationEvent[],
): Promise<void> {
  try {
    const seen = new Set([source.actorId]);
    const wanted = events.filter((event) => {
      if (seen.has(event.recipientId) || !uuid.safeParse(event.recipientId).success) return false;
      seen.add(event.recipientId);
      return true;
    });
    if (wanted.length === 0) return;
    const active = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(
            users.id,
            wanted.map((event) => event.recipientId),
          ),
          eq(users.isActive, true),
        ),
      );
    const contexts = await contextsFor(
      db,
      active.map((row) => row.id),
    );
    const rows = wanted
      .filter((event) => {
        const ctx = contexts.get(event.recipientId);
        return ctx !== undefined && resolveLevel(ctx, source.document.collectionId) !== "none";
      })
      .map((event) => ({
        recipientId: event.recipientId,
        kind: event.kind,
        documentId: source.document.id,
        sectionKey: event.sectionKey ?? null,
        commentId: event.commentId ?? null,
        actorId: source.actorId,
        status: event.status ?? null,
      }));
    if (rows.length > 0) await db.insert(notifications).values(rows);
  } catch (error) {
    logger.error({ err: error, documentId: source.document.id }, "notifications not created");
  }
}

/** A new comment: its mentions, then (for a reply) the thread's root author and earlier repliers. */
export async function commentEvents(
  db: Database,
  comment: { id: string; sectionKey: string; parentId: string | null; body: string },
): Promise<NotificationEvent[]> {
  const base = { sectionKey: comment.sectionKey, commentId: comment.id };
  const mentions = mentionsIn(comment.body).map(
    (recipientId): NotificationEvent => ({ ...base, recipientId, kind: "mention" }),
  );
  if (!comment.parentId) return mentions;
  const thread = await db
    .select({ authorId: comments.authorId })
    .from(comments)
    .where(
      and(
        or(eq(comments.id, comment.parentId), eq(comments.parentId, comment.parentId)),
        isNull(comments.deletedAt),
      ),
    )
    .orderBy(comments.id);
  const replies = thread.map(
    (row): NotificationEvent => ({ ...base, recipientId: row.authorId, kind: "reply" }),
  );
  return [...mentions, ...replies];
}

/** Mentions added by an edit. */
export function editEvents(
  comment: { id: string; sectionKey: string },
  before: string,
  after: string,
): NotificationEvent[] {
  const earlier = new Set(mentionsIn(before));
  return mentionsIn(after)
    .filter((id) => !earlier.has(id))
    .map((recipientId) => ({
      recipientId,
      kind: "mention",
      sectionKey: comment.sectionKey,
      commentId: comment.id,
    }));
}

/** Drops the recipient's notifications past retention; runs when they load their list. */
export async function purgeOld(db: Database, recipientId: string): Promise<void> {
  await db
    .delete(notifications)
    .where(
      and(
        eq(notifications.recipientId, recipientId),
        lt(notifications.createdAt, sql`now() - make_interval(days => ${RETENTION_DAYS})`),
      ),
    );
}
