import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { fromHttp, LLMError, toLLMError } from "../errors";
import { generateWithRetry } from "../structured";
import type {
  ChatRequest,
  JsonSchema,
  LLMProvider,
  ModelInfo,
  ProviderConfig,
  StreamEvent,
} from "../types";

const DEFAULT_MAX_TOKENS = 8192;
const TOOL_NAME = "respond";

function classify(error: unknown): LLMError | undefined {
  if (error instanceof Anthropic.APIUserAbortError) return new LLMError("aborted");
  if (error instanceof Anthropic.APIError)
    return fromHttp(error.status, error.message, error.headers);
  return undefined;
}

export function anthropicProvider(config: ProviderConfig): LLMProvider {
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? undefined,
    maxRetries: config.maxRetries ?? 2,
  });

  const base = (req: ChatRequest) => ({
    model: req.model,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: req.messages,
    ...(req.system !== undefined && { system: req.system }),
    ...(req.temperature !== undefined && { temperature: req.temperature }),
  });

  async function objectAttempt(req: ChatRequest, schema: JsonSchema, signal?: AbortSignal) {
    try {
      const message = await client.messages.create(
        {
          ...base(req),
          tools: [
            {
              name: TOOL_NAME,
              description: "Return the result.",
              input_schema: { ...schema, type: "object" },
            },
          ],
          tool_choice: { type: "tool", name: TOOL_NAME },
        },
        { signal },
      );
      const block = message.content.find((b) => b.type === "tool_use");
      return block?.type === "tool_use" ? block.input : undefined;
    } catch (error) {
      throw toLLMError(error, signal, classify);
    }
  }

  return {
    async *streamText(req, signal): AsyncIterable<StreamEvent> {
      const usage = { inputTokens: 0, outputTokens: 0 };
      try {
        const stream = await client.messages.create({ ...base(req), stream: true }, { signal });
        for await (const event of stream) {
          if (event.type === "message_start") {
            usage.inputTokens = event.message.usage.input_tokens;
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            yield { type: "text", delta: event.delta.text };
          } else if (event.type === "message_delta") {
            usage.outputTokens = event.usage.output_tokens;
          }
        }
        // SDK streams end quietly when aborted instead of throwing.
        if (signal?.aborted) yield { type: "error", error: new LLMError("aborted") };
        else yield { type: "done", usage };
      } catch (error) {
        yield { type: "error", error: toLLMError(error, signal, classify) };
      }
    },

    generateObject<T>(req: ChatRequest, schema: z.ZodType<T>, signal?: AbortSignal) {
      return generateWithRetry(objectAttempt, req, schema, signal);
    },

    async testConnection(signal) {
      try {
        await client.models.list({ limit: 1 }, { signal });
      } catch (error) {
        throw toLLMError(error, signal, classify);
      }
    },

    async listModels(signal) {
      try {
        const models: ModelInfo[] = [];
        for await (const model of client.models.list({ limit: 100 }, { signal })) {
          models.push({ id: model.id, label: model.display_name });
        }
        return models;
      } catch (error) {
        throw toLLMError(error, signal, classify);
      }
    },
  };
}
