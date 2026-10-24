import { ApiError, type Content, GoogleGenAI } from "@google/genai";
import { fromHttp, LLMError, toLLMError } from "../errors";
import { generateWithRetry, parseJson, toGeminiSchema } from "../structured";
import type {
  ChatRequest,
  JsonSchema,
  LLMProvider,
  ModelInfo,
  ProviderConfig,
  StreamEvent,
} from "../types";

function classify(error: unknown): LLMError | undefined {
  // Gemini answers an invalid key with 400 INVALID_ARGUMENT, not 401.
  if (error instanceof ApiError && error.status === 400 && /api key/i.test(error.message)) {
    return new LLMError("auth");
  }
  if (error instanceof ApiError) return fromHttp(error.status, error.message);
  return undefined;
}

function contents(req: ChatRequest): Content[] {
  return req.messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
}

export function geminiProvider(config: ProviderConfig): LLMProvider {
  const client = new GoogleGenAI({
    apiKey: config.apiKey,
    httpOptions: {
      ...(config.baseUrl && { baseUrl: config.baseUrl }),
      retryOptions: { attempts: (config.maxRetries ?? 2) + 1 },
    },
  });

  const generationConfig = (req: ChatRequest, signal?: AbortSignal) => ({
    ...(req.system !== undefined && { systemInstruction: req.system }),
    ...(req.maxTokens !== undefined && { maxOutputTokens: req.maxTokens }),
    ...(req.temperature !== undefined && { temperature: req.temperature }),
    ...(signal && { abortSignal: signal }),
  });

  async function objectAttempt(req: ChatRequest, schema: JsonSchema, signal?: AbortSignal) {
    try {
      const response = await client.models.generateContent({
        model: req.model,
        contents: contents(req),
        config: {
          ...generationConfig(req, signal),
          responseMimeType: "application/json",
          responseJsonSchema: toGeminiSchema(schema),
        },
      });
      return parseJson(response.text ?? "");
    } catch (error) {
      throw toLLMError(error, signal, classify);
    }
  }

  return {
    async *streamText(req, signal): AsyncIterable<StreamEvent> {
      const usage = { inputTokens: 0, outputTokens: 0 };
      try {
        const stream = await client.models.generateContentStream({
          model: req.model,
          contents: contents(req),
          config: generationConfig(req, signal),
        });
        for await (const chunk of stream) {
          const text = chunk.text;
          if (text) yield { type: "text", delta: text };
          if (chunk.usageMetadata) {
            usage.inputTokens = chunk.usageMetadata.promptTokenCount ?? usage.inputTokens;
            usage.outputTokens = chunk.usageMetadata.candidatesTokenCount ?? usage.outputTokens;
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
        await client.models.list({
          config: { pageSize: 1, ...(signal && { abortSignal: signal }) },
        });
      } catch (error) {
        throw toLLMError(error, signal, classify);
      }
    },

    async listModels(signal) {
      try {
        const pager = await client.models.list({
          config: { pageSize: 100, ...(signal && { abortSignal: signal }) },
        });
        const models: ModelInfo[] = [];
        for await (const model of pager) {
          if (!model.name || !model.supportedActions?.includes("generateContent")) continue;
          const id = model.name.replace(/^models\//, "");
          models.push({
            id,
            label: model.displayName ?? id,
            ...(model.inputTokenLimit !== undefined && { contextWindow: model.inputTokenLimit }),
          });
        }
        return models;
      } catch (error) {
        throw toLLMError(error, signal, classify);
      }
    },
  };
}
