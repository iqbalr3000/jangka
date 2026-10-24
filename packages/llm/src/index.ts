import { anthropicProvider } from "./adapters/anthropic";
import { fakeProvider } from "./adapters/fake";
import { geminiProvider } from "./adapters/gemini";
import { openAICompatibleProvider } from "./adapters/openai";
import type { LLMProvider, ProviderConfig } from "./types";

export { FAKE_INVALID_KEY, fakeResponses } from "./adapters/fake";
export { LLMError, type LLMErrorCode, llmErrorCodes } from "./errors";
export * from "./types";

export type ProviderFactory = (config: ProviderConfig) => LLMProvider;

export const createProvider: ProviderFactory = (config) => {
  switch (config.kind) {
    case "anthropic":
      return anthropicProvider(config);
    case "openai":
    case "openrouter":
      return openAICompatibleProvider(config);
    case "gemini":
      return geminiProvider(config);
    case "fake":
      return fakeProvider(config);
  }
};
