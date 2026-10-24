import { createFileRoute } from "@tanstack/react-router";
import { CollectionPage } from "@/components/collections/collection-page";
import { LlmBanner } from "@/components/llm/llm-banner";
import { collectionItemsQuery } from "@/lib/collections";

export const Route = createFileRoute("/_app/")({
  component: Home,
});

function Home() {
  const { me } = Route.useRouteContext();
  return (
    <>
      {me.user.isAdmin && <LlmBanner />}
      <CollectionPage query={collectionItemsQuery("root")} userId={me.user.id} />
    </>
  );
}
