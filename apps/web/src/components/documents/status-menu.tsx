import { type DocumentSummary, documentSummary } from "@jangka/shared/document";
import { STATUS_TRANSITIONS } from "@jangka/shared/review";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api";
import { collectionsKey } from "@/lib/collections";
import { documentQuery } from "@/lib/documents";
import { errorMessage } from "@/lib/form-errors";
import { statusLabels, transitionLabels } from "@/lib/review";
import { cn } from "@/lib/utils";

type Status = DocumentSummary["status"];

const tone: Record<Status, string> = {
  draft: "border-border text-muted-foreground",
  in_review: "border-status-partial text-status-partial",
  approved: "border-status-complete text-status-complete",
};

/** `Draft ▾` (DESIGN §6.3): editors move the document through review; others see a badge. */
export function StatusMenu({
  document,
  editable,
}: {
  document: DocumentSummary;
  editable: boolean;
}) {
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
    },
    // e.g. "Resolve the open comments before approving" — short, so an alert is enough.
    onError: (error) => window.alert(errorMessage(error)),
  });
  const badge = cn(
    "flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs",
    tone[document.status],
  );

  if (!editable) return <span className={badge}>{statusLabels[document.status]}</span>;
  const next: readonly Status[] = STATUS_TRANSITIONS[document.status];
  const labels: Partial<Record<Status, string>> = transitionLabels[document.status];
  return (
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
  );
}
