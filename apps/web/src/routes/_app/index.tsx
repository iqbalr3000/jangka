import { createFileRoute } from "@tanstack/react-router";
import { CollectionPage } from "@/components/collections/collection-page";
import { collectionItemsQuery } from "@/lib/collections";

export const Route = createFileRoute("/_app/")({
  component: Home,
});

function Home() {
  const { me } = Route.useRouteContext();
  return <CollectionPage query={collectionItemsQuery("root")} userId={me.user.id} />;
}
