import type { CollectionDetail, CollectionSummary } from "@jangka/shared/access";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Folder, MoreHorizontal } from "lucide-react";
import { Fragment, useState } from "react";
import { z } from "zod";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api";
import {
  collectionLabel,
  collectionsKey,
  describeAccess,
  levelLabels,
  ROOT_NAME,
} from "@/lib/collections";
import { errorMessage } from "@/lib/form-errors";
import { formatDate } from "@/lib/format";
import { ArchiveCollectionDialog } from "./archive-collection-dialog";
import { CollectionNameDialog, type CollectionNameTarget } from "./collection-name-dialog";
import { MoveCollectionDialog } from "./move-collection-dialog";

const headerClass = "font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground";

type CollectionViewProps = { detail: CollectionDetail; userId: string };

export function CollectionView({ detail, userId }: CollectionViewProps) {
  const queryClient = useQueryClient();
  const [nameTarget, setNameTarget] = useState<CollectionNameTarget | null>(null);
  const [moving, setMoving] = useState<CollectionSummary | null>(null);
  const [archiving, setArchiving] = useState<CollectionSummary | null>(null);

  const restore = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/collections/${id}/restore`, { method: "POST", schema: z.undefined() }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: collectionsKey }),
  });

  const { collection, access, children, breadcrumbs, archivedAt } = detail;
  const title = collection ? collectionLabel(collection, userId) : ROOT_NAME;
  const canEdit = access.level === "edit";
  const isPersonalRoot = collection?.personalOwnerId != null;
  const manageable = collection !== null && !isPersonalRoot && canEdit;
  const crumbs = detail.inPersonalTree
    ? breadcrumbs.map((crumb, i) => (i === 0 ? { ...crumb, name: "Personal" } : crumb))
    : breadcrumbs;

  return (
    <div className="flex flex-col gap-6 px-10 pt-7 pb-10">
      <header className="flex items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {collection && (
            <nav
              aria-label="Breadcrumb"
              className="flex flex-wrap gap-1 text-xs text-muted-foreground"
            >
              {!detail.inPersonalTree && (
                <>
                  <Link to="/" className="hover:text-foreground">
                    {ROOT_NAME}
                  </Link>
                  <span aria-hidden>/</span>
                </>
              )}
              {crumbs.map((crumb) => (
                <Fragment key={crumb.id}>
                  <Link
                    to="/c/$collectionId"
                    params={{ collectionId: crumb.id }}
                    className="hover:text-foreground"
                  >
                    {crumb.name}
                  </Link>
                  <span aria-hidden>/</span>
                </Fragment>
              ))}
            </nav>
          )}
          <h1 className="truncate text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
          <p className="text-[13px] text-muted-foreground">Access: {describeAccess(access)}</p>
        </div>
        {canEdit && !archivedAt && (
          <Button
            size="sm"
            onClick={() =>
              setNameTarget({ kind: "create", parentId: collection?.id ?? null, parentName: title })
            }
          >
            + New collection
          </Button>
        )}
        {manageable && collection && !archivedAt && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex size-8 items-center justify-center rounded-sm border border-border text-muted-foreground hover:bg-secondary"
              aria-label="Collection actions"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-[13px]">
              <DropdownMenuItem
                onSelect={() =>
                  setNameTarget({ kind: "rename", id: collection.id, name: collection.name })
                }
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setMoving(collection)}>Move</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setArchiving(collection)}>
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {archivedAt && collection && (
        <div className="flex items-center gap-3 rounded-sm border border-border bg-secondary px-3 py-2.5 text-[13px]">
          <span className="flex-1">Archived on {formatDate(archivedAt)}.</span>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              disabled={restore.isPending}
              onClick={() => restore.mutate(collection.id)}
            >
              Restore
            </Button>
          )}
        </div>
      )}
      {restore.error && <ErrorBanner>{errorMessage(restore.error)}</ErrorBanner>}

      {children.length > 0 && (
        <section aria-label="Collections" className="rounded-md border border-border bg-card">
          <div className={`${headerClass} border-b border-border px-4 py-2.5`}>COLLECTIONS</div>
          {children.map((child) => (
            <Link
              key={child.id}
              to="/c/$collectionId"
              params={{ collectionId: child.id }}
              className="flex items-center gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0 hover:bg-secondary"
            >
              <Folder className="size-4 text-muted-foreground" aria-hidden />
              <span className="flex-1 truncate font-medium">{child.name}</span>
              {child.level !== "edit" && (
                <span className="text-xs text-muted-foreground">
                  {levelLabels[child.level]} only
                </span>
              )}
            </Link>
          ))}
        </section>
      )}

      <section
        aria-label="Documents"
        className="blueprint-grid flex flex-col items-center justify-center gap-1 rounded-md border border-border px-6 py-14 text-center"
      >
        <p className="text-base font-medium">No documents yet.</p>
        <p className="text-sm text-muted-foreground">
          Precise specs for product & engineering teams.
        </p>
      </section>

      <CollectionNameDialog target={nameTarget} onClose={() => setNameTarget(null)} />
      <MoveCollectionDialog collection={moving} userId={userId} onClose={() => setMoving(null)} />
      <ArchiveCollectionDialog collection={archiving} onClose={() => setArchiving(null)} />
    </div>
  );
}
