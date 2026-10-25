import type { CollectionSummary } from "@jangka/shared/access";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import { useCallback, useState } from "react";
import { childrenByParent } from "@/lib/collections";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "jangka.tree.expanded";

function readExpanded(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function useExpanded(): [Set<string>, (id: string) => void] {
  const [expanded, setExpanded] = useState(readExpanded);
  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Preference only lasts for this page load.
      }
      return next;
    });
  }, []);
  return [expanded, toggle];
}

const rowClass =
  "group flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-[5px] pr-2 hover:bg-surface-hover data-[status=active]:bg-card data-[status=active]:font-medium data-[status=active]:text-primary data-[status=active]:shadow-[inset_2px_0_0_var(--primary),0_0_0_1px_var(--border)]";

type TreeProps = { items: CollectionSummary[] };

/** Shared collections only; the personal tree lives under "Personal". */
export function CollectionTree({ items }: TreeProps) {
  const [expanded, toggle] = useExpanded();
  const byParent = childrenByParent(items);
  const roots = (byParent.get(null) ?? []).filter((item) => item.personalOwnerId === null);

  if (roots.length === 0) {
    return <p className="px-[18px] text-xs text-muted-foreground">No collections yet.</p>;
  }

  function renderLevel(nodes: CollectionSummary[], depth: number) {
    return (
      <ul className={cn(depth > 0 && "ml-[17px] border-l border-border-strong pl-1")}>
        {nodes.map((node) => {
          const children = byParent.get(node.id) ?? [];
          const open = expanded.has(node.id);
          return (
            <li key={node.id}>
              <div className="flex items-center">
                {children.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => toggle(node.id)}
                    aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
                    aria-expanded={open}
                    className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-surface-hover"
                  >
                    <ChevronRight
                      className={cn("size-3 transition-transform", open && "rotate-90")}
                    />
                  </button>
                ) : (
                  <span className="size-5 shrink-0" aria-hidden />
                )}
                <Link to="/c/$collectionId" params={{ collectionId: node.id }} className={rowClass}>
                  {open && children.length > 0 ? (
                    <FolderOpen
                      className="ml-1 size-4 shrink-0 text-muted-foreground group-data-[status=active]:text-primary"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  ) : (
                    <Folder
                      className="ml-1 size-4 shrink-0 text-muted-foreground group-data-[status=active]:text-primary"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                  {node.documentCount > 0 && (
                    <span className="font-mono text-[11px] text-status-empty">
                      {node.documentCount}
                    </span>
                  )}
                </Link>
              </div>
              {open && children.length > 0 && renderLevel(children, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  }

  return <div className="px-2">{renderLevel(roots, 0)}</div>;
}
