import { createFileRoute } from "@tanstack/react-router";
import { CollectionPage } from "@/components/collections/collection-page";
import { collectionItemsQuery } from "@/lib/collections";

export const Route = createFileRoute("/_app/c/$collectionId")({
  component: CollectionRoute,
});

function CollectionRoute() {
  const { me } = Route.useRouteContext();
  const { collectionId } = Route.useParams();
  return (
    <CollectionPage
      key={collectionId}
      query={collectionItemsQuery(collectionId)}
      userId={me.user.id}
    />
  );
}
