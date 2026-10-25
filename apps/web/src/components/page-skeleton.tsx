import { Skeleton } from "@/components/ui/skeleton";
import { LoadingRows } from "./loading-rows";

/** Title + table-like rows: collection pages, admin pages, the template editor. */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-6 px-10 pt-7">
      <Skeleton className="h-7 w-64" />
      <LoadingRows rows={6} />
    </div>
  );
}
