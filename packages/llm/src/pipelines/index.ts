import { coverageLevel, type InterviewState } from "@jangka/shared/assistant";
import { MAX_MERMAID_CHARS } from "@jangka/shared/document";
import type { TemplateDefinition, TemplateSection } from "@jangka/templates";
import { z } from "zod";
import type { LLMProvider, StreamEvent } from "../types";
import {
  checkSystem,
  coverageSystem,
  type DocumentContext,
  draftSystem,
  fixDiagramMessage,
  fixDiagramSystem,
  interviewSystem,
  reviseMessage,
  reviseSystem,
  type Turn,
  transcriptMessage,
} from "./prompts";

export type { DocumentContext, SectionContext, SourceContext, Turn } from "./prompts";

export const DEFAULT_CONTEXT_TOKENS = 128_000;
const BUDGET_SHARE = 0.7;
const CLIPPED_SECTION_CHARS = 600;

/** Rough but provider-independent: ~4 characters per token. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Keeps the prompt within 70% of the model's context: drops the oldest turns (the first user
 * message stays: it usually states the problem), then clips sections other than `focusKey`.
 */
export function fitBudget(
  input: { doc: DocumentContext; transcript: Turn[]; focusKey?: string },
  contextWindow = DEFAULT_CONTEXT_TOKENS,
): { doc: DocumentContext; transcript: Turn[] } {
  const budget = Math.floor(contextWindow * BUDGET_SHARE);
  const guidance = input.doc.template.sections.map((s) => s.guidance).join("");
  const size = (doc: DocumentContext, transcript: Turn[]) =>
    estimateTokens(guidance) +
    estimateTokens(doc.source?.markdown ?? "") +
    doc.sections.reduce((n, s) => n + estimateTokens(s.markdown), 0) +
    transcript.reduce((n, t) => n + estimateTokens(t.content), 0);

  const transcript = [...input.transcript];
  while (size(input.doc, transcript) > budget && transcript.length > 1) transcript.splice(1, 1);

  const clip = (markdown: string) =>
    markdown.length <= CLIPPED_SECTION_CHARS
      ? markdown
      : `${markdown.slice(0, CLIPPED_SECTION_CHARS)}… (truncated)`;
  let doc = input.doc;
  if (size(doc, transcript) > budget) {
    doc = {
      ...doc,
      sections: doc.sections.map((s) =>
        s.key === input.focusKey ? s : { ...s, markdown: clip(s.markdown) },
      ),
    };
  }
  // The source's requirement list is kept whole: drafts cite its codes.
  if (doc.source && size(doc, transcript) > budget) {
    doc = { ...doc, source: { ...doc.source, markdown: clip(doc.source.markdown) } };
  }
  return { doc, transcript };
}

/** Provider APIs want user/assistant alternation starting with the user. */
export function toTurns(messages: Turn[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (!message.content.trim()) continue;
    const last = turns.at(-1);
    if (last?.role === message.role) last.content = `${last.content}\n\n${message.content}`;
    else if (turns.length > 0 || message.role === "user") turns.push({ ...message });
  }
  return turns;
}

/** Keys come from the template, so the model can't invent sections. */
export function coverageSchema(template: TemplateDefinition) {
  const keys = template.sections.map((s) => s.key);
  return z.object({
    coverage: z.object(Object.fromEntries(keys.map((k) => [k, coverageLevel]))),
    notes: z.object(Object.fromEntries(keys.map((k) => [k, z.string().max(300)]))),
    openQuestions: z.array(z.string().max(300)).max(10),
    readyToDraft: z.boolean(),
  });
}

export function normalizeCoverage(
  template: TemplateDefinition,
  result: z.infer<ReturnType<typeof coverageSchema>>,
): InterviewState {
  const sections = template.sections.map((s) => {
    const level = coverageLevel.safeParse(result.coverage[s.key]);
    return {
      key: s.key,
      coverage: level.success ? level.data : ("missing" as const),
      note: String(result.notes[s.key] ?? ""),
    };
  });
  const readyToDraft = template.sections.every(
    (s, i) => !s.required || sections[i]?.coverage !== "missing",
  );
  return { sections, openQuestions: result.openQuestions, readyToDraft };
}

