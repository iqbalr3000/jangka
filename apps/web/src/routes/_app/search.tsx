import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { DocTypeBadge } from "@/components/documents/doc-type-badge";
import { ErrorBanner } from "@/components/error-banner";
import { Snippet } from "@/components/snippet";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/form-errors";
import { timeAgo } from "@/lib/llm";
import { statusLabels } from "@/lib/review";
import { MIN_SEARCH, searchQuery, useDebounced } from "@/lib/search";
import { cn } from "@/lib/utils";

const TYPES = [
  { value: undefined, label: "All" },
  { value: "brd", label: "BRD" },
  { value: "prd", label: "PRD" },
  { value: "tsd", label: "TSD" },
] as const;

export const Route = createFileRoute("/_app/search")({
  validateSearch: z.object({
    q: z.string().catch("").default(""),
    type: z.enum(["brd", "prd", "tsd"]).optional().catch(undefined),
  }),
  component: SearchPage,
});

function SearchPage() {
  const { q, type } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [input, setInput] = useState(q);
  const settled = useDebounced(input.trim(), 250);
  const results = useQuery(searchQuery(q, { type, limit: 50 }));

  // The URL holds the query, so results are shareable and survive a reload.
  useEffect(() => {
    if (settled !== q)
      void navigate({ search: (prev) => ({ ...prev, q: settled }), replace: true });
  }, [settled, q, navigate]);

  const items = results.data?.items ?? [];
  return (
    <div className="flex flex-col gap-5 px-10 pt-7 pb-10">
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Search</h1>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search documents"
          autoFocus
          placeholder="Search titles and content…"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          className="h-10 max-w-xl bg-card"
        />
        <fieldset className="flex gap-1.5">
          <legend className="sr-only">Document type</legend>
          {TYPES.map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={type === option.value}
              onClick={() => void navigate({ search: (prev) => ({ ...prev, type: option.value }) })}
              className={cn(
                "rounded-sm border px-2.5 py-1 font-mono text-xs",
                type === option.value
                  ? "border-primary text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary",
              )}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
      </div>

      {results.error && <ErrorBanner>{errorMessage(results.error)}</ErrorBanner>}
      {q.length < MIN_SEARCH ? (
        <p className="text-sm text-muted-foreground">Type at least {MIN_SEARCH} characters.</p>
      ) : results.isPending ? (
        <p className="text-sm text-muted-foreground">Searching…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents match “{q}”.</p>
      ) : (
        <ol
          aria-label="Search results"
          className="flex flex-col rounded-md border border-border bg-card"
        >
          {items.map((item) => (
            <li key={item.id} className="border-b border-border last:border-b-0">
              <Link
                to="/d/$documentId"
                params={{ documentId: item.id }}
                className="flex flex-col gap-1 px-4 py-3 hover:bg-secondary"
              >
                <span className="flex items-center gap-2 text-sm">
                  <DocTypeBadge docType={item.docType} />
                  <span className="font-medium">{item.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.collectionName} · {statusLabels[item.status]} · {timeAgo(item.updatedAt)}
                  </span>
                </span>
                {item.snippet && (
                  <span className="text-[13px] text-muted-foreground">
                    {item.sectionTitle && (
                      <span className="font-medium">{item.sectionTitle}: </span>
                    )}
                    <Snippet value={item.snippet} />
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
