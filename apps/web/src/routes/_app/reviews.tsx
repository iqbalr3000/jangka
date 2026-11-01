import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DocTypeBadge } from "@/components/documents/doc-type-badge";
import { ErrorBanner } from "@/components/error-banner";
import { LoadingRows } from "@/components/loading-rows";
import { errorMessage } from "@/lib/form-errors";
import { timeAgo } from "@/lib/llm";
import { myReviewsQuery, verdictLabels } from "@/lib/reviewers";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/reviews")({
  component: Reviews,
});

function Reviews() {
  const reviews = useQuery(myReviewsQuery);
  const items = reviews.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6 px-10 pt-7 pb-10">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Reviews</h1>
        <p className="max-w-[620px] text-sm text-muted-foreground">
          Documents in review that are waiting for your approval.
        </p>
      </header>

      {reviews.error && <ErrorBanner>{errorMessage(reviews.error)}</ErrorBanner>}
      {reviews.isPending && <LoadingRows />}
      {reviews.data && items.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing is waiting for your review.</p>
      )}
      {items.length > 0 && (
        <section
          aria-label="Waiting for my review"
          className="rounded-md border border-border bg-card"
        >
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0"
            >
              <DocTypeBadge docType={item.docType} />
              <Link
                to="/d/$documentId"
                params={{ documentId: item.id }}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {item.title}
              </Link>
              <span className="hidden truncate text-muted-foreground sm:inline">
                {item.collectionName}
              </span>
              <span
                className={cn(
                  "shrink-0 text-xs",
                  item.myVerdict ? "text-status-partial" : "text-muted-foreground",
                )}
              >
                {item.myVerdict ? verdictLabels[item.myVerdict] : "Pending"}
              </span>
              {item.requestedAt && (
                <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
                  {timeAgo(item.requestedAt)}
                </span>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
