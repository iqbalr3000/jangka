import { type Database, instanceSettings, type llmProviders, type Transaction } from "@jangka/db";
import {
  LLMError,
  type ModelInfo,
  type ProviderConfig,
  type ProviderFactory,
  type ProviderKind,
} from "@jangka/llm";
import { CryptoError, decryptSecret } from "@jangka/shared/crypto";
import { AppError } from "@jangka/shared/errors";
import type { LLMProviderView } from "@jangka/shared/llm";
import { eq } from "drizzle-orm";
import type { Logger } from "../logger";

type Db = Database | Transaction;
export type ProviderRow = typeof llmProviders.$inferSelect;

export async function defaultProvider(
  db: Db,
): Promise<{ providerId: string | null; model: string | null }> {
  const [row] = await db
    .select({
      providerId: instanceSettings.defaultLlmProviderId,
      model: instanceSettings.defaultModel,
    })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, 1));
  return { providerId: row?.providerId ?? null, model: row?.model ?? null };
}

export async function setDefault(
  db: Db,
  providerId: string | null,
  model: string | null,
): Promise<void> {
  await db
    .update(instanceSettings)
    .set({ defaultLlmProviderId: providerId, defaultModel: model })
    .where(eq(instanceSettings.id, 1));
}

export function providerView(row: ProviderRow, defaultId: string | null): LLMProviderView {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    keyLast4: row.keyLast4,
    baseUrl: row.baseUrl,
    enabled: row.enabled,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestError: parseReason(row.lastTestError),
    isDefault: row.id === defaultId,
  };
}

function parseReason(value: string | null): LLMProviderView["lastTestError"] {
  if (value === null) return null;
  return value === "auth" ||
    value === "rate_limit" ||
    value === "context_length" ||
    value === "invalid_output" ||
    value === "invalid_request" ||
    value === "provider_down" ||
    value === "aborted"
    ? value
    : "provider_down";
}

export function storedConfig(row: ProviderRow, masterKey: Buffer): ProviderConfig {
  if (row.apiKeyEnc === null) return { kind: row.kind, apiKey: "", baseUrl: row.baseUrl };
  try {
    return {
      kind: row.kind,
      apiKey: decryptSecret(row.apiKeyEnc, masterKey),
      baseUrl: row.baseUrl,
    };
  } catch (error) {
    if (!(error instanceof CryptoError)) throw error;
    throw new AppError(
      "conflict",
      409,
      "The stored key can't be decrypted (was MASTER_KEY changed?). Replace the key.",
    );
  }
}

/** Kind/key/base-URL rules shared by create and update; key rules skip the fake provider. */
export function assertProviderInput(
  input: { kind: ProviderKind; apiKey?: string; baseUrl?: string | null },
  fakeEnabled: boolean,
): void {
  if (input.kind === "fake" && !fakeEnabled) {
    throw new AppError("validation_failed", 400, "The fake provider is disabled");
  }
  if (input.baseUrl && input.kind !== "openai") {
    throw new AppError("validation_failed", 400, "A custom base URL is only supported for OpenAI", [
      { path: ["baseUrl"], message: "Only for OpenAI-compatible providers" },
    ]);
  }
  if (input.kind !== "fake" && input.apiKey !== undefined && input.apiKey.trim() === "") {
    throw new AppError("validation_failed", 400, "Invalid request", [
      { path: ["apiKey"], message: "Required" },
    ]);
  }
}

export function llmFailure(error: LLMError): AppError {
  return new AppError("llm_error", 502, error.message, {
    reason: error.code,
    ...(error.retryAfterSeconds !== undefined && { retryAfterSeconds: error.retryAfterSeconds }),
  });
}

/**
 * Runs a provider call; an `LLMError` is logged with kind + reason only (never the key or the
 * provider's message) and becomes `502 llm_error`.
 */
export async function callProvider<T>(
  logger: Logger,
  kind: ProviderKind,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (!(error instanceof LLMError)) throw error;
    logger.warn({ providerKind: kind, reason: error.code }, "llm provider call failed");
    throw llmFailure(error);
  }
}

/** Test = authenticated call + model list; what create, key changes and "Test again" run. */
export async function testProvider(
  factory: ProviderFactory,
  logger: Logger,
  config: ProviderConfig,
): Promise<{ models: ModelInfo[]; latencyMs: number }> {
  const provider = factory(config);
  const started = performance.now();
  return callProvider(logger, config.kind, async () => {
    await provider.testConnection();
    const models = await provider.listModels();
    return { models, latencyMs: Math.round(performance.now() - started) };
  });
}
