import { type AuditLogEntry, auditLogList } from "@jangka/shared/audit";
import { adminUserList } from "@jangka/shared/auth";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ErrorBanner } from "@/components/error-banner";
import { LoadingRows } from "@/components/loading-rows";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/_app/admin/audit")({
  component: AuditLogPage,
});

/** Action prefixes (`document` matches `document.*`). */
const AREAS = [
  ["assistant", "Assistant"],
  ["auth", "Sign-in"],
  ["auth_provider", "SSO providers"],
  ["collection", "Collections"],
  ["document", "Documents"],
  ["group", "Groups"],
  ["instance", "Setup"],
  ["invite", "Invites"],
  ["llm_provider", "LLM providers"],
  ["permissions", "Permissions"],
  ["settings", "Settings"],
  ["user", "Users"],
] as const;

type Filters = { action: string; actorId: string; from: string; to: string };
const EMPTY: Filters = { action: "", actorId: "", from: "", to: "" };

function queryString(filters: Filters, cursor: string | null): string {
  const params = new URLSearchParams({ limit: "50" });
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

function Row({ entry }: { entry: AuditLogEntry }) {
  const hasMetadata = Object.keys(entry.metadata).length > 0;
  return (
    <details className="group border-b border-border last:border-b-0">
      <summary className="grid cursor-pointer grid-cols-[160px_160px_220px_1fr_120px] items-center gap-3 px-4 py-2.5 text-sm hover:bg-secondary">
        <span className="text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
        <span className="truncate">{entry.actor?.name ?? "—"}</span>
        <span className="truncate font-mono text-xs">{entry.action}</span>
        <span className="truncate">
          {entry.target?.href ? (
            <Link to={entry.target.href} className="text-primary hover:underline">
              {entry.target.label}
            </Link>
          ) : (
            (entry.target?.label ?? (
              <span className="text-muted-foreground">
                {entry.targetType}
                {entry.targetId ? ` ${entry.targetId.slice(0, 8)}` : ""}
              </span>
            ))
          )}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">{entry.ip ?? ""}</span>
      </summary>
      <pre className="overflow-x-auto bg-secondary px-4 py-3 font-mono text-xs">
        {hasMetadata ? JSON.stringify(entry.metadata, null, 2) : "No details."}
      </pre>
    </details>
  );
}

function AuditLogPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const users = useQuery({
    queryKey: ["admin", "users", "all"],
    queryFn: () => apiFetch("/admin/users?limit=200", { schema: adminUserList }),
  });
  const logs = useInfiniteQuery({
    queryKey: ["admin", "audit", filters],
    queryFn: ({ pageParam }) =>
      apiFetch(`/admin/audit-logs?${queryString(filters, pageParam)}`, { schema: auditLogList }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
  const entries = logs.data?.pages.flatMap((page) => page.items) ?? [];
  const set = (key: keyof Filters) => (event: { target: { value: string } }) => {
    const next = { ...draft, [key]: event.target.value };
    setDraft(next);
    // Selects apply at once; dates apply when both ends are valid or cleared.
    if (key === "action" || key === "actorId") setFilters(next);
  };

  return (
    <div className="flex flex-col gap-6 px-10 pt-7 pb-10">
      <header className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Admin</span>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Audit log</h1>
        <p className="max-w-[620px] text-sm text-muted-foreground">
          Every change made through Jangka, who made it and when. Entries can't be edited or
          deleted.
        </p>
      </header>

      <form
        aria-label="Filters"
        className="flex flex-wrap items-end gap-3 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          setFilters(draft);
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Area</span>
          <select
            value={draft.action}
            onChange={set("action")}
            className="h-9 rounded-sm border border-input bg-card px-2"
          >
            <option value="">All areas</option>
            {AREAS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Who</span>
          <select
            value={draft.actorId}
            onChange={set("actorId")}
            className="h-9 rounded-sm border border-input bg-card px-2"
          >
            <option value="">Anyone</option>
            {users.data?.items.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">From</span>
          <input
            type="date"
            value={draft.from}
            onChange={set("from")}
            className="h-9 rounded-sm border border-input bg-card px-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">To</span>
          <input
            type="date"
            value={draft.to}
            onChange={set("to")}
            className="h-9 rounded-sm border border-input bg-card px-2"
          />
        </label>
        <Button type="submit" size="sm" variant="outline">
          Apply dates
        </Button>
        {(filters.action || filters.actorId || filters.from || filters.to) && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(EMPTY);
              setFilters(EMPTY);
            }}
          >
            Clear
          </Button>
        )}
      </form>

      {logs.error && <ErrorBanner>{errorMessage(logs.error)}</ErrorBanner>}

      <section aria-label="Audit entries" className="rounded-md border border-border bg-card">
        <div className="grid grid-cols-[160px_160px_220px_1fr_120px] gap-3 border-b border-border px-4 py-2 font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
          <span>Time</span>
          <span>Who</span>
          <span>Action</span>
          <span>Target</span>
          <span>IP</span>
        </div>
        {logs.isPending && <LoadingRows className="px-4 py-3" />}
        {logs.data && entries.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">No entries match.</p>
        )}
        {entries.map((entry) => (
          <Row key={entry.id} entry={entry} />
        ))}
      </section>
      {logs.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={logs.isFetchingNextPage}
          onClick={() => void logs.fetchNextPage()}
        >
          {logs.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
