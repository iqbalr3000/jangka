import type { Level, PermissionGraph } from "@jangka/shared/access";
import { Lock } from "lucide-react";
import { useMemo } from "react";
import { childrenByParent, ROOT_NAME } from "@/lib/collections";
import {
  cellState,
  collectionName,
  groupContexts,
  mergeGrants,
  type StagedChanges,
} from "@/lib/permission-matrix";
import { PermissionCell } from "./permission-cell";

type Row = { id: string | null; name: string; depth: number; last: boolean };

function rows(graph: PermissionGraph): Row[] {
  const byParent = childrenByParent(graph.collections);
  const result: Row[] = [{ id: null, name: ROOT_NAME, depth: 0, last: true }];
  const walk = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) ?? [];
    children.forEach((child, i) => {
      result.push({ id: child.id, name: child.name, depth, last: i === children.length - 1 });
      walk(child.id, depth + 1);
    });
  };
  walk(null, 1);
  return result;
}

type PermissionMatrixProps = {
  graph: PermissionGraph;
  staged: StagedChanges;
  onChange: (collectionId: string | null, groupId: string, level: Level | null) => void;
};

export function PermissionMatrix({ graph, staged, onChange }: PermissionMatrixProps) {
  const grants = useMemo(() => mergeGrants(graph.grants, staged), [graph.grants, staged]);
  const contexts = useMemo(() => groupContexts(graph, grants), [graph, grants]);
  const tableRows = useMemo(() => rows(graph), [graph]);

  return (
    <div className="overflow-auto rounded-md border border-border bg-card">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border">
            <th
              scope="col"
              className="sticky left-0 bg-card px-4 py-2.5 text-left font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground"
            >
              COLLECTION
            </th>
            {graph.groups.map((group) => (
              <th key={group.id} scope="col" className="min-w-36 px-2 py-2.5 text-left font-normal">
                <span className="block font-medium">{group.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
                  {group.systemKey === "admins" && " · locked"}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows.map((row) => (
            <tr key={row.id ?? "root"} className="border-b border-border last:border-b-0">
              <th
                scope="row"
                className="sticky left-0 bg-card px-4 py-1.5 text-left font-normal whitespace-nowrap"
              >
                <span
                  className="font-mono text-border-strong"
                  style={{ paddingLeft: Math.max(0, row.depth - 1) * 16 }}
                  aria-hidden
                >
                  {row.depth > 0 && (row.last ? "└ " : "├ ")}
                </span>
                <span className={row.id === null ? "font-medium" : undefined}>{row.name}</span>
              </th>
              {graph.groups.map((group) => {
                if (group.systemKey === "admins") {
                  return (
                    <td key={group.id} className="px-2 py-1.5 text-muted-foreground">
                      <span className="flex items-center gap-1.5 px-2">
                        Edit <Lock className="size-3" aria-label="locked" />
                      </span>
                    </td>
                  );
                }
                const state = cellState(graph, contexts, grants, staged, row.id, group.id);
                return (
                  <td key={group.id} className="px-2 py-1.5">
                    <PermissionCell
                      state={state}
                      label={`${group.name} on ${row.name}`}
                      inheritedFrom={collectionName(graph, state.inheritedFromId)}
                      isRoot={row.id === null}
                      onChange={(level) => onChange(row.id, group.id, level)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
