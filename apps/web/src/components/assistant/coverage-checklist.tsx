import type { CoverageLevel, InterviewState } from "@jangka/shared/assistant";
import type { Section } from "@jangka/shared/document";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const glyph: Record<CoverageLevel, string> = { missing: "○", partial: "◐", covered: "●" };
const color: Record<CoverageLevel, string> = {
  missing: "text-status-empty",
  partial: "text-status-partial",
  covered: "text-status-complete",
};
const label: Record<CoverageLevel, string> = {
  missing: "Missing",
  partial: "Partial",
  covered: "Covered",
};

type CoverageChecklistProps = {
  state: InterviewState | null;
  sections: Section[];
  /** Collapsed to one line once drafting has started (DESIGN §6.3). */
  defaultOpen: boolean;
};

export function CoverageChecklist({ state, sections, defaultOpen }: CoverageChecklistProps) {
  const [open, setOpen] = useState(defaultOpen);
  const titles = new Map(sections.map((s) => [s.key, s.title]));
  const items =
    state?.sections ??
    sections.map((s) => ({ key: s.key, coverage: "missing" as const, note: "" }));
  const covered = items.filter((s) => s.coverage === "covered").length;

  return (
    <section aria-label="Coverage" className="border-b border-border px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground"
      >
        COVERAGE {covered}/{items.length}
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
          aria-hidden
        />
      </button>
      {open && (
        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
          {items.map((item) => (
            <li key={item.key} className="flex items-center gap-1.5" title={item.note || undefined}>
              <span className={color[item.coverage]} aria-hidden>
                {glyph[item.coverage]}
              </span>
              <span className="sr-only">{label[item.coverage]}:</span>
              <span className="truncate">{titles.get(item.key) ?? item.key}</span>
            </li>
          ))}
        </ul>
      )}
      {open && !state && (
        <p className="mt-2 text-xs text-muted-foreground">
          Describe the problem in chat; coverage fills in as you answer.
        </p>
      )}
    </section>
  );
}
