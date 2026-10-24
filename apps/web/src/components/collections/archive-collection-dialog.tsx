import type { CollectionSummary } from "@jangka/shared/access";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
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
import { collectionsKey } from "@/lib/collections";
import { errorMessage } from "@/lib/form-errors";

type ArchiveCollectionDialogProps = {
  collection: CollectionSummary | null;
  onClose: () => void;
};

/** Archives, then leaves the collection (to its parent, or home). */
export function ArchiveCollectionDialog({ collection, onClose }: ArchiveCollectionDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const archive = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/collections/${id}/archive`, { method: "POST", schema: z.undefined() }),
    onSuccess: async (_, id) => {
      const parentId = collection?.id === id ? collection.parentId : null;
      onClose();
      await (parentId
        ? navigate({ to: "/c/$collectionId", params: { collectionId: parentId } })
        : navigate({ to: "/" }));
      await queryClient.invalidateQueries({ queryKey: collectionsKey });
    },
  });

  const { reset } = archive;
  useEffect(() => {
    if (collection) reset();
  }, [collection, reset]);

  return (
    <Dialog open={collection !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Archive “{collection?.name}”?</DialogTitle>
          <DialogDescription>
            It disappears from the sidebar together with its sub-collections. Anyone with edit
            access can restore it from Archived.
          </DialogDescription>
        </DialogHeader>
        {archive.error && <ErrorBanner>{errorMessage(archive.error)}</ErrorBanner>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={archive.isPending}
            onClick={() => collection && archive.mutate(collection.id)}
          >
            Archive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
