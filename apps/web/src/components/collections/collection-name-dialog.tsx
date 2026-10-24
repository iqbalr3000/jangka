import { collectionSummary } from "@jangka/shared/access";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { ErrorBanner } from "@/components/error-banner";
import { FormField } from "@/components/form-field";
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

export type CollectionNameTarget =
  | { kind: "create"; parentId: string | null; parentName: string }
  | { kind: "rename"; id: string; name: string };

type CollectionNameDialogProps = {
  target: CollectionNameTarget | null;
  onClose: () => void;
};

/** Create a collection (then open it) or rename one. */
export function CollectionNameDialog({ target, onClose }: CollectionNameDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");

  const save = useMutation({
    mutationFn: async (input: { target: CollectionNameTarget; name: string }) =>
      input.target.kind === "create"
        ? apiFetch("/collections", {
            method: "POST",
            body: { name: input.name, parentId: input.target.parentId },
            schema: collectionSummary,
          })
        : apiFetch(`/collections/${input.target.id}`, {
            method: "PATCH",
            body: { name: input.name },
            schema: collectionSummary,
          }),
    onSuccess: async (collection, input) => {
      await queryClient.invalidateQueries({ queryKey: collectionsKey });
      onClose();
      if (input.target.kind === "create") {
        await navigate({ to: "/c/$collectionId", params: { collectionId: collection.id } });
      }
    },
  });

  const { reset } = save;
  useEffect(() => {
    setName(target?.kind === "rename" ? target.name : "");
    reset();
  }, [target, reset]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!target || name.trim() === "") return;
    save.mutate({ target, name: name.trim() });
  }

  const creating = target?.kind === "create";
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{creating ? "New collection" : "Rename collection"}</DialogTitle>
          {target?.kind === "create" && (
            <DialogDescription>Inside {target.parentName}.</DialogDescription>
          )}
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {save.error && <ErrorBanner>{errorMessage(save.error)}</ErrorBanner>}
          <FormField
            id="collection-name"
            label="Name"
            autoFocus
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || name.trim() === ""}>
              {creating ? "Create" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
