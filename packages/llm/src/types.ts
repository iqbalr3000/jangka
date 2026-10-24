import type { z } from "zod";
import type { LLMError } from "./errors";

export const providerKinds = ["anthropic", "openai", "gemini", "openrouter", "fake"] as const;
export type ProviderKind = (typeof providerKinds)[number];

export type ProviderConfig = {
  kind: ProviderKind;
  apiKey: string;
  /** Only honored for `openai` (OpenAI-compatible endpoints); tests use it for every kind. */
  baseUrl?: string | null;
  /** SDK-level retries for 429/5xx. Default 2. */
  maxRetries?: number;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatRequest = {
  model: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
};

export type ModelInfo = { id: string; label: string; contextWindow?: number };

export type Usage = { inputTokens: number; outputTokens: number };

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "done"; usage: Usage }
  | { type: "error"; error: LLMError };

export interface LLMProvider {
  /** Never throws for provider failures: yields one `error` event and ends. */
  streamText(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent>;
  generateObject<T>(req: ChatRequest, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T>;
  testConnection(signal?: AbortSignal): Promise<void>;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
}

export type JsonSchema = Record<string, unknown>;

/** One structured-output attempt; the shared loop validates and retries. */
export type ObjectAttempt = (
  req: ChatRequest,
  schema: JsonSchema,
  signal?: AbortSignal,
) => Promise<unknown>;
