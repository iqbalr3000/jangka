import { z } from "zod";

// Mirrors `providerKinds` / `llmErrorCodes` in packages/llm (shared stays dependency-free).
export const providerKind = z.enum(["anthropic", "openai", "gemini", "openrouter", "fake"]);
export type ProviderKind = z.infer<typeof providerKind>;

export const llmErrorReason = z.enum([
  "auth",
  "rate_limit",
  "context_length",
  "invalid_output",
  "invalid_request",
  "provider_down",
  "aborted",
]);
export type LLMErrorReason = z.infer<typeof llmErrorReason>;

/** `details` of a `502 llm_error` response. */
export const llmErrorDetails = z.object({
  reason: llmErrorReason,
  retryAfterSeconds: z.number().optional(),
});

export const modelInfo = z.object({
  id: z.string(),
  label: z.string(),
  contextWindow: z.number().optional(),
});
export type ModelInfo = z.infer<typeof modelInfo>;

export const llmProvider = z.object({
  id: z.string(),
  kind: providerKind,
  label: z.string(),
  keyLast4: z.string().nullable(),
  baseUrl: z.string().nullable(),
  enabled: z.boolean(),
  lastTestedAt: z.string().nullable(),
  lastTestError: llmErrorReason.nullable(),
  isDefault: z.boolean(),
});
export type LLMProviderView = z.infer<typeof llmProvider>;

export const llmProviderList = z.object({ items: z.array(llmProvider), fakeEnabled: z.boolean() });

const apiKey = z.string().trim().min(1, { error: "Required" }).max(500);
const label = z.string().trim().min(1, { error: "Required" }).max(100);
const baseUrl = z.url({ protocol: /^https?$/, error: "Enter an http(s) URL" }).max(500);

/** The fake provider needs no key; every other kind does (checked by the API). */
export const testProviderRequest = z.object({
  kind: providerKind,
  apiKey: z.string().trim().max(500),
  baseUrl: baseUrl.nullish(),
});

export const createProviderRequest = testProviderRequest.extend({
  label,
  defaultModel: z.string().trim().min(1).max(200).nullish(),
});

export const updateProviderRequest = z
  .object({
    label: label.optional(),
    apiKey: apiKey.optional(),
    baseUrl: baseUrl.nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    error: "Nothing to update",
  });

export const testResult = z.object({ models: z.array(modelInfo), latencyMs: z.number() });
export const modelList = z.object({ models: z.array(modelInfo) });

export const llmSettings = z.union([
  z.object({ providerId: z.uuid(), model: z.string().trim().min(1).max(200) }),
  z.object({ providerId: z.null(), model: z.null() }),
]);
export type LLMSettings = z.infer<typeof llmSettings>;

export const llmStatus = z.object({ configured: z.boolean() });
