import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { changeCount, lineDiff } from "@/lib/assistant";
import { modKeyLabel } from "@/lib/keyboard";
import type { Proposal } from "@/lib/use-assistant";
import { cn } from "@/lib/utils";

type ReviseProposalProps = {
  current: string;
  proposal: Proposal;
  busy: boolean;
  onDiscard: () => void;
  onEdit: () => void;
  onAccept: () => void;
};

/** Inline diff of a proposed revision: the document stays visible around it. */
export function ReviseProposal({
  current,
  proposal,
  busy,
  onDiscard,
  onEdit,
  onAccept,
}: ReviseProposalProps) {
  const ready = proposal.status === "ready";
  const diff = lineDiff(current, proposal.markdown);
  const changes = changeCount(diff);

  useEffect(() => {
    if (!ready) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDiscard();
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) onAccept();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ready, onDiscard, onAccept]);

  return (
    <section
      aria-label="Proposed revision"
      className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
    >
      <div className="flex items-baseline gap-2 text-[13px]">
        <span className="font-medium">Revise</span>
        <span className="truncate text-muted-foreground">
          Instruction: “{proposal.instruction}”
        </span>
      </div>
      <div className="flex flex-col overflow-x-auto rounded-sm border border-border font-mono text-[13px] leading-relaxed">
        {diff.length === 0 && (
          <p className="px-3 py-2 text-muted-foreground">Waiting for the proposal…</p>
        )}
        {diff.map((line, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no identity beyond position
            key={i}
            className={cn(
              "px-3 whitespace-pre-wrap",
              line.kind === "add" && "bg-diff-add",
              line.kind === "del" && "bg-diff-del text-muted-foreground line-through",
            )}
          >
            <span className="mr-2 select-none" aria-hidden>
              {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
            </span>
            <span className="sr-only">
              {line.kind === "add" ? "Added: " : line.kind === "del" ? "Removed: " : ""}
            </span>
            {line.text || " "}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-xs text-muted-foreground">
          {ready
            ? `${changes} change${changes === 1 ? "" : "s"} · Esc discard · ${modKeyLabel}↵ accept`
            : "Writing proposal…"}
        </span>
        <Button size="sm" variant="ghost" onClick={onDiscard} disabled={busy}>
          Discard
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit} disabled={!ready || busy}>
          Edit before accepting
        </Button>
        <Button size="sm" onClick={onAccept} disabled={!ready || busy}>
          Accept
        </Button>
      </div>
    </section>
  );
}
