import {
  type LLMErrorReason,
  type LLMProviderView,
  llmProviderList,
  llmSettings,
  llmStatus,
  type ProviderKind,
} from "@jangka/shared/llm";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./api";

/** Prefix for every LLM query; invalidate it after any provider or default change. */
export const llmKey = ["llm"] as const;

export const llmProvidersQuery = queryOptions({
  queryKey: [...llmKey, "providers"],
  queryFn: () => apiFetch("/admin/llm-providers", { schema: llmProviderList }),
});

export const llmSettingsQuery = queryOptions({
  queryKey: [...llmKey, "settings"],
  queryFn: () => apiFetch("/admin/settings/llm", { schema: llmSettings }),
});

export const llmStatusQuery = queryOptions({
  queryKey: [...llmKey, "status"],
  queryFn: () => apiFetch("/llm/status", { schema: llmStatus }),
});

export const kindLabels: Record<ProviderKind, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
  fake: "Fake (testing)",
};

export const keyPlaceholders: Record<ProviderKind, string> = {
  anthropic: "sk-ant-…",
  openai: "sk-…",
  gemini: "AIza…",
  openrouter: "sk-or-…",
  fake: 'Any value ("invalid" simulates a rejected key)',
};

export type ProviderStatus = { tone: "ok" | "warn" | "error" | "idle"; label: string };

const reasonLabels: Record<LLMErrorReason, string> = {
  auth: "Key rejected",
  rate_limit: "Rate limited",
  context_length: "Request too long",
  invalid_output: "Unexpected output",
  invalid_request: "Request rejected",
  provider_down: "Unreachable",
  aborted: "Cancelled",
};

export function providerStatus(provider: LLMProviderView): ProviderStatus {
  if (!provider.enabled) return { tone: "idle", label: "Disabled" };
  if (!provider.lastTestedAt) return { tone: "idle", label: "Not tested" };
  if (!provider.lastTestError) return { tone: "ok", label: "Connected" };
  return {
    tone: provider.lastTestError === "rate_limit" ? "warn" : "error",
    label: reasonLabels[provider.lastTestError],
  };
}

/** "3m ago" style, in the browser's locale. */
export function timeAgo(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(seconds, "second");
}
