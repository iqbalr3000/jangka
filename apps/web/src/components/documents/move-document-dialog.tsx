import { type DocumentSummary, documentSummary } from "@jangka/shared/document";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import {
  collectionsKey,
  collectionTreeQuery,
  type DestinationOption,
  editableDestinations,
} from "@/lib/collections";
import { documentsKey } from "@/lib/documents";
import { errorMessage } from "@/lib/form-errors";
import { cn } from "@/lib/utils";

type MoveDocumentDialogProps = {
  document: DocumentSummary | null;
  userId: string;
  onClose: () => void;
};

export function MoveDocumentDialog({ document, userId, onClose }: MoveDocumentDialogProps) {
  const queryClient = useQueryClient();
  const tree = useQuery({ ...collectionTreeQuery, enabled: document !== null });
  const [selected, setSelected] = useState<DestinationOption | null>(null);

  const move = useMutation({
    mutationFn: (input: { id: string; collectionId: string | null }) =>
      apiFetch(`/documents/${input.id}/move`, {
        method: "POST",
        body: { collectionId: input.collectionId },
        schema: documentSummary,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: collectionsKey });
      await queryClient.invalidateQueries({ queryKey: documentsKey });
      onClose();
    },
  });

  const { reset } = move;
  useEffect(() => {
    if (document) {
      setSelected(null);
      reset();
    }
  }, [document, reset]);

  const options = tree.data
    ? editableDestinations(tree.data.items, tree.data.rootLevel === "edit", userId)
    : [];

  return (
    <Dialog open={document !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Move “{document?.title}”</DialogTitle>
          <DialogDescription>
            Only collections you can edit are listed. Access follows the new collection.
          </DialogDescription>
        </DialogHeader>
        {move.error && <ErrorBanner>{errorMessage(move.error)}</ErrorBanner>}
        <div
          role="listbox"
          aria-label="Destination"
          className="max-h-72 overflow-auto rounded-sm border border-border bg-card py-1 text-sm"
        >
          {tree.isPending && <p className="px-3 py-2 text-muted-foreground">Loading…</p>}
          {options.map((option) => {
            const current = option.id === document?.collectionId;
            return (
              <button
                key={option.id ?? "root"}
                type="button"
                role="option"
                aria-selected={selected?.id === option.id}
                disabled={current}
                onClick={() => setSelected(option)}
                style={{ paddingLeft: 12 + option.depth * 16 }}
                className={cn(
                  "flex w-full items-center gap-2 py-1.5 pr-3 text-left hover:bg-secondary disabled:opacity-50",
                  selected !== null &&
                    selected.id === option.id &&
                    "bg-secondary font-medium text-primary",
                )}
              >
                <span className="truncate">{option.label}</span>
                {current && <span className="text-xs text-muted-foreground">current</span>}
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!document || selected === null || move.isPending}
            onClick={() =>
              document && selected && move.mutate({ id: document.id, collectionId: selected.id })
            }
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
