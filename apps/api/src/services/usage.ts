import { type Database, type LLM_OPERATIONS, llmUsage } from "@jangka/db";
import type { Usage } from "@jangka/llm";
import type { ResolvedLlm } from "./assistant";

export type LlmOperation = (typeof LLM_OPERATIONS)[number];

/** Sums the usage a pipeline reports (structured calls report once per attempt). */
export function usageMeter() {
  const total: Usage = { inputTokens: 0, outputTokens: 0 };
  return {
    total,
    onUsage: (usage: Usage) => {
      total.inputTokens += usage.inputTokens;
      total.outputTokens += usage.outputTokens;
    },
  };
}

/** One row per pipeline run; runs that never reached the provider (0 tokens) aren't recorded. */
export async function recordUsage(
  db: Database,
  input: {
    userId: string;
    documentId: string | null;
    operation: LlmOperation;
    resolved: ResolvedLlm;
    usage: Usage;
  },
): Promise<void> {
  if (input.usage.inputTokens === 0 && input.usage.outputTokens === 0) return;
  await db.insert(llmUsage).values({
    userId: input.userId,
    documentId: input.documentId,
    providerKind: input.resolved.kind,
    model: input.resolved.model,
    operation: input.operation,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
  });
}
