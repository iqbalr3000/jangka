import { type DocumentDetail, documentSummary } from "@jangka/shared/document";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api";
import { collectionsKey, ROOT_NAME } from "@/lib/collections";
import { documentsKey } from "@/lib/documents";
import { errorMessage } from "@/lib/form-errors";
import { modKeyLabel } from "@/lib/keyboard";
import { timeAgo } from "@/lib/llm";
import { DocTypeBadge } from "./doc-type-badge";
import { MoveDocumentDialog } from "./move-document-dialog";

export type SaveSummary = {
  state: "idle" | "saving" | "saved" | "error" | "conflict";
  at: string | null;
};

type DocumentHeaderProps = {
  detail: DocumentDetail;
  userId: string;
  save: SaveSummary;
  /** Assistant controls (Draft all / progress / Stop). */
  actions?: ReactNode;
  /** Opens the export dialog; viewers can export too. */
  onExport: () => void;
};

const saveText = (save: SaveSummary) => {
  switch (save.state) {
    case "saving":
      return "Saving…";
    case "error":
      return "Not saved";
    case "conflict":
      return "Conflict — see section";
    default:
      return save.at ? `Saved · ${timeAgo(save.at)}` : "";
  }
};

export function DocumentHeader({ detail, userId, save, actions, onExport }: DocumentHeaderProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { document: doc, collection, level } = detail;
  const [title, setTitle] = useState(doc.title);
  const [moving, setMoving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const editable = level === "edit";

  useEffect(() => setTitle(doc.title), [doc.title]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: documentsKey });
    await queryClient.invalidateQueries({ queryKey: collectionsKey });
  };

  const rename = useMutation({
    mutationFn: (next: string) =>
      apiFetch(`/documents/${doc.id}`, {
        method: "PATCH",
        body: { title: next },
        schema: documentSummary,
      }),
    onSuccess: invalidate,
    onError: () => setTitle(doc.title),
  });

  const archive = useMutation({
    mutationFn: () =>
      apiFetch(`/documents/${doc.id}/archive`, { method: "POST", schema: z.undefined() }),
    onSuccess: async () => {
      setArchiving(false);
      await invalidate();
      await (collection
        ? navigate({ to: "/c/$collectionId", params: { collectionId: collection.id } })
        : navigate({ to: "/" }));
    },
  });

  function commitTitle() {
    const next = title.trim();
    if (!next || next === doc.title) return setTitle(doc.title);
    rename.mutate(next);
  }

  const backLabel = collection
    ? collection.personalOwnerId === userId
      ? "Personal"
      : collection.name
    : ROOT_NAME;

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-2.5">
      {collection ? (
        <Link
          to="/c/$collectionId"
          params={{ collectionId: collection.id }}
          className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {backLabel}
        </Link>
      ) : (
        <Link
          to="/"
          className="flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {backLabel}
        </Link>
      )}
      <DocTypeBadge docType={doc.docType} />
      <input
        aria-label="Document title"
        value={title}
        readOnly={!editable}
        maxLength={200}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={commitTitle}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setTitle(doc.title);
            event.currentTarget.blur();
          }
        }}
        className="min-w-0 flex-1 truncate rounded-sm bg-transparent px-1 py-0.5 text-[15px] font-semibold outline-none hover:bg-secondary focus:bg-secondary read-only:hover:bg-transparent"
      />
      <span className="rounded-sm border border-border px-2 py-0.5 text-xs text-muted-foreground">
        Draft
      </span>
      {actions}
      <Button size="sm" variant="outline" onClick={onExport} title={`Export (${modKeyLabel}⇧E)`}>
        Export
      </Button>
      <span
        className="w-36 text-right text-xs text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {saveText(save)}
      </span>
      {editable && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary"
            aria-label="Document actions"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="text-[13px]">
            <DropdownMenuItem onSelect={() => setMoving(true)}>Move…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setArchiving(true)}>
              Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <MoveDocumentDialog
        document={moving ? doc : null}
        userId={userId}
        onClose={() => setMoving(false)}
      />
      <Dialog open={archiving} onOpenChange={setArchiving}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Archive “{doc.title}”?</DialogTitle>
            <DialogDescription>
              It disappears from its collection. Anyone with edit access can restore it from
              Archived.
            </DialogDescription>
          </DialogHeader>
          {archive.error && <ErrorBanner>{errorMessage(archive.error)}</ErrorBanner>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiving(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={archive.isPending}
              onClick={() => archive.mutate()}
            >
              Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
