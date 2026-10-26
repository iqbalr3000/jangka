import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** List placeholder while a query loads: skeletons, not spinners. */
export function LoadingRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("flex flex-col gap-2.5", className)}>
      {Array.from({ length: rows }, (_, i) => (
        // Staggered widths read as content rather than a solid block.
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <Skeleton key={i} className={cn("h-4", ["w-full", "w-4/5", "w-3/5"][i % 3])} />
      ))}
    </div>
  );
}