type Common = { provider: LLMProvider; model: string; contextWindow?: number };

export function interview(
  { provider, model, contextWindow }: Common,
  input: { doc: DocumentContext; transcript: Turn[] },
  signal?: AbortSignal,
): AsyncIterable<StreamEvent> {
  const fitted = fitBudget(
    { doc: input.doc, transcript: toTurns(input.transcript) },
    contextWindow,
  );
  return provider.streamText(
    { model, system: interviewSystem(fitted.doc), messages: fitted.transcript },
    signal,
  );
}

export async function assessCoverage(
  { provider, model, contextWindow }: Common,
  input: { doc: DocumentContext; transcript: Turn[] },
  signal?: AbortSignal,
): Promise<InterviewState> {
  const fitted = fitBudget(
    { doc: input.doc, transcript: toTurns(input.transcript) },
    contextWindow,
  );
  const result = await provider.generateObject(
    {
      model,
      system: coverageSystem(fitted.doc),
      messages: [
        {
          role: "user",
          content: transcriptMessage(fitted.transcript, "", "Assess the coverage now."),
        },
      ],
    },
    coverageSchema(input.doc.template),
    signal,
  );
  return normalizeCoverage(input.doc.template, result);
}

export function draftSection(
  { provider, model, contextWindow }: Common,
  input: { doc: DocumentContext; transcript: Turn[]; section: TemplateSection; note: string },
  signal?: AbortSignal,
): AsyncIterable<StreamEvent> {
  const fitted = fitBudget(
    { doc: input.doc, transcript: toTurns(input.transcript), focusKey: input.section.key },
    contextWindow,
  );
  return provider.streamText(
    {
      model,
      system: draftSystem(fitted.doc, input.section),
      messages: [{ role: "user", content: transcriptMessage(fitted.transcript, input.note) }],
    },
    signal,
  );
}

export const sectionCheck = z.object({
  completeness: z.enum(["partial", "complete"]),
  note: z.string().max(300),
});

export function checkSection(
  { provider, model }: Common,
  input: { section: TemplateSection; markdown: string },
  signal?: AbortSignal,
): Promise<z.infer<typeof sectionCheck>> {
  return provider.generateObject(
    {
      model,
      system: checkSystem(input.section),
      messages: [{ role: "user", content: input.markdown }],
    },
    sectionCheck,
    signal,
  );
}

export function reviseSection(
  { provider, model, contextWindow }: Common,
  input: { doc: DocumentContext; section: TemplateSection; current: string; instruction: string },
  signal?: AbortSignal,
): AsyncIterable<StreamEvent> {
  const fitted = fitBudget(
    { doc: input.doc, transcript: [], focusKey: input.section.key },
    contextWindow,
  );
  return provider.streamText(
    {
      model,
      system: reviseSystem(fitted.doc, input.section),
      messages: [{ role: "user", content: reviseMessage(input.current, input.instruction) }],
    },
    signal,
  );
}

export const fixedDiagram = z.object({
  source: z.string().trim().min(1).max(MAX_MERMAID_CHARS),
});

/** One LLM attempt at fixing a diagram the renderer rejected; the caller re-renders it. */
export async function fixDiagram(
  { provider, model }: Common,
  input: { source: string; error: string; expectsDiagram?: string },
  signal?: AbortSignal,
): Promise<string> {
  const result = await provider.generateObject(
    {
      model,
      system: fixDiagramSystem(input.expectsDiagram),
      messages: [{ role: "user", content: fixDiagramMessage(input.source, input.error) }],
    },
    fixedDiagram,
    signal,
  );
  // Models sometimes wrap the answer in a fence despite the instruction.
  return result.source.replace(/^```(?:mermaid)?\n?|\n?```$/g, "").trim();
}
