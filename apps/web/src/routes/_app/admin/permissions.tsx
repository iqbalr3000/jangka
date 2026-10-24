import {
  type Level,
  type PermissionChange,
  type PermissionGraph,
  permissionGraph,
} from "@jangka/shared/access";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AccessCheckDialog } from "@/components/admin/access-check-dialog";
import { PermissionMatrix } from "@/components/admin/permission-matrix";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { collectionsKey } from "@/lib/collections";
import { errorMessage } from "@/lib/form-errors";
import {
  cellKey,
  describeChange,
  groupContexts,
  mergeGrants,
  type StagedChanges,
} from "@/lib/permission-matrix";

export const Route = createFileRoute("/_app/admin/permissions")({
  component: PermissionsPage,
});

const permissionsKey = ["admin", "permissions"] as const;

function PermissionsPage() {
  const queryClient = useQueryClient();
  const [staged, setStaged] = useState<StagedChanges>(new Map());

  const graph = useQuery({
    queryKey: permissionsKey,
    queryFn: () => apiFetch("/admin/permissions", { schema: permissionGraph }),
  });

  const save = useMutation({
    mutationFn: (changes: PermissionChange[]) =>
      apiFetch("/admin/permissions", { method: "PUT", body: { changes }, schema: permissionGraph }),
    onSuccess: async (next) => {
      queryClient.setQueryData(permissionsKey, next);
      setStaged(new Map());
      await queryClient.invalidateQueries({ queryKey: collectionsKey });
    },
  });

  function stage(collectionId: string | null, groupId: string, level: Level | null) {
    if (!graph.data) return;
    const saved =
      graph.data.grants.find((g) => g.collectionId === collectionId && g.groupId === groupId)
        ?.level ?? null;
    const next = new Map(staged);
    const key = cellKey(collectionId, groupId);
    if (level === saved) next.delete(key);
    else next.set(key, { collectionId, groupId, level });
    setStaged(next);
  }

  return (
    <div className="flex flex-col gap-6 px-10 pt-7 pb-28">
      <header className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Admin</span>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Permissions</h1>
          <p className="max-w-[620px] text-sm text-muted-foreground">
            Who can view or edit each collection. Sub-collections inherit from their parent until
            you set them explicitly. Personal collections are always private.
          </p>
        </div>
        <AccessCheckDialog />
      </header>

      {(graph.error ?? save.error) && (
        <ErrorBanner>{errorMessage(graph.error ?? save.error)}</ErrorBanner>
      )}
      {graph.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {graph.data && <PermissionMatrix graph={graph.data} staged={staged} onChange={stage} />}

      {graph.data && staged.size > 0 && (
        <StagedBar
          graph={graph.data}
          staged={staged}
          saving={save.isPending}
          onDiscard={() => setStaged(new Map())}
          onSave={() => save.mutate([...staged.values()])}
        />
      )}
    </div>
  );
}

type StagedBarProps = {
  graph: PermissionGraph;
  staged: StagedChanges;
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
};

function StagedBar({ graph, staged, saving, onDiscard, onSave }: StagedBarProps) {
  const lines = useMemo(() => {
    const before = groupContexts(graph, graph.grants);
    const after = groupContexts(graph, mergeGrants(graph.grants, staged));
    return [...staged.values()].map((change) => describeChange(graph, before, after, change));
  }, [graph, staged]);

  return (
    <section
      aria-label="Staged changes"
      className="fixed right-6 bottom-6 left-6 z-40 mx-auto flex max-w-[960px] items-end gap-4 rounded-md border border-border bg-card px-4 py-3 shadow-float md:left-[264px]"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-mono text-[11px] font-medium tracking-[0.06em] text-primary">
          {staged.size} CHANGE{staged.size === 1 ? "" : "S"}
        </span>
        <ul className="max-h-24 overflow-auto text-[13px]">
          {lines.map((line) => (
            <li key={line} className="truncate">
              {line}
            </li>
          ))}
        </ul>
      </div>
      <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
        Discard
      </Button>
      <Button size="sm" onClick={onSave} disabled={saving}>
        Save changes
      </Button>
    </section>
  );
}
