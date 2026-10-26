import { z } from "zod";
import { documentStatus } from "./document";

const userRef = z.object({ id: z.string(), name: z.string() });
const sectionKey = z.string().regex(/^[a-z][a-z0-9_]*$/);
const body = z.string().trim().min(1, { error: "Write a comment" }).max(4000);

export const commentView = z.object({
  id: z.string(),
  sectionKey: z.string(),
  parentId: z.string().nullable(),
  author: userRef.nullable(),
  /** Null once deleted. */
  body: z.string().nullable(),
  deleted: z.boolean(),
  editedAt: z.string().nullable(),
  createdAt: z.string(),
  /** The viewer wrote it (may edit or delete it). */
  canEdit: z.boolean(),
});
export type CommentView = z.infer<typeof commentView>;

export const commentThread = z.object({
  root: commentView,
  replies: z.array(commentView),
  resolvedAt: z.string().nullable(),
  resolvedBy: userRef.nullable(),
  /** The viewer may resolve / reopen it (its author or an editor). */
  canResolve: z.boolean(),
});
export type CommentThread = z.infer<typeof commentThread>;

export const commentList = z.object({
  threads: z.array(commentThread),
  /** Open threads per section, whatever `state` was asked for. */
  openCountBySection: z.record(z.string(), z.number()),
});
export type CommentList = z.infer<typeof commentList>;

export const commentQuery = z.object({ state: z.enum(["open", "all"]).default("open") });

export const createCommentRequest = z.object({
  sectionKey,
  /** A root comment of the same section; omitted = a new thread. */
  parentId: z.uuid().optional(),
  body,
});
export const updateCommentRequest = z.object({ body });

export const setStatusRequest = z.object({ status: documentStatus });

/** draft → in review → approved, and back to draft. */
export const STATUS_TRANSITIONS = {
  draft: ["in_review"],
  in_review: ["approved", "draft"],
  approved: ["draft"],
} as const satisfies Record<
  z.infer<typeof documentStatus>,
  readonly z.infer<typeof documentStatus>[]
>;
