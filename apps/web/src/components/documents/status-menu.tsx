import { type DocumentSummary, documentSummary, type Section } from "@jangka/shared/document";
import { pendingReviewsDetails, STATUS_TRANSITIONS } from "@jangka/shared/review";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError, apiFetch } from "@/lib/api";
import { collectionsKey } from "@/lib/collections";
import { documentQuery } from "@/lib/documents";
import { errorMessage } from "@/lib/form-errors";
import { statusLabels, transitionLabels } from "@/lib/review";
import { myReviewsKey } from "@/lib/reviewers";
import { cn } from "@/lib/utils";

type Status = DocumentSummary["status"];

type StatusMenuProps = {
  document: DocumentSummary;
  editable: boolean;
  sections: Section[];
  /** Opens the Comments tab on a section (approval blocked by open threads). */
  onShowComments: (sectionKey: string) => void;
};

const tone: Record<Status, string> = {
  draft: "border-border text-muted-foreground",
  in_review: "border-status-partial text-status-partial",
  approved: "border-status-complete text-status-complete",
};

const openCommentsDetails = z.object({ sections: z.array(z.string()) });

type Blocker =
  | { kind: "comments"; sections: string[] }
  | { kind: "reviews"; reviewers: { id: string; name: string }[] };

/** Why the server refused an approval; null for other errors. */
function blockerOf(error: unknown): Blocker | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === "open_comments") {
    const parsed = openCommentsDetails.safeParse(error.details);
    return { kind: "comments", sections: parsed.success ? parsed.data.sections : [] };
  }
  if (error.code === "pending_reviews") {
    const parsed = pendingReviewsDetails.safeParse(error.details);
    return { kind: "reviews", reviewers: parsed.success ? parsed.data.reviewers : [] };
  }
  return null;
}

/** Editors move the document through review; others see a badge. */
export function StatusMenu({ document, editable, sections, onShowComments }: StatusMenuProps) {
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (status: Status) =>
      apiFetch(`/documents/${document.id}/status`, {
        method: "POST",
        body: { status },
        schema: documentSummary,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: documentQuery(document.id).queryKey });
      await queryClient.invalidateQueries({ queryKey: collectionsKey });
      await queryClient.invalidateQueries({ queryKey: myReviewsKey });
    },
  });
  const badge = cn(
    "flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs",
    tone[document.status],
  );

  if (!editable) return <span className={badge}>{statusLabels[document.status]}</span>;
  const next: readonly Status[] = STATUS_TRANSITIONS[document.status];
  const labels: Partial<Record<Status, string>> = transitionLabels[document.status];
  const blocker = blockerOf(change.error);
  const titles = new Map(sections.map((s) => [s.key, s.title]));
  const close = () => change.reset();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={badge}
          aria-label={`Status: ${statusLabels[document.status]}`}
        >
          {statusLabels[document.status]}
          <ChevronDown className="size-3" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="text-[13px]">
          {next.map((status) => (
            <DropdownMenuItem
              key={status}
              disabled={change.isPending}
              onSelect={() => change.mutate(status)}
            >
              {labels[status] ?? statusLabels[status]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={change.isError} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {blocker?.kind === "comments"
                ? "Resolve comments before approving"
                : blocker?.kind === "reviews"
                  ? "Waiting for reviewers"
                  : "Couldn't change the status"}
            </DialogTitle>
            <DialogDescription>
              {blocker?.kind === "comments"
                ? "These sections still have open review threads:"
                : blocker?.kind === "reviews"
                  ? "Every reviewer has to approve first. Still to approve:"
                  : errorMessage(change.error)}
            </DialogDescription>
          </DialogHeader>
          {blocker && (
            <ul className="flex flex-col gap-1 text-sm">
              {(blocker.kind === "comments"
                ? blocker.sections.map((key) => ({ id: key, label: titles.get(key) ?? key }))
                : blocker.reviewers.map((r) => ({ id: r.id, label: r.name }))
              ).map((item) => (
                <li key={item.id} className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-status-partial" aria-hidden />
                  {item.label}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
            {blocker?.kind === "comments" && (
              <Button
                onClick={() => {
                  close();
                  onShowComments(blocker.sections[0] ?? "");
                }}
              >
                Show comments
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
