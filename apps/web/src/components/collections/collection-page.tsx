import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ErrorBanner } from "@/components/error-banner";
import { PageSkeleton } from "@/components/page-skeleton";
import { ApiError } from "@/lib/api";
import type { collectionItemsQuery } from "@/lib/collections";
import { errorMessage } from "@/lib/form-errors";
import { CollectionView } from "./collection-view";

type CollectionPageProps = {
  query: ReturnType<typeof collectionItemsQuery>;
  userId: string;
};

/** Loading / not found / error states around `CollectionView`. */
export function CollectionPage({ query, userId }: CollectionPageProps) {
  const detail = useQuery(query);

  if (detail.isPending) {
    return <PageSkeleton />;
  }
  if (detail.error) {
    if (detail.error instanceof ApiError && detail.error.status === 404) {
      return (
        <div className="blueprint-grid flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-base font-medium">Collection not found.</p>
          <p className="text-sm text-muted-foreground">
            It doesn't exist or you don't have access to it.
          </p>
          <Link to="/" className="text-sm text-primary hover:underline">
            Back to home
          </Link>
        </div>
      );
    }
    return (
      <div className="p-10">
        <ErrorBanner>{errorMessage(detail.error)}</ErrorBanner>
      </div>
    );
  }
  return <CollectionView detail={detail.data} userId={userId} />;
}
