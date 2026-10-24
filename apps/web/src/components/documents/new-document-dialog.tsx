import { documentSummary } from "@jangka/shared/document";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { ErrorBanner } from "@/components/error-banner";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";
import { collectionsKey, collectionTreeQuery, editableDestinations } from "@/lib/collections";
import { errorMessage } from "@/lib/form-errors";

const ROOT_VALUE = "root";

type NewDocumentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  /** Preselected when editable; otherwise the user's Personal collection. */
  defaultCollectionId?: string | null;
};

export function NewDocumentDialog({
  open,
  onOpenChange,
  userId,
  defaultCollectionId,
}: NewDocumentDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const tree = useQuery({ ...collectionTreeQuery, enabled: open });
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState<string>("");
  const [titleError, setTitleError] = useState<string>();

  const options = tree.data
    ? editableDestinations(tree.data.items, tree.data.rootLevel === "edit", userId)
    : [];

  const create = useMutation({
    mutationFn: (input: { title: string; collectionId: string | null }) =>
      apiFetch("/documents", {
        method: "POST",
        body: { ...input, docType: "prd" },
        schema: documentSummary,
      }),
    onSuccess: async (doc) => {
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: collectionsKey });
      await navigate({ to: "/d/$documentId", params: { documentId: doc.id } });
    },
  });

  const { reset } = create;
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setTitleError(undefined);
    reset();
  }, [open, reset]);

  // Pick the default once the tree is loaded.
  useEffect(() => {
    if (!open || !tree.data) return;
    const items = tree.data.items;
    const editable = editableDestinations(items, tree.data.rootLevel === "edit", userId);
    const wanted = editable.find((o) => o.id === (defaultCollectionId ?? undefined));
    const personal = items.find((i) => i.personalOwnerId === userId);
    const fallback = wanted ?? editable.find((o) => o.id === personal?.id) ?? editable[0];
    setTarget(fallback ? (fallback.id ?? ROOT_VALUE) : "");
  }, [open, tree.data, defaultCollectionId, userId]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (title.trim() === "") return setTitleError("Required");
    if (!target) return;
    create.mutate({ title: title.trim(), collectionId: target === ROOT_VALUE ? null : target });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>New document</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {create.error && <ErrorBanner>{errorMessage(create.error)}</ErrorBanner>}
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Type</span>
            <div className="flex gap-2 text-[13px]">
              <span className="rounded-sm border border-primary px-3 py-1.5 font-medium text-primary">
                PRD · Product Requirements
              </span>
              <span className="rounded-sm border border-border px-3 py-1.5 text-muted-foreground">
                BRD, TSD — coming soon
              </span>
            </div>
          </div>
          <FormField
            id="document-title"
            label="Title"
            autoFocus
            maxLength={200}
            placeholder="Refund self-service"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            error={titleError}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="document-collection" className="text-[13px] font-medium">
              Collection
            </Label>
            <select
              id="document-collection"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="h-[38px] rounded-sm border border-input bg-card px-2 text-sm"
            >
              {tree.isPending && <option value="">Loading…</option>}
              {options.map((option) => (
                <option key={option.id ?? ROOT_VALUE} value={option.id ?? ROOT_VALUE}>
                  {"  ".repeat(option.depth)}
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !target}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
