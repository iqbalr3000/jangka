import { createFileRoute } from "@tanstack/react-router";
import { CollectionPage } from "@/components/collections/collection-page";
import { personalCollectionQuery } from "@/lib/collections";

export const Route = createFileRoute("/_app/personal")({
  component: Personal,
});

function Personal() {
  const { me } = Route.useRouteContext();
  return <CollectionPage query={personalCollectionQuery} userId={me.user.id} />;
}
