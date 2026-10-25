import { commentList } from "@jangka/shared/review";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./api";

export const commentsKey = (documentId: string) => ["documents", documentId, "comments"] as const;

export const commentsQuery = (documentId: string, state: "open" | "all") =>
  queryOptions({
    queryKey: [...commentsKey(documentId), state],
    queryFn: () =>
      apiFetch(`/documents/${documentId}/comments?state=${state}`, { schema: commentList }),
  });

export const statusLabels = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
} as const;

export const transitionLabels = {
  draft: { in_review: "Request review" },
  in_review: { approved: "Approve", draft: "Back to draft" },
  approved: { draft: "Reopen" },
} as const;
