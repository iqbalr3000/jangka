import { type CollectionSummary, collectionSummary } from "@jangka/shared/access";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ErrorBanner } from "@/components/error-banner";
import { LoadingRows } from "@/components/loading-rows";
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
import { errorMessage } from "@/lib/form-errors";
import { cn } from "@/lib/utils";

type MoveCollectionDialogProps = {
  collection: CollectionSummary | null;
  userId: string;
  onClose: () => void;
};

function inPersonalTree(items: CollectionSummary[], id: string): boolean {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (let node = byId.get(id); node; node = node.parentId ? byId.get(node.parentId) : undefined) {
    if (node.personalOwnerId !== null) return true;
  }
  return false;
}

export function MoveCollectionDialog({ collection, userId, onClose }: MoveCollectionDialogProps) {
  const queryClient = useQueryClient();
  const tree = useQuery({ ...collectionTreeQuery, enabled: collection !== null });
  const [selected, setSelected] = useState<DestinationOption | null>(null);

  const move = useMutation({
    mutationFn: (input: { id: string; parentId: string | null }) =>
      apiFetch(`/collections/${input.id}`, {
        method: "PATCH",
        body: { parentId: input.parentId },
        schema: collectionSummary,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: collectionsKey });
      onClose();
    },
  });

  const { reset } = move;
  useEffect(() => {
    if (collection) {
      setSelected(null);
      reset();
    }
  }, [collection, reset]);

  const movingFromShared =
    collection !== null &&
    tree.data !== undefined &&
    !inPersonalTree(tree.data.items, collection.id);
  const options =
    collection && tree.data
      ? editableDestinations(tree.data.items, tree.data.rootLevel === "edit", userId, collection.id)
      : [];

  return (
    <Dialog open={collection !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Move “{collection?.name}”</DialogTitle>
          <DialogDescription>
            Only collections you can edit are listed. Access is inherited from the new location.
          </DialogDescription>
        </DialogHeader>
        {move.error && <ErrorBanner>{errorMessage(move.error)}</ErrorBanner>}
        <div
          role="listbox"
          aria-label="Destination"
          className="max-h-72 overflow-auto rounded-sm border border-border bg-card py-1 text-sm"
        >
          {tree.isPending && <LoadingRows className="px-3 py-2" />}
          {tree.data && options.length === 0 && (
            <p className="px-3 py-2 text-muted-foreground">No other collection you can edit.</p>
          )}
          {options.map((option) => {
            const current = option.id === collection?.parentId;
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
        {selected?.personal && movingFromShared && (
          <p className="text-[13px] text-status-partial">
            Personal collections can't be shared: group access set on this collection and its
            sub-collections will be removed.
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!collection || selected === null || move.isPending}
            onClick={() =>
              collection && selected && move.mutate({ id: collection.id, parentId: selected.id })
            }
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
