import { Skeleton } from "@/components/ui/skeleton";

/** The document workspace's shape: header, outline rail, title and section blocks. */
export function DocumentSkeleton() {
  return (
    <div role="status" aria-label="Loading document" className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <Skeleton className="h-4 w-48" />
        <span className="flex-1" />
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-14 flex-col gap-3 border-r border-border px-3 py-5 lg:flex xl:w-[220px]">
          {Array.from({ length: 8 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
            <Skeleton key={i} className="h-4" />
          ))}
        </div>
        <div className="mx-auto flex w-full max-w-[72ch] flex-col gap-10 px-6 py-10">
          <Skeleton className="h-9 w-2/3" />
          {Array.from({ length: 3 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
            <div key={i} className="flex flex-col gap-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-3/5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
