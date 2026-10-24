import { toMarkdown } from "@jangka/export";
import type { DocNode, Section } from "@jangka/shared/document";
import { MoreHorizontal } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { sectionAnchor } from "@/lib/documents";
import type { Proposal } from "@/lib/use-assistant";
import { ReviseProposal } from "./revise-proposal";
import { type SaveState, SectionEditor } from "./section-editor";
import { SectionStatusIcon } from "./section-status-icon";
import { StreamingSection } from "./streaming-section";

type SectionBlockProps = {
  documentId: string;
  section: Section;
  /** Edit access and not locked by the assistant. */
  editable: boolean;
  /** Assistant actions available (edit access, LLM configured, nothing running). */
  canGenerate: boolean;
  queued: boolean;
  streaming: string | undefined;
  proposal: Proposal | undefined;
  accepted: boolean;
  busy: boolean;
  seed: DocNode | undefined;
  onSaved: (section: Section) => void;
  onSaveState: (key: string, state: SaveState) => void;
  onRevise: (instruction: string) => void;
  onDraft: () => void;
  onAccept: () => void;
  onDiscard: () => void;
  onEdit: () => void;
  onUndo: () => void;
  onAsk: () => void;
};

export function SectionBlock(props: SectionBlockProps) {
  const { section, streaming, proposal } = props;
  const [revising, setRevising] = useState(false);
  const [instruction, setInstruction] = useState("");
  const anchor = sectionAnchor(section.key);
  const empty = section.completeness === "empty";

  function submitRevise(event: FormEvent) {
    event.preventDefault();
    if (!instruction.trim()) return;
    props.onRevise(instruction.trim());
    setRevising(false);
    setInstruction("");
  }

  return (
    <section
      id={anchor}
      aria-labelledby={`${anchor}-title`}
      className="group flex scroll-mt-6 flex-col gap-3"
    >
      <div className="flex items-center gap-3">
        <h2 id={`${anchor}-title`} className="text-xl font-semibold tracking-[-0.01em]">
          {section.title}
        </h2>
        {streaming !== undefined ? (
          <span className="text-xs text-primary">Drafting…</span>
        ) : props.queued ? (
          <span className="text-xs text-muted-foreground">Queued</span>
        ) : (
          <SectionStatusIcon completeness={section.completeness} withLabel />
        )}
        <span className="flex-1" />
        {props.canGenerate && !proposal && streaming === undefined && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex size-7 items-center justify-center rounded-sm text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-secondary focus-visible:opacity-100"
              aria-label={`Assistant actions for ${section.title}`}
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-[13px]">
              <DropdownMenuItem disabled={empty} onSelect={() => setRevising(true)}>
                ⟳ Revise…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={props.onDraft}>
                {empty ? "Draft this section" : "Redraft this section…"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {revising && (
        <form onSubmit={submitRevise} className="flex gap-2">
          <Input
            aria-label={`Revise ${section.title}`}
            autoFocus
            placeholder="e.g. Make every requirement measurable"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && setRevising(false)}
            className="h-8 bg-card text-[13px]"
          />
          <Button size="sm" type="submit" disabled={!instruction.trim()}>
            Revise
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => setRevising(false)}>
            Cancel
          </Button>
        </form>
      )}

      {proposal && (
        <ReviseProposal
          current={toMarkdown(section.content)}
          proposal={proposal}
          busy={props.busy}
          onDiscard={props.onDiscard}
          onEdit={props.onEdit}
          onAccept={props.onAccept}
        />
      )}

      {props.accepted && (
        <p className="flex items-center gap-2 text-[13px]" role="status">
          <span className="text-status-complete" aria-hidden>
            ●
          </span>
          Accepted · saved as revision {section.revision}
          <Button size="xs" variant="ghost" onClick={props.onUndo} disabled={props.busy}>
            Undo
          </Button>
        </p>
      )}

      {streaming !== undefined ? (
        <StreamingSection markdown={streaming} />
      ) : (
        !proposal && (
          <>
            <SectionEditor
              documentId={props.documentId}
              section={section}
              editable={props.editable}
              onSaved={props.onSaved}
              onSaveState={props.onSaveState}
              seed={props.seed}
            />
            {empty && props.canGenerate && (
              <button
                type="button"
                onClick={props.onAsk}
                className="self-start text-[13px] text-primary hover:underline"
              >
                Ask me about this
              </button>
            )}
          </>
        )
      )}
    </section>
  );
}
