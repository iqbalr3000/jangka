import { z } from "zod";
import { MAX_MERMAID_CHARS, section } from "./document";

export const coverageLevel = z.enum(["missing", "partial", "covered"]);
export type CoverageLevel = z.infer<typeof coverageLevel>;

/** Normalized to every template section, in template order. */
export const interviewState = z.object({
  sections: z.array(z.object({ key: z.string(), coverage: coverageLevel, note: z.string() })),
  openQuestions: z.array(z.string()),
  readyToDraft: z.boolean(),
});
export type InterviewState = z.infer<typeof interviewState>;

/** A section of another (viewable) document the assistant drew on. */
export const chatReference = z.object({
  documentId: z.string(),
  title: z.string(),
  docType: z.enum(["brd", "prd", "tsd"]),
  sectionKey: z.string(),
  sectionTitle: z.string(),
});
export type ChatReference = z.infer<typeof chatReference>;

export const chatMessage = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  kind: z.enum(["chat", "draft", "revise"]),
  content: z.string(),
  author: z.object({ id: z.string(), name: z.string() }).nullable(),
  interrupted: z.boolean(),
  createdAt: z.string(),
  references: z.array(chatReference),
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
  /** Assess coverage from the source document first, then draft every empty section. */
  fromSource: z.boolean().optional(),
});
export const reviseRequest = z.object({ instruction: z.string().trim().min(1).max(2000) });
/** A diagram the editor couldn't render, with the renderer's error. */
export const fixDiagramRequest = z.object({
  source: z.string().trim().min(1).max(MAX_MERMAID_CHARS),
  error: z.string().trim().min(1).max(2000),
});
export const fixDiagramResponse = z.object({ source: z.string() });

/** Server-sent events of every assistant stream; mirrors `StreamEvent` from packages/llm. */
export const assistantEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message_start"), messageId: z.string() }),
  z.object({ type: z.literal("references"), items: z.array(chatReference) }),
  z.object({ type: z.literal("text"), delta: z.string(), sectionKey: z.string().optional() }),
  z.object({ type: z.literal("section_start"), key: z.string() }),
  z.object({ type: z.literal("section_done"), section }),
  z.object({
    type: z.literal("section_skipped"),
    key: z.string(),
    reason: z.literal("missing_coverage"),
  }),
  z.object({ type: z.literal("section_conflict"), key: z.string() }),
  /** Replaces the streamed revision text (e.g. after diagrams were fixed). */
  z.object({ type: z.literal("proposal"), sectionKey: z.string(), markdown: z.string() }),
  z.object({ type: z.literal("coverage"), state: interviewState }),
  z.object({
    type: z.literal("done"),
    usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }),
  }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);
export type AssistantEvent = z.infer<typeof assistantEvent>;
