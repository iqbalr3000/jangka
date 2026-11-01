import { z } from "zod";
import { docTypeSchema, documentStatus } from "./document";

const userRef = z.object({ id: z.string(), name: z.string() });
const sectionKey = z.string().regex(/^[a-z][a-z0-9_]*$/);
const body = z.string().trim().min(1, { error: "Write a comment" }).max(4000);

export const QUOTE_MAX = 500;
export const QUOTE_CONTEXT = 32;

/** The words a root comment is about, with context to tell repeated phrases apart. */
export const commentAnchor = z.object({
  quote: z.string().min(1).max(QUOTE_MAX),
  prefix: z.string().max(QUOTE_CONTEXT),
  suffix: z.string().max(QUOTE_CONTEXT),
});
export type CommentAnchor = z.infer<typeof commentAnchor>;

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
  anchor: commentAnchor.nullable(),
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
  /** Roots only. */
  anchor: commentAnchor.optional(),
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

export const reviewVerdict = z.enum(["approved", "changes_requested"]);
export type ReviewVerdict = z.infer<typeof reviewVerdict>;

export const reviewerView = z.object({
  user: userRef,
  verdict: reviewVerdict.nullable(),
  decidedAt: z.string().nullable(),
  /** Active and still able to view: their verdict gates approval. */
  counted: z.boolean(),
});
export type ReviewerView = z.infer<typeof reviewerView>;

export const reviewerList = z.object({
  items: z.array(reviewerView),
  /** The viewer may assign and remove reviewers. */
  canManage: z.boolean(),
  /** The viewer is a reviewer of this document. */
  isReviewer: z.boolean(),
});
export type ReviewerList = z.infer<typeof reviewerList>;

export const setVerdictRequest = z.object({ verdict: reviewVerdict });

export const myReview = z.object({
  id: z.string(),
  title: z.string(),
  docType: docTypeSchema,
  collectionName: z.string(),
  myVerdict: reviewVerdict.nullable(),
  /** When it entered review. */
  requestedAt: z.string().nullable(),
});
export type MyReview = z.infer<typeof myReview>;
export const myReviewList = z.object({ items: z.array(myReview) });

/** `409 pending_reviews` details. */
export const pendingReviewsDetails = z.object({ reviewers: z.array(userRef) });
