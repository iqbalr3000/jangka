import { type UsagePeriod, usagePeriod } from "@jangka/shared/llm";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { UsageDailyChart } from "@/components/admin/usage-daily-chart";
import { ErrorBanner } from "@/components/error-banner";
import { LoadingRows } from "@/components/loading-rows";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/form-errors";
import { kindLabels } from "@/lib/llm";
import { docTypeLabels } from "@/lib/trace";
import { formatTokens, operationLabels, periodLabels, usageQuery } from "@/lib/usage";

export const Route = createFileRoute("/_app/admin/usage")({
  component: UsagePage,
});

type Row = {
  key: string;
  label: ReactNode;
  requests: number;
  inputTokens: number;
  outputTokens: number;
};

function UsagePage() {
  const [period, setPeriod] = useState<UsagePeriod>("30d");
  const usage = useQuery(usageQuery(period));
  const report = usage.data;

  return (
    <div className="flex flex-col gap-6 px-10 pt-7 pb-10">
      <header className="flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Admin</span>
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Usage</h1>
          <p className="max-w-[620px] text-sm text-muted-foreground">
            Tokens sent to and received from LLM providers. Every assistant call is counted,
            including coverage checks and diagram fixes.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="usage-period" className="text-[13px] font-medium">
            Period
          </Label>
          <select
            id="usage-period"
            value={period}
            onChange={(event) => setPeriod(usagePeriod.parse(event.target.value))}
            className="h-8 rounded-sm border border-input bg-card px-2 text-sm"
          >
            {usagePeriod.options.map((p) => (
              <option key={p} value={p}>
                {periodLabels[p]}
              </option>
            ))}
          </select>
        </div>
      </header>

      {usage.error && <ErrorBanner>{errorMessage(usage.error)}</ErrorBanner>}
      {usage.isPending && <LoadingRows />}

      {report && report.totals.requests === 0 && (
        <p className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No LLM requests in this period.
        </p>
      )}

      {report && report.totals.requests > 0 && (
        <>
          <section aria-label="Totals" className="grid grid-cols-3 gap-3">
            <Stat label="Requests" value={report.totals.requests.toLocaleString()} />
            <Stat label="Input tokens" value={formatTokens(report.totals.inputTokens)} />
            <Stat label="Output tokens" value={formatTokens(report.totals.outputTokens)} />
          </section>

          <section className="rounded-md border border-border bg-card p-4">
            <UsageDailyChart daily={report.daily} />
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <Breakdown
              title="By model"
              rows={report.byModel.map((r) => ({
                ...r,
                key: `${r.providerKind}:${r.model}`,
                label: (
                  <>
                    <span className="font-mono text-xs">{r.model}</span>
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {kindLabels[r.providerKind]}
                    </span>
                  </>
                ),
              }))}
            />
            <Breakdown
              title="By operation"
              rows={report.byOperation.map((r) => ({
                ...r,
                key: r.operation,
                label: operationLabels[r.operation],
              }))}
            />
            <Breakdown
              title="By user"
              rows={report.byUser.map((r) => ({
                ...r,
                key: r.user?.id ?? "unknown",
                label: r.user?.name ?? <span className="text-muted-foreground">Unknown</span>,
              }))}
            />
            <Breakdown
              title="Top documents"
              rows={report.topDocuments.map((r, i) => ({
                ...r,
                key: r.document?.id ?? `restricted-${i}`,
                label: r.document ? (
                  <Link
                    to="/d/$documentId"
                    params={{ documentId: r.document.id }}
                    className="hover:underline"
                  >
                    <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">
                      {docTypeLabels[r.document.docType]}
                    </span>
                    {r.document.title}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Personal document</span>
                ),
              }))}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card px-4 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tracking-[-0.02em]">{value}</span>
    </div>
  );
}

/** Rows sorted by total tokens (server order) with a proportional bar. */
function Breakdown({ title, rows }: { title: string; rows: Row[] }) {
  const max = Math.max(1, ...rows.map((r) => r.inputTokens + r.outputTokens));
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      <table className="w-full rounded-md border border-border bg-card text-[13px]">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th className="px-3 py-2 font-normal">Name</th>
            <th className="px-3 py-2 text-right font-normal">Requests</th>
            <th className="px-3 py-2 text-right font-normal">Input</th>
            <th className="px-3 py-2 text-right font-normal">Output</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border last:border-b-0">
              <td className="px-3 py-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate">{r.label}</span>
                  <span
                    className="h-1 rounded-full bg-chart-input"
                    style={{ width: `${((r.inputTokens + r.outputTokens) / max) * 100}%` }}
                    aria-hidden
                  />
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.requests.toLocaleString()}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatTokens(r.inputTokens)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatTokens(r.outputTokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
