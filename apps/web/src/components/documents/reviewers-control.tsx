import type { DocumentSummary } from "@jangka/shared/document";
import type { ReviewerView, ReviewVerdict } from "@jangka/shared/review";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, UserPlus, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { z } from "zod";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { initials } from "@/lib/format";
import { mentionableQuery } from "@/lib/notifications";
import { myReviewsKey, reviewersQuery, verdictLabels } from "@/lib/reviewers";
import { cn } from "@/lib/utils";

const MAX_AVATARS = 3;

function reviewerState(r: ReviewerView): string {
  if (!r.counted) return "No access";
  return r.verdict ? verdictLabels[r.verdict] : "Pending";
}

function Avatar({ reviewer }: { reviewer: ReviewerView }) {
  return (
    <span
      className={cn(
        "relative flex size-7 items-center justify-center rounded-full border-2 border-card bg-secondary text-[10px] font-semibold",
        !reviewer.counted && "opacity-50",
      )}
    >
      {initials(reviewer.user.name)}
      {reviewer.counted && reviewer.verdict && (
        <span
          className={cn(
            "absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full border border-card",
            reviewer.verdict === "approved"
              ? "bg-status-complete text-white"
              : "bg-status-partial text-white",
          )}
        >
          {reviewer.verdict === "approved" ? (
            <Check className="size-2.5" strokeWidth={3} aria-hidden />
          ) : (
            <CircleAlert className="size-2.5" strokeWidth={3} aria-hidden />
          )}
        </span>
      )}
    </span>
  );
}

/** Header avatars of the document's reviewers; editors manage them, reviewers give verdicts. */
export function ReviewersControl({
  document,
  userId,
}: {
  document: DocumentSummary;
  userId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const list = useQuery(reviewersQuery(document.id));
  const reviewers = list.data?.items ?? [];
  const canManage = list.data?.canManage ?? false;
  const candidates = useQuery({
    ...mentionableQuery(document.id, search.trim()),
    enabled: open && canManage,
    placeholderData: keepPreviousData,
  });
  const assigned = new Set(reviewers.map((r) => r.user.id));
  const addable = (candidates.data?.items ?? []).filter((u) => !assigned.has(u.id));

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: reviewersQuery(document.id).queryKey });
    await queryClient.invalidateQueries({ queryKey: myReviewsKey });
  };
  const change = useMutation({
    mutationFn: ({ userId, method }: { userId: string; method: "PUT" | "DELETE" }) =>
      apiFetch(`/documents/${document.id}/reviewers/${userId}`, {
        method,
        schema: z.undefined(),
      }),
    onSuccess: refresh,
  });
  const decide = useMutation({
    mutationFn: (verdict: ReviewVerdict) =>
      apiFetch(`/documents/${document.id}/review`, {
        method: "POST",
        body: { verdict },
        schema: z.undefined(),
      }),
    onSuccess: refresh,
  });

  if (!list.data || (reviewers.length === 0 && !canManage)) return null;
  const mine = reviewers.find((r) => r.user.id === userId);
  const reviewing = mine !== undefined && document.status === "in_review";
  const shown = reviewers.slice(0, MAX_AVATARS);
  const summary = reviewers.length
    ? `Reviewers: ${reviewers.map((r) => `${r.user.name} (${reviewerState(r)})`).join(", ")}`
    : "Add reviewers";

  return (
    <div className="flex shrink-0 items-center gap-2">
      {reviewing && (
        <span className="flex items-center gap-1">
          <Button
            size="xs"
            variant={mine?.verdict === "approved" ? "default" : "outline"}
            aria-pressed={mine?.verdict === "approved"}
            disabled={decide.isPending}
            onClick={() => decide.mutate("approved")}
          >
            Approve
          </Button>
          <Button
            size="xs"
            variant={mine?.verdict === "changes_requested" ? "default" : "outline"}
            aria-pressed={mine?.verdict === "changes_requested"}
            disabled={decide.isPending}
            onClick={() => decide.mutate("changes_requested")}
          >
            Request changes
          </Button>
        </span>
      )}
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setSearch("");
            change.reset();
          }
        }}
      >
        <Popover.Trigger
          aria-label={summary}
          title={summary}
          className="flex items-center rounded-sm px-1 py-0.5 hover:bg-secondary data-[state=open]:bg-secondary"
        >
          {reviewers.length === 0 ? (
            <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
              <UserPlus className="size-3.5" aria-hidden />
              Reviewers
            </span>
          ) : (
            <span className="flex -space-x-1.5">
              {shown.map((r) => (
                <Avatar key={r.user.id} reviewer={r} />
              ))}
              {reviewers.length > MAX_AVATARS && (
                <span className="flex size-7 items-center justify-center rounded-full border-2 border-card bg-secondary text-[10px] font-semibold">
                  +{reviewers.length - MAX_AVATARS}
                </span>
              )}
            </span>
          )}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={8}
            collisionPadding={16}
            aria-label="Reviewers"
            className="z-50 flex w-[320px] max-w-[calc(100vw-32px)] flex-col gap-2 rounded-md border bg-popover p-3 text-[13px] text-popover-foreground shadow-float"
          >
            <span className="font-semibold">Reviewers</span>
            {decide.error && <ErrorBanner>{errorMessage(decide.error)}</ErrorBanner>}
            {change.error && <ErrorBanner>{errorMessage(change.error)}</ErrorBanner>}
            {reviewers.length === 0 ? (
              <p className="text-muted-foreground">
                Nobody yet. Every reviewer has to approve before the document can be approved.
              </p>
            ) : (
              <ul aria-label="Assigned reviewers" className="flex flex-col gap-1">
                {reviewers.map((r) => (
                  <li key={r.user.id} className="flex items-center gap-2">
                    <Avatar reviewer={r} />
                    <span className="min-w-0 flex-1 truncate">{r.user.name}</span>
                    <span
                      className={cn(
                        "text-xs",
                        !r.counted || !r.verdict
                          ? "text-muted-foreground"
                          : r.verdict === "approved"
                            ? "text-status-complete"
                            : "text-status-partial",
                      )}
                    >
                      {reviewerState(r)}
                    </span>
                    {canManage && (
                      <button
                        type="button"
                        aria-label={`Remove ${r.user.name}`}
                        disabled={change.isPending}
                        onClick={() => change.mutate({ userId: r.user.id, method: "DELETE" })}
                        className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canManage && (
              <div className="flex flex-col gap-1 border-t border-border pt-2">
                <Input
                  aria-label="Add reviewer"
                  placeholder="Add reviewer…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-8 text-[13px]"
                />
                <ul aria-label="People" className="flex max-h-48 flex-col overflow-y-auto">
                  {addable.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        disabled={change.isPending}
                        onClick={() => change.mutate({ userId: u.id, method: "PUT" })}
                        className="flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-secondary"
                      >
                        <span className="shrink-0 font-medium">{u.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{u.email}</span>
                      </button>
                    </li>
                  ))}
                  {candidates.data && addable.length === 0 && (
                    <li className="px-2 py-1.5 text-muted-foreground">
                      {search.trim() ? "No matches." : "No one else can view it."}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
