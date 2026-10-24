import { cn } from "@/lib/utils";

/** Mono outlined `BRD` / `PRD` / `TSD`; not color-coded by type (DESIGN §6.2). */
export function DocTypeBadge({ docType, className }: { docType: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-[3px] border border-border-strong px-1.5 font-mono text-[11px] font-medium uppercase",
        className,
      )}
    >
      {docType}
    </span>
  );
}
