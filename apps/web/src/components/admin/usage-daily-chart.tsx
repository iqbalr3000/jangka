import type { UsageReport } from "@jangka/shared/llm";
import { useLayoutEffect, useRef, useState } from "react";
import { formatTokens } from "@/lib/usage";

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
  const plot = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ index: number; center: number } | null>(null);
  const [left, setLeft] = useState(0);
  const hovered = hover ? daily[hover.index] : undefined;

  // Centered over the bar, clamped to the chart, measured before paint.
  useLayoutEffect(() => {
    if (!hover || !plot.current || !tip.current) return;
    const width = tip.current.offsetWidth;
    const room = Math.max(0, plot.current.clientWidth - width);
    setLeft(Math.min(Math.max(hover.center - width / 2, 0), room));
  }, [hover]);

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
      <div
        ref={plot}
        className="relative flex h-40 items-end gap-[2px] border-b border-border"
        onMouseLeave={() => setHover(null)}
        aria-hidden
      >
        {daily.map((d, i) => {
          const total = d.inputTokens + d.outputTokens;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: hover detail only; the table below has the data
            <div
              key={d.date}
              data-day={d.date}
              className="flex h-full flex-1 flex-col justify-end"
              onMouseEnter={(event) =>
                setHover({
                  index: i,
                  center: event.currentTarget.offsetLeft + event.currentTarget.offsetWidth / 2,
                })
              }
            >
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
            </div>
          );
        })}
        {hovered && (
          <div
            ref={tip}
            data-chart-tooltip
            style={{ left }}
            className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-sm border border-border bg-card px-2 py-1 text-xs whitespace-nowrap shadow-float"
          >
            <div className="font-medium">{dayLabel(hovered.date)}</div>
            <div className="text-muted-foreground">
              {formatTokens(hovered.inputTokens)} in · {formatTokens(hovered.outputTokens)} out
            </div>
          </div>
        )}
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
