import type { Completeness } from "@jangka/shared/document";
import { completenessSummary } from "@/lib/documents";
import { cn } from "@/lib/utils";

const dot: Record<Completeness, string> = {
  empty: "border border-status-empty",
  partial:
    "bg-[linear-gradient(90deg,var(--status-partial)_50%,transparent_50%)] border border-status-partial",
  complete: "bg-status-complete",
};

/** One dot per template section. */
export function CompletenessStrip({ values }: { values: Completeness[] }) {
  const label = completenessSummary(values.map((completeness) => ({ completeness })));
  return (
    <span className="flex items-center gap-[3px]" role="img" aria-label={label} title={label}>
      {values.map((value, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positions are the identity here
        <span key={i} className={cn("size-[7px] rounded-full", dot[value])} />
      ))}
    </span>
  );
}
