import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { archivedCollectionsQuery, collectionLabel, collectionsKey } from "@/lib/collections";
import { errorMessage } from "@/lib/form-errors";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_app/archived")({
  component: Archived,
});

function Archived() {
  const { me } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const archived = useQuery(archivedCollectionsQuery);

  const restore = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/collections/${id}/restore`, { method: "POST", schema: z.undefined() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: collectionsKey }),
  });

  const error = archived.error ?? restore.error;

  return (
    <div className="flex flex-col gap-6 px-10 pt-7 pb-10">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Archived</h1>
        <p className="max-w-[620px] text-sm text-muted-foreground">
          Archived collections you can edit. Restoring puts a collection back where it was.
        </p>
      </header>

      {error && <ErrorBanner>{errorMessage(error)}</ErrorBanner>}
      {archived.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {archived.data?.items.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing is archived.</p>
      )}
      {archived.data && archived.data.items.length > 0 && (
        <section
          aria-label="Archived collections"
          className="rounded-md border border-border bg-card"
        >
          {archived.data.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-4 border-b border-border px-4 py-3 text-sm last:border-b-0"
            >
              <Link
                to="/c/$collectionId"
                params={{ collectionId: item.id }}
                className="flex-1 truncate font-medium hover:underline"
              >
                {collectionLabel(item, me.user.id)}
              </Link>
              <span className="text-muted-foreground">Archived {formatDate(item.archivedAt)}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={restore.isPending}
                onClick={() => restore.mutate(item.id)}
              >
                Restore
              </Button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
