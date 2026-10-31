import { type LlmOperation, type UsagePeriod, usageReport } from "@jangka/shared/llm";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./api";

export const usageQuery = (period: UsagePeriod) =>
  queryOptions({
    queryKey: ["admin", "usage", period],
    queryFn: () => apiFetch(`/admin/usage?period=${period}`, { schema: usageReport }),
  });

export const periodLabels: Record<UsagePeriod, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  month: "This month",
  last_month: "Last month",
};

export const operationLabels: Record<LlmOperation, string> = {
  chat: "Chat replies",
  coverage: "Coverage assessment",
  draft: "Drafting",
  check: "Completeness checks",
  revise: "Revisions",
  propose: "Updates from chat",
  diagram_fix: "Diagram fixes",
};

const compact = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** 12400 → "12.4K" in the browser's locale. */
export const formatTokens = (value: number) => compact.format(value);
