import type { Completeness } from "@jangka/shared/document";
import { completenessLabels } from "@/lib/documents";
import { cn } from "@/lib/utils";

const glyphs: Record<Completeness, string> = { empty: "○", partial: "◐", complete: "●" };
const colors: Record<Completeness, string> = {
  empty: "text-status-empty",
  partial: "text-status-partial",
  complete: "text-status-complete",
};

/** ○ ◐ ●; never color alone: `withLabel` adds the word, otherwise it's in the accessible name. */
export function SectionStatusIcon({
  completeness,
  withLabel = false,
}: {
  completeness: Completeness;
  withLabel?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", colors[completeness])}>
      <span aria-hidden>{glyphs[completeness]}</span>
      {withLabel ? (
        <span>{completenessLabels[completeness]}</span>
      ) : (
        <span className="sr-only">{completenessLabels[completeness]}</span>
      )}
    </span>
  );
}
