import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { DocTypeBadge } from "@/components/documents/doc-type-badge";
import { ErrorBanner } from "@/components/error-banner";
import { LoadingRows } from "@/components/loading-rows";
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

  const restoreDoc = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/documents/${id}/restore`, { method: "POST", schema: z.undefined() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: collectionsKey }),
  });

  const error = archived.error ?? restore.error ?? restoreDoc.error;
  const nothing = archived.data?.items.length === 0 && archived.data.documents.length === 0;

  return (
    <div className="flex flex-col gap-6 px-10 pt-7 pb-10">
      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Archived</h1>
        <p className="max-w-[620px] text-sm text-muted-foreground">
          Archived collections and documents you can edit. Restoring puts them back where they were.
        </p>
      </header>

      {error && <ErrorBanner>{errorMessage(error)}</ErrorBanner>}
      {archived.isPending && <LoadingRows />}
      {nothing && <p className="text-sm text-muted-foreground">Nothing is archived.</p>}
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
      {archived.data && archived.data.documents.length > 0 && (
        <section
          aria-label="Archived documents"
          className="rounded-md border border-border bg-card"
        >
          {archived.data.documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-4 border-b border-border px-4 py-3 text-sm last:border-b-0"
            >
              <DocTypeBadge docType={doc.docType} />
              <span className="flex-1 truncate font-medium">{doc.title}</span>
              <span className="text-muted-foreground">
                Archived {doc.archivedAt ? formatDate(doc.archivedAt) : ""}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={restoreDoc.isPending}
                onClick={() => restoreDoc.mutate(doc.id)}
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
