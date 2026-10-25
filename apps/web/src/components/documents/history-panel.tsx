import { toMarkdown } from "@jangka/export";
import {
  type Section,
  type SectionVersion,
  section as sectionSchema,
} from "@jangka/shared/document";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { ApiError, apiFetch } from "@/lib/api";
import { changeCount, lineDiff } from "@/lib/assistant";
import { errorMessage } from "@/lib/form-errors";
import { versionsKey, versionsQuery } from "@/lib/history";
import { timeAgo } from "@/lib/llm";
import { cn } from "@/lib/utils";

type HistoryPanelProps = {
  documentId: string;
  sections: Section[];
  editable: boolean;
  sectionKey: string;
  onSectionChange: (key: string) => void;
  /** The restored section, so the editor remounts with it. */
  onRestored: (section: Section) => void;
};

function sourceLabel(version: SectionVersion): string {
  if (version.restoredFromRevision !== null)
    return `Restored from r${version.restoredFromRevision}`;
  return version.source === "llm" ? "AI" : "Edited";
}

/** Versions of one section; a selected version shows its diff against the current text. */
export function HistoryPanel({
  documentId,
  sections,
  editable,
  sectionKey,
  onSectionChange,
  onRestored,
}: HistoryPanelProps) {
  const queryClient = useQueryClient();
  const current = sections.find((s) => s.key === sectionKey) ?? sections[0];
  const key = current?.key ?? sectionKey;
  const versions = useQuery(versionsQuery(documentId, key));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const selected = versions.data?.items.find((v) => v.id === selectedId) ?? null;

  const restore = useMutation({
    mutationFn: (version: SectionVersion) =>
      apiFetch(`/documents/${documentId}/sections/${key}/restore`, {
        method: "POST",
        body: { versionId: version.id, revision: current?.revision ?? 0 },
        schema: sectionSchema,
      }),
    onSuccess: async (restored) => {
      setConfirming(false);
      setSelectedId(null);
      onRestored(restored);
      await queryClient.invalidateQueries({ queryKey: versionsKey(documentId, key) });
    },
  });

  if (!current) return null;
  const currentMarkdown = toMarkdown(current.content);
  const diff = selected ? lineDiff(toMarkdown(selected.content), currentMarkdown) : [];
  const restoreError =
    restore.error instanceof ApiError && restore.error.code === "revision_conflict"
      ? "This section changed while you were looking. Reload the page and try again."
      : restore.error && errorMessage(restore.error);

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[13px]">
      <div className="border-b border-border px-4 py-2.5">
        <label className="sr-only" htmlFor="history-section">
          Section
        </label>
        <select
          id="history-section"
          value={key}
          onChange={(event) => {
            setSelectedId(null);
            onSectionChange(event.target.value);
          }}
          className="h-8 w-full rounded-sm border border-input bg-card px-2"
        >
          {sections.map((s) => (
            <option key={s.key} value={s.key}>
              {s.title}
            </option>
          ))}
        </select>
      </div>
      <ol className="flex flex-col overflow-auto border-b border-border" aria-label="Versions">
        <li className="flex items-center gap-2 px-4 py-2 font-medium">
          <span className="font-mono text-[11px] text-muted-foreground">r{current.revision}</span>
          Current
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {current.updatedBy?.name ?? ""} · {timeAgo(current.updatedAt)}
          </span>
        </li>
        {versions.isPending && (
          <li className="px-4 py-2">
            <LoadingRows />
          </li>
        )}
        {versions.data?.items.length === 0 && (
          <li className="px-4 py-2 text-muted-foreground">No earlier versions yet.</li>
        )}
        {versions.data?.items.map((version) => (
          <li key={version.id}>
            <button
              type="button"
              aria-pressed={version.id === selectedId}
              onClick={() => setSelectedId(version.id === selectedId ? null : version.id)}
              className={cn(
                "flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-secondary",
                version.id === selectedId && "bg-secondary",
              )}
            >
              <span className="font-mono text-[11px] text-muted-foreground">
                r{version.revision}
              </span>
              <span className="rounded-sm border border-border px-1 text-[11px]">
                {sourceLabel(version)}
              </span>
              <span className="ml-auto truncate text-xs text-muted-foreground">
                {version.createdBy?.name ?? ""} · {timeAgo(version.createdAt)}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {versions.error && (
        <div className="p-4">
          <ErrorBanner>{errorMessage(versions.error)}</ErrorBanner>
        </div>
      )}
      {selected && (
        <section
          aria-label="Changes since this version"
          className="flex min-h-0 flex-1 flex-col gap-2 p-4"
        >
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">
              r{selected.revision} → current · {changeCount(diff)} change
              {changeCount(diff) === 1 ? "" : "s"}
            </span>
            {editable && selected.revision !== current.revision && (
              <Button size="xs" className="ml-auto" onClick={() => setConfirming(true)}>
                Restore this version
              </Button>
            )}
          </div>
          <div className="flex min-h-0 flex-col overflow-auto rounded-sm border border-border font-mono text-xs leading-relaxed">
            {changeCount(diff) === 0 && (
              <p className="px-3 py-2 text-muted-foreground">Same as the current text.</p>
            )}
            {changeCount(diff) > 0 &&
              diff.map((line, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no identity beyond position
                  key={i}
                  className={cn(
                    "px-3 whitespace-pre-wrap",
                    line.kind === "add" && "bg-diff-add",
                    line.kind === "del" && "bg-diff-del line-through decoration-destructive/40",
                  )}
                >
                  {line.kind === "add" ? "+ " : line.kind === "del" ? "- " : "  "}
                  {line.text || " "}
                </div>
              ))}
          </div>
        </section>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Restore r{selected?.revision}?</DialogTitle>
            <DialogDescription>
              “{current.title}” goes back to this version. The current text stays in the history.
            </DialogDescription>
          </DialogHeader>
          {restoreError && <ErrorBanner>{restoreError}</ErrorBanner>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              disabled={restore.isPending || !selected}
              onClick={() => selected && restore.mutate(selected)}
            >
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
