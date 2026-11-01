import type { UsageReport } from "@jangka/shared/llm";
import { formatTokens } from "@/lib/usage";
import { cn } from "@/lib/utils";

const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** Stacked daily bars (input under output) with a hover tooltip per day and a table for readers. */
export function UsageDailyChart({ daily }: { daily: UsageReport["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.inputTokens + d.outputTokens));
  const ticks = [daily[0], daily[Math.floor(daily.length / 2)], daily.at(-1)];

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Tokens per day</span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-chart-input" aria-hidden /> Input
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] bg-chart-output" aria-hidden /> Output
        </span>
        <span className="ml-auto">max {formatTokens(max)}</span>
      </figcaption>
      <div className="flex h-40 items-end gap-[2px] border-b border-border" aria-hidden>
        {daily.map((d, i) => {
          const total = d.inputTokens + d.outputTokens;
          // Centered over the bar, except near the edges, where it would be cut off.
          const place =
            i < daily.length / 4
              ? "left-0"
              : i >= (daily.length * 3) / 4
                ? "right-0"
                : "left-1/2 -translate-x-1/2";
          return (
            <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end">
              {total > 0 && (
                <div
                  className="flex flex-col gap-[2px]"
                  style={{ height: `${(total / max) * 100}%` }}
                >
                  {d.outputTokens > 0 && (
                    <div
                      className="rounded-t-[4px] bg-chart-output"
                      style={{ flexGrow: d.outputTokens }}
                    />
                  )}
                  <div
                    className={
                      d.outputTokens > 0 ? "bg-chart-input" : "rounded-t-[4px] bg-chart-input"
                    }
                    style={{ flexGrow: d.inputTokens }}
                  />
                </div>
              )}
              <div
                className={cn(
                  "pointer-events-none absolute bottom-full z-10 mb-1 hidden rounded-sm border border-border bg-card px-2 py-1 text-xs whitespace-nowrap shadow-float group-hover:block",
                  place,
                )}
              >
                <div className="font-medium">{dayLabel(d.date)}</div>
                <div className="text-muted-foreground">
                  {formatTokens(d.inputTokens)} in · {formatTokens(d.outputTokens)} out
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground" aria-hidden>
        {ticks.map((d, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: three fixed tick slots
          <span key={i}>{d ? dayLabel(d.date) : ""}</span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Tokens per day</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>Input tokens</th>
            <th>Output tokens</th>
          </tr>
        </thead>
        <tbody>
          {daily.map((d) => (
            <tr key={d.date}>
              <td>{dayLabel(d.date)}</td>
              <td>{d.inputTokens}</td>
              <td>{d.outputTokens}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
