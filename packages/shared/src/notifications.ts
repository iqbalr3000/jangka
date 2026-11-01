import { z } from "zod";
import { documentRef, documentStatus } from "./document";

export const notificationKind = z.enum(["mention", "reply", "resolved", "status"]);
export type NotificationKind = z.infer<typeof notificationKind>;

export const notificationView = z.object({
  id: z.string(),
  kind: notificationKind,
  document: documentRef,
  sectionKey: z.string().nullable(),
  sectionTitle: z.string().nullable(),
  /** The thread root, so the panel can open on it. */
  threadId: z.string().nullable(),
  actor: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** The comment as it reads now, mentions as `@Name`; null when deleted or not a comment. */
  excerpt: z.string().nullable(),
  /** The new status, for `status`. */
  status: documentStatus.nullable(),
  read: z.boolean(),
  createdAt: z.string(),
});
export type NotificationView = z.infer<typeof notificationView>;

export const notificationList = z.object({
  items: z.array(notificationView),
  nextCursor: z.string().nullable(),
  unreadCount: z.number(),
});
export type NotificationList = z.infer<typeof notificationList>;

export const notificationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export const unreadCount = z.object({ count: z.number() });

export const markReadRequest = z.union([
  z.object({ ids: z.array(z.uuid()).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
]);

export const mentionableQuery = z.object({ q: z.string().trim().max(100).default("") });
export const mentionableUser = z.object({ id: z.string(), name: z.string(), email: z.string() });
export const mentionableList = z.object({ items: z.array(mentionableUser) });
export type MentionableUser = z.infer<typeof mentionableUser>;

const MENTION = /@\[([^\]\n]{1,100})\]\(user:([0-9a-f-]{36})\)/gi;

/** The token stored in a comment body; brackets in the name would break it, so they're dropped. */
export function mentionToken(user: { id: string; name: string }): string {
  const name = user.name.replace(/[[\]\n]/g, "").trim() || "user";
  return `@[${name}](user:${user.id})`;
}

export type BodyPart = { text: string } | { mention: { id: string; name: string } };

/** Comment body → plain text runs and mentions; the renderer escapes text as usual. */
export function bodyParts(body: string): BodyPart[] {
  const parts: BodyPart[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION)) {
    const [token, name, id] = match;
    if (match.index > last) parts.push({ text: body.slice(last, match.index) });
    parts.push({ mention: { id: (id ?? "").toLowerCase(), name: name ?? "" } });
    last = match.index + token.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

/** Distinct user ids mentioned in a body, in order of appearance. */
export function mentionsIn(body: string): string[] {
  const ids = bodyParts(body).flatMap((part) => ("mention" in part ? [part.mention.id] : []));
  return [...new Set(ids)];
}

/** The body as people read it: mentions as `@Name`. */
export function plainBody(body: string): string {
  return bodyParts(body)
    .map((part) => ("mention" in part ? `@${part.mention.name}` : part.text))
    .join("");
}
