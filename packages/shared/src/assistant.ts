import { z } from "zod";
import { section } from "./document";

export const coverageLevel = z.enum(["missing", "partial", "covered"]);
export type CoverageLevel = z.infer<typeof coverageLevel>;

/** Normalized to every template section, in template order. */
export const interviewState = z.object({
  sections: z.array(z.object({ key: z.string(), coverage: coverageLevel, note: z.string() })),
  openQuestions: z.array(z.string()),
  readyToDraft: z.boolean(),
});
export type InterviewState = z.infer<typeof interviewState>;

export const chatMessage = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  kind: z.enum(["chat", "draft", "revise"]),
  content: z.string(),
  author: z.object({ id: z.string(), name: z.string() }).nullable(),
  interrupted: z.boolean(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessage>;

export const chatThread = z.object({
  messages: z.array(chatMessage),
  state: interviewState.nullable(),
});
export type ChatThread = z.infer<typeof chatThread>;

const sectionKey = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const chatRequest = z.object({ message: z.string().trim().min(1).max(8000) });
export const draftRequest = z.object({
  /** Omitted = every empty section. */
  sections: z.array(sectionKey).min(1).max(50).optional(),
  /** Draft even when required sections lack coverage (those stay empty). */
  force: z.boolean().optional(),
});
export const reviseRequest = z.object({ instruction: z.string().trim().min(1).max(2000) });

/** Server-sent events of every assistant stream; mirrors `StreamEvent` from packages/llm. */
export const assistantEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message_start"), messageId: z.string() }),
  z.object({ type: z.literal("text"), delta: z.string(), sectionKey: z.string().optional() }),
  z.object({ type: z.literal("section_start"), key: z.string() }),
  z.object({ type: z.literal("section_done"), section }),
  z.object({
    type: z.literal("section_skipped"),
    key: z.string(),
    reason: z.literal("missing_coverage"),
  }),
  z.object({ type: z.literal("section_conflict"), key: z.string() }),
  z.object({ type: z.literal("coverage"), state: interviewState }),
  z.object({
    type: z.literal("done"),
    usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type AssistantEvent = z.infer<typeof assistantEvent>;
