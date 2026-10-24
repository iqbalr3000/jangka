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

function reply(lastUser: string): string {
  return `This is a fake reply to: ${lastUser.slice(0, 200)}`;
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
      const text = reply(req.messages.findLast((m) => m.role === "user")?.content ?? "");
      const words = text.split(/(?<= )/);
      for (const word of words) {
        if (signal?.aborted) {
          yield { type: "error", error: new LLMError("aborted") };
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield { type: "text", delta: word };
      }
      yield {
        type: "done",
        usage: { inputTokens: req.messages.length * 10, outputTokens: words.length },
      };
    },

    generateObject(req, schema, signal) {
      return generateWithRetry(
        async () => {
          checkKey(config);
          if (signal?.aborted) throw new LLMError("aborted");
          return queued.length > 0 ? queued.shift() : undefined;
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
