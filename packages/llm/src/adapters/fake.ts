import { LLMError } from "../errors";
import { generateWithRetry } from "../structured";
import type { LLMProvider, ModelInfo, ProviderConfig, StreamEvent } from "../types";

/** Key that makes the fake provider reject auth, to exercise error paths from the UI. */
export const FAKE_INVALID_KEY = "invalid";

const MODELS: ModelInfo[] = [
  { id: "fake-small", label: "Fake small", contextWindow: 32_000 },
  { id: "fake-large", label: "Fake large", contextWindow: 200_000 },
];

const queued: unknown[] = [];

/** Queues raw `generateObject` outputs (validated like a real provider's). Tests only. */
export function fakeResponses(...outputs: unknown[]): void {
  queued.push(...outputs);
}

function checkKey(config: ProviderConfig): void {
  if (config.apiKey === FAKE_INVALID_KEY) throw new LLMError("auth");
}

/** Message marker that makes the fake stream slowly, so Stop can be exercised. */
export const FAKE_SLOW_MARKER = "[slow]";

function reply(lastUser: string): string {
  return `This is a fake reply to: ${lastUser.slice(0, 200)}`;
}

/**
 * Deterministic value valid for a JSON schema: enums take their last option (so coverage reads
 * "covered", completeness "complete"), strings "Fake", arrays one item.
 */
export function sampleFromSchema(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null) return null;
  const node = schema as Record<string, unknown>;
  if (Array.isArray(node.enum)) return node.enum.at(-1);
  if ("const" in node) return node.const;
  if (Array.isArray(node.anyOf)) return sampleFromSchema(node.anyOf[0]);
  switch (node.type) {
    case "object": {
      const properties = (node.properties ?? {}) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [key, sampleFromSchema(value)]),
      );
    }
    case "array":
      return [sampleFromSchema(node.items)];
    case "string":
      return "Fake";
    case "number":
    case "integer":
      return typeof node.minimum === "number" ? node.minimum : 1;
    case "boolean":
      return true;
    default:
      return null;
  }
}

/** Deterministic provider for tests and keyless local dev (`ENABLE_FAKE_LLM`). */
export function fakeProvider(config: ProviderConfig): LLMProvider {
  return {
    async *streamText(req, signal): AsyncIterable<StreamEvent> {
      try {
        checkKey(config);
      } catch (error) {
        if (error instanceof LLMError) yield { type: "error", error };
        return;
      }
      const lastUser = req.messages.findLast((m) => m.role === "user")?.content ?? "";
      const slow = lastUser.includes(FAKE_SLOW_MARKER);
      const text = slow ? `${reply(lastUser)} ${"and more ".repeat(40)}` : reply(lastUser);
      const words = text.split(/(?<= )/);
      for (const word of words) {
        if (signal?.aborted) {
          yield { type: "error", error: new LLMError("aborted") };
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, slow ? 60 : 5));
        yield { type: "text", delta: word };
      }
      yield {
        type: "done",
        usage: { inputTokens: req.messages.length * 10, outputTokens: words.length },
      };
    },

    generateObject(req, schema, signal) {
      return generateWithRetry(
        async (_req, jsonSchema) => {
          checkKey(config);
          if (signal?.aborted) throw new LLMError("aborted");
          return queued.length > 0 ? queued.shift() : sampleFromSchema(jsonSchema);
        },
        req,
        schema,
        signal,
      );
    },

    async testConnection() {
      checkKey(config);
    },

    async listModels() {
      checkKey(config);
      return MODELS;
    },
  };
}
