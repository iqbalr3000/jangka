import {
  chatMessages,
  chatThreads,
  type Database,
  documentSections,
  interviewStates,
  llmProviders,
  requirements,
  type Transaction,
  templates,
  users,
} from "@jangka/db";
import type { LLMProvider, ProviderFactory, ProviderKind } from "@jangka/llm";
import type { DocumentContext, SourceContext, Turn } from "@jangka/llm/pipelines";
import {
  type ChatMessage,
  chatReference,
  type InterviewState,
  interviewState,
} from "@jangka/shared/assistant";
import { AppError } from "@jangka/shared/errors";
import type { TemplateDefinition } from "@jangka/templates";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppConfig } from "../types";
import { type AccessData, resolveDocLevel } from "./access";
import { type DocumentRow, findDocument } from "./documents";
import { defaultProvider, storedConfig } from "./llm-providers";
import { definitionOf } from "./templates";

type Db = Database | Transaction;

export type ResolvedLlm = { provider: LLMProvider; kind: ProviderKind; model: string };

/** The instance default provider + model, or `409 llm_not_configured`. */
export async function resolveLlm(
  db: Db,
  config: AppConfig,
  factory: ProviderFactory,
): Promise<ResolvedLlm> {
  const { providerId, model } = await defaultProvider(db);
  const [row] = providerId
    ? await db.select().from(llmProviders).where(eq(llmProviders.id, providerId))
    : [];
  if (!row?.enabled || !model) {
    throw new AppError("llm_not_configured", 409, "Add an LLM provider to start drafting");
  }
  return { provider: factory(storedConfig(row, config.masterKey)), kind: row.kind, model };
}

/** One generation per document at a time (single-instance app, like the rate limiter). */
export class GenerationLocks {
  private readonly held = new Set<string>();

  acquire(documentId: string): () => void {
    if (this.held.has(documentId)) {
      throw new AppError(
        "generation_in_progress",
        409,
        "The assistant is already working on this document",
      );
    }
    this.held.add(documentId);
    return () => this.held.delete(documentId);
  }
}

export async function ensureThread(db: Db, documentId: string, userId: string): Promise<string> {
  await db.insert(chatThreads).values({ documentId, createdBy: userId }).onConflictDoNothing();
  const [thread] = await db
    .select({ id: chatThreads.id })
    .from(chatThreads)
    .where(eq(chatThreads.documentId, documentId));
  if (!thread) throw new Error("chat thread missing");
  return thread.id;
}

export async function threadMessages(db: Db, documentId: string): Promise<ChatMessage[]> {
  const rows = await db
    .select({ message: chatMessages, authorName: users.name })
    .from(chatMessages)
    .innerJoin(chatThreads, eq(chatThreads.id, chatMessages.threadId))
    .leftJoin(users, eq(users.id, chatMessages.createdBy))
    .where(eq(chatThreads.documentId, documentId))
    .orderBy(asc(chatMessages.id));
  return rows.map(({ message, authorName }) => ({
    id: message.id,
    role: message.role,
    kind: message.kind,
    content: message.content,
    author: message.createdBy && authorName ? { id: message.createdBy, name: authorName } : null,
    interrupted: message.interrupted,
    createdAt: message.createdAt.toISOString(),
    // Stored by this app; invalid entries (none expected) are dropped rather than failing the thread.
    references: z.array(chatReference).catch([]).parse(message.references),
  }));
}

/** Interview turns only: draft/revise notes aren't part of the conversation the model sees. */
export function transcriptOf(messages: ChatMessage[]): Turn[] {
  return messages
    .filter((m) => m.kind === "chat")
    .map((m) => ({ role: m.role, content: m.content }));
}

export async function loadState(db: Db, documentId: string): Promise<InterviewState | null> {
  const [row] = await db
    .select()
    .from(interviewStates)
    .where(eq(interviewStates.documentId, documentId));
  if (!row) return null;
  const parsed = interviewState.safeParse(row.state);
  return parsed.success ? parsed.data : null;
}

export async function saveState(db: Db, documentId: string, state: InterviewState): Promise<void> {
  await db
    .insert(interviewStates)
    .values({ documentId, state })
    .onConflictDoUpdate({
      target: interviewStates.documentId,
      set: { state, updatedAt: new Date() },
    });
}

async function sectionsWithTitles(db: Db, row: DocumentRow) {
  const [templateRow] = await db.select().from(templates).where(eq(templates.id, row.templateId));
  if (!templateRow) throw new Error("document template missing");
  const template = definitionOf(templateRow);
  const sections = await db
    .select({
      key: documentSections.sectionKey,
      markdown: documentSections.contentMd,
    })
    .from(documentSections)
    .where(eq(documentSections.documentId, row.id))
    .orderBy(asc(documentSections.position));
  const titles = new Map(template.sections.map((s) => [s.key, s.title]));
  return {
    template,
    sections: sections.map((s) => ({ ...s, title: titles.get(s.key) ?? s.key })),
  };
}

/** The source document as LLM context, or null when there is none or `viewer` can't view it. */
export async function sourceContext(
  db: Db,
  row: DocumentRow,
  viewer: AccessData,
): Promise<SourceContext | null> {
  const source = row.sourceDocumentId ? await findDocument(db, row.sourceDocumentId) : undefined;
  if (!source || resolveDocLevel(viewer, source) === "none") return null;
  const { sections } = await sectionsWithTitles(db, source);
  const rows = await db
    .select({ code: requirements.code, text: requirements.text })
    .from(requirements)
    .where(eq(requirements.documentId, source.id))
    .orderBy(asc(requirements.code));
  return {
    docType: source.docType,
    title: source.title,
    markdown: sections
      .filter((s) => s.markdown.trim())
      .map((s) => `## ${s.title}\n${s.markdown}`)
      .join("\n\n"),
    requirements: rows,
  };
}

/** LLM context for `row`; the source is included only when `viewer` can view it (SPEC §4). */
export async function documentContext(
  db: Db,
  row: DocumentRow,
  viewer: AccessData,
): Promise<{ template: TemplateDefinition; context: DocumentContext }> {
  const { template, sections } = await sectionsWithTitles(db, row);
  const source = await sourceContext(db, row, viewer);
  return {
    template,
    context: { template, title: row.title, sections, ...(source ? { source } : {}) },
  };
}
