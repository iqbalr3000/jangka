import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";
import { DocTypeBadge } from "@/components/documents/doc-type-badge";
import { Snippet } from "@/components/snippet";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { adminLinks } from "@/lib/admin-links";
import { collectionTreeQuery } from "@/lib/collections";
import { errorMessage } from "@/lib/form-errors";
import { MIN_SEARCH, searchQuery, useDebounced } from "@/lib/search";
import { cn } from "@/lib/utils";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  isAdmin: boolean;
  onNewDocument: () => void;
};

type Item = {
  id: string;
  group: "Documents" | "Collections" | "Go to" | "Actions";
  label: string;
  detail?: ReactNode;
  docType?: string;
  run: () => void;
};

const GROUP_ORDER: Item["group"][] = ["Documents", "Collections", "Go to", "Actions"];

/** ⌘K: documents from the server, plus collections, admin pages and actions. */
export function CommandPalette({
  open,
  onOpenChange,
  userId,
  isAdmin,
  onNewDocument,
}: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const q = useDebounced(query.trim());
  const documents = useQuery({
    ...searchQuery(q, { limit: 8 }),
    enabled: open && q.length >= MIN_SEARCH,
  });
  const tree = useQuery({ ...collectionTreeQuery, enabled: open });

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  const close = () => onOpenChange(false);
  const go = (run: () => Promise<void>) => () => {
    close();
    void run();
  };
  const needle = query.trim().toLowerCase();
  const matches = (label: string) => !needle || label.toLowerCase().includes(needle);

  const items: Item[] = [];
  if (q.length >= MIN_SEARCH) {
    for (const doc of documents.data?.items ?? []) {
      items.push({
        id: `doc:${doc.id}`,
        group: "Documents",
        label: doc.title,
        docType: doc.docType,
        detail: doc.snippet ? <Snippet value={doc.snippet} /> : doc.collectionName,
        run: go(() => navigate({ to: "/d/$documentId", params: { documentId: doc.id } })),
      });
    }
    items.push({
      id: "search:all",
      group: "Documents",
      label: `See all results for “${query.trim()}”`,
      run: go(() => navigate({ to: "/search", search: { q: query.trim() } })),
    });
  }
  for (const collection of (tree.data?.items ?? [])
    .filter((c) => matches(c.personalOwnerId === userId ? "Personal" : c.name))
    .slice(0, needle ? 5 : 3)) {
    const personal = collection.personalOwnerId === userId;
    items.push({
      id: `col:${collection.id}`,
      group: "Collections",
      label: personal ? "Personal" : collection.name,
      run: go(() =>
        personal
          ? navigate({ to: "/personal" })
          : navigate({ to: "/c/$collectionId", params: { collectionId: collection.id } }),
      ),
    });
  }
  const pages = [{ to: "/", label: "Home" }, ...(isAdmin ? adminLinks : [])];
  for (const page of pages.filter((p) => matches(p.label))) {
    items.push({
      id: `go:${page.to}`,
      group: "Go to",
      label: page.label,
      run: go(() => navigate({ to: page.to })),
    });
  }
  if (matches("New document")) {
    items.push({
      id: "action:new",
      group: "Actions",
      label: "New document",
      run: () => {
        close();
        onNewDocument();
      },
    });
  }
  const ordered = GROUP_ORDER.flatMap((group) => items.filter((i) => i.group === group));
  const current = Math.min(active, Math.max(ordered.length - 1, 0));

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current + 1) % Math.max(ordered.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current - 1 + ordered.length) % Math.max(ordered.length, 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      ordered[current]?.run();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[15%] translate-y-0 gap-0 p-0 sm:max-w-[600px]"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <input
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-activedescendant={ordered[current] ? `palette-${ordered[current].id}` : undefined}
          aria-label="Search documents, collections and pages"
          placeholder="Search documents, collections and pages…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-12 border-b border-border bg-transparent px-4 text-sm outline-none"
        />
        <div
          id="palette-results"
          role="listbox"
          aria-label="Results"
          className="max-h-[420px] overflow-auto py-1.5"
        >
          {documents.error && (
            <p className="px-4 py-2 text-[13px] text-destructive">
              {errorMessage(documents.error)}
            </p>
          )}
          {q.length >= MIN_SEARCH && documents.isFetching && !documents.data && (
            <p className="px-4 py-2 text-[13px] text-muted-foreground">Searching…</p>
          )}
          {GROUP_ORDER.map((group) => {
            const inGroup = ordered.filter((i) => i.group === group);
            if (inGroup.length === 0) return null;
            return (
              <div key={group}>
                <p className="px-4 pt-2 pb-1 font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
                  {group}
                </p>
                {inGroup.map((item) => {
                  const index = ordered.indexOf(item);
                  return (
                    <div
                      key={item.id}
                      id={`palette-${item.id}`}
                      role="option"
                      aria-selected={index === current}
                      tabIndex={-1}
                      onMouseMove={() => setActive(index)}
                      onClick={item.run}
                      onKeyDown={() => undefined}
                      className={cn(
                        "flex cursor-pointer flex-col gap-0.5 px-4 py-2 text-[13px]",
                        index === current && "bg-secondary",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {item.docType && <DocTypeBadge docType={item.docType} />}
                        <span className="truncate font-medium">{item.label}</span>
                      </span>
                      {item.detail && (
                        <span className="truncate text-xs text-muted-foreground">
                          {item.detail}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {q.length >= MIN_SEARCH && documents.data?.items.length === 0 && (
            <p className="px-4 pb-2 text-[13px] text-muted-foreground">No documents match.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
