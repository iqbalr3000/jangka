import { myReviewList, reviewerList } from "@jangka/shared/review";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./api";
import { documentsKey } from "./documents";

/** Under the document's key, so status changes refresh verdicts too. */
export const reviewersQuery = (documentId: string) =>
  queryOptions({
    queryKey: [...documentsKey, documentId, "reviewers"],
    queryFn: () => apiFetch(`/documents/${documentId}/reviewers`, { schema: reviewerList }),
  });

export const myReviewsKey = ["reviews"] as const;

/** Polled with the notification badge for the sidebar count. */
export const myReviewsQuery = queryOptions({
  queryKey: myReviewsKey,
  queryFn: () => apiFetch("/reviews", { schema: myReviewList }),
  refetchInterval: 60_000,
  refetchOnWindowFocus: true,
});

export const verdictLabels = {
  approved: "Approved",
  changes_requested: "Changes requested",
} as const;
