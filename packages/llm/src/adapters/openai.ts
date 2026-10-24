import OpenAI from "openai";
import { z } from "zod";
import { fromHttp, LLMError, toLLMError } from "../errors";
import {
  extractJson,
  generateWithRetry,
  parseJson,
  schemaInstruction,
  stripNullOptionals,
  toOpenAIStrict,
} from "../structured";
import type {
  ChatRequest,
  JsonSchema,
  LLMProvider,
  ModelInfo,
  ProviderConfig,
  StreamEvent,
} from "../types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1";

// OpenRouter adds `name` / `context_length`; plain OpenAI-compatible servers may omit them.
const modelEntry = z.object({
  id: z.string(),
  name: z.string().optional(),
  context_length: z.number().optional(),
});

function classify(error: unknown): LLMError | undefined {
  if (error instanceof OpenAI.APIUserAbortError) return new LLMError("aborted");
  if (error instanceof OpenAI.APIError) return fromHttp(error.status, error.message, error.headers);
  return undefined;
}

/** OpenAI, OpenRouter, and any OpenAI-compatible endpoint (Ollama, vLLM, gateways). */
export function openAICompatibleProvider(config: ProviderConfig): LLMProvider {
  const openRouter = config.kind === "openrouter";
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? (openRouter ? OPENROUTER_URL : undefined),
    maxRetries: config.maxRetries ?? 2,
  });

  const base = (req: ChatRequest) => ({
    model: req.model,
    messages: [
      ...(req.system !== undefined ? [{ role: "system" as const, content: req.system }] : []),
      ...req.messages,
    ],
    ...(req.temperature !== undefined && { temperature: req.temperature }),
    // OpenAI replaced max_tokens; most compatible servers still only know max_tokens.
    ...(req.maxTokens !== undefined &&
      (config.kind === "openai" && !config.baseUrl
        ? { max_completion_tokens: req.maxTokens }
        : { max_tokens: req.maxTokens })),
  });

  async function objectAttempt(req: ChatRequest, schema: JsonSchema, signal?: AbortSignal) {
    try {
      const completion = await client.chat.completions.create(
        {
          ...base(req),
          response_format: {
            type: "json_schema",
            json_schema: { name: "response", strict: true, schema: toOpenAIStrict(schema) },
          },
        },
        { signal },
      );
      return stripNullOptionals(parseJson(completion.choices[0]?.message.content ?? ""), schema);
    } catch (error) {
      // Some OpenRouter models reject response_format: fall back to the schema in the prompt.
      if (!(openRouter && error instanceof OpenAI.APIError && error.status === 400)) {
        throw toLLMError(error, signal, classify);
      }
    }
    try {
      const system = [req.system, schemaInstruction(schema)].filter(Boolean).join("\n\n");
      const completion = await client.chat.completions.create(base({ ...req, system }), {
        signal,
      });
      return extractJson(completion.choices[0]?.message.content ?? "");
    } catch (error) {
      throw toLLMError(error, signal, classify);
    }
  }

  return {
    async *streamText(req, signal): AsyncIterable<StreamEvent> {
      const usage = { inputTokens: 0, outputTokens: 0 };
      try {
        const stream = await client.chat.completions.create(
          { ...base(req), stream: true, stream_options: { include_usage: true } },
          { signal },
        );
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta.content;
          if (delta) yield { type: "text", delta };
          if (chunk.usage) {
            usage.inputTokens = chunk.usage.prompt_tokens;
            usage.outputTokens = chunk.usage.completion_tokens;
          }
        }
        // SDK streams end quietly when aborted instead of throwing.
        if (signal?.aborted) yield { type: "error", error: new LLMError("aborted") };
        else yield { type: "done", usage };
      } catch (error) {
        yield { type: "error", error: toLLMError(error, signal, classify) };
      }
    },

    generateObject(req, schema, signal) {
      return generateWithRetry(objectAttempt, req, schema, signal);
    },

    async testConnection(signal) {
      try {
        // OpenRouter's model list is public; /key is the cheapest call that checks the key.
        if (openRouter) await client.get("/key", { signal });
        else await client.models.list({ signal });
      } catch (error) {
        throw toLLMError(error, signal, classify);
      }
    },

    async listModels(signal) {
      try {
        const models: ModelInfo[] = [];
        for await (const raw of client.models.list({ signal })) {
          const parsed = modelEntry.safeParse(raw);
          if (!parsed.success) continue;
          const { id, name, context_length } = parsed.data;
          models.push({
            id,
            label: name ?? id,
            ...(context_length !== undefined && { contextWindow: context_length }),
          });
        }
        return models.sort((a, b) => a.id.localeCompare(b.id));
      } catch (error) {
        throw toLLMError(error, signal, classify);
      }
    },
  };
}
