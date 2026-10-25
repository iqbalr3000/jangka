import { chatMessages } from "@jangka/db";
import { fromMarkdown, toMarkdown } from "@jangka/export";
import { LLMError, type StreamEvent } from "@jangka/llm";
import {
  assessCoverage,
  checkSection,
  draftSection,
  fixDiagram,
  interview,
  reviseSection,
} from "@jangka/llm/pipelines";
import {
  type AssistantEvent,
  type ChatReference,
  chatRequest,
  draftRequest,
  reviseRequest,
} from "@jangka/shared/assistant";
import type { DocNode } from "@jangka/shared/document";
import { AppError } from "@jangka/shared/errors";
import type { TemplateSection } from "@jangka/templates";
import { type Context, Hono } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { audit } from "../lib/audit";
import { requireAuth } from "../lib/session";
import { zValidate } from "../lib/validate";
import type { Logger } from "../logger";
import { loadAccess } from "../services/access";
import {
  documentContext,
  ensureThread,
  GenerationLocks,
  loadState,
  type ResolvedLlm,
  resolveLlm,
  saveState,
  sourceContext,
  threadMessages,
  transcriptOf,
} from "../services/assistant";
import { ensureDiagrams } from "../services/diagrams";
import {
  type DocumentRow,
  requireDocEdit,
  requireNotApproved,
  saveSection,
  sectionByKey,
  sectionsOf,
  viewableDocument,
} from "../services/documents";
import { retrieveSections } from "../services/retrieval";
import type { AppEnv, RouteDeps } from "../types";

const idParam = z.object({ id: z.uuid() });
const sectionParam = z.object({ id: z.uuid(), key: z.string().regex(/^[a-z][a-z0-9_]*$/) });

type Usage = { inputTokens: number; outputTokens: number };

/** Collects a provider stream, forwarding text; returns the text and how it ended. */
async function relay(
  events: AsyncIterable<StreamEvent>,
  onText: (delta: string) => Promise<void>,
): Promise<{ text: string; usage: Usage; error: LLMError | null }> {
  let text = "";
  for await (const event of events) {
    if (event.type === "text") {
      text += event.delta;
      await onText(event.delta);
    } else if (event.type === "done") {
      return { text, usage: event.usage, error: null };
    } else {
      return { text, usage: { inputTokens: 0, outputTokens: 0 }, error: event.error };
    }
  }
  return { text, usage: { inputTokens: 0, outputTokens: 0 }, error: null };
}

export function assistantRoutes({ db, config, llm, logger, diagrams }: RouteDeps) {
  const locks = new GenerationLocks();

  /** LLM-written diagrams are rendered and, when rejected, fixed before anyone sees them. */
  function withRenderedDiagrams(
    doc: DocNode,
    resolved: ResolvedLlm,
    section: TemplateSection,
    signal: AbortSignal,
  ): Promise<DocNode> {
    return ensureDiagrams(
      doc,
      {
        checker: diagrams,
        fix: (source, error) =>
          fixDiagram(
            { provider: resolved.provider, model: resolved.model },
            { source, error, expectsDiagram: section.expectsDiagram },
            signal,
          ),
      },
      signal,
    );
  }

  async function prepare(c: Context<AppEnv>, documentId: string) {
    const auth = requireAuth(c);
    const data = await loadAccess(db, {
      userId: auth.user.id,
      isAdmin: auth.user.isAdmin,
      groupIds: auth.groupIds,
    });
    const doc = await viewableDocument(db, data, documentId);
    requireDocEdit(data, doc);
    const resolved = await resolveLlm(db, config, llm);
    return { auth, doc, resolved, data };
  }

  /**
   * Runs a generation as SSE: the document lock is held for its duration, and a client
   * disconnect aborts the provider request (hard rule #9).
   */
  function generate(
    c: Context<AppEnv>,
    doc: DocumentRow,
    run: (send: (event: AssistantEvent) => Promise<void>, signal: AbortSignal) => Promise<void>,
  ) {
    const release = locks.acquire(doc.id);
    return streamSSE(c, async (stream: SSEStreamingApi) => {
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());
      const send = async (event: AssistantEvent) => {
        if (!controller.signal.aborted) await stream.writeSSE({ data: JSON.stringify(event) });
      };
      try {
        await run(send, controller.signal);
      } catch (error) {
        logger.error({ err: error, documentId: doc.id }, "assistant stream failed");
        await send({ type: "error", code: "internal", message: "Something went wrong" });
      } finally {
        release();
      }
    });
  }

  function providerError(resolved: ResolvedLlm, error: LLMError, log: Logger): AssistantEvent {
    // A user stop isn't a provider failure.
    if (error.code !== "aborted") {
      log.warn({ providerKind: resolved.kind, reason: error.code }, "llm provider call failed");
    }
    return { type: "error", code: error.code, message: error.message };
  }

  async function saveAssistantMessage(
    threadId: string,
    input: {
      id: string;
      kind: "chat" | "draft" | "revise";
      content: string;
      interrupted: boolean;
      usage: Usage;
      resolved: ResolvedLlm;
      references?: ChatReference[];
    },
  ) {
    await db.insert(chatMessages).values({
      id: input.id,
      threadId,
      role: "assistant",
      kind: input.kind,
      content: input.content,
      interrupted: input.interrupted,
      providerKind: input.resolved.kind,
      model: input.resolved.model,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
      references: input.references ?? [],
    });
  }

  return new Hono<AppEnv>()
    .get("/:id/chat", zValidate("param", idParam), async (c) => {
      const auth = requireAuth(c);
      const data = await loadAccess(db, {
        userId: auth.user.id,
        isAdmin: auth.user.isAdmin,
        groupIds: auth.groupIds,
      });
      const doc = await viewableDocument(db, data, c.req.valid("param").id);
      return c.json({
        messages: await threadMessages(db, doc.id),
        state: await loadState(db, doc.id),
      });
    })
    .post("/:id/chat", zValidate("param", idParam), zValidate("json", chatRequest), async (c) => {
      const { auth, doc, resolved, data } = await prepare(c, c.req.valid("param").id);
      const { message } = c.req.valid("json");
      const threadId = await ensureThread(db, doc.id, auth.user.id);
      await db.insert(chatMessages).values({
        threadId,
        role: "user",
        kind: "chat",
        content: message,
        createdBy: auth.user.id,
      });
      await audit(c, { action: "assistant.chat", targetType: "document", targetId: doc.id });

      return generate(c, doc, async (send, signal) => {
        const messageId = uuidv7();
        await send({ type: "message_start", messageId });
        const { context } = await documentContext(db, doc, data);
        const transcript = transcriptOf(await threadMessages(db, doc.id));
        const common = { provider: resolved.provider, model: resolved.model };

        // Other documents only from what this user can view (FR-075); the source is already in context.
        const related = await retrieveSections(db, data, {
          query: message,
          excludeDocumentIds: [doc.id, ...(doc.sourceDocumentId ? [doc.sourceDocumentId] : [])],
        });
        const references = related.map(({ markdown: _markdown, ...reference }) => reference);
        if (references.length > 0) await send({ type: "references", items: references });

        const result = await relay(
          interview(common, { doc: { ...context, related }, transcript }, signal),
          (delta) => send({ type: "text", delta }),
        );
        const interrupted = result.error !== null;
        await saveAssistantMessage(threadId, {
          id: messageId,
          kind: "chat",
          content: result.text,
          interrupted,
          usage: result.usage,
          resolved,
          references,
        });
        if (result.error) {
          await send(providerError(resolved, result.error, logger));
          return;
        }

        try {
          const transcriptNow = transcriptOf(await threadMessages(db, doc.id));
          const state = await assessCoverage(
            common,
            { doc: context, transcript: transcriptNow },
            signal,
          );
          await saveState(db, doc.id, state);
          await send({ type: "coverage", state });
        } catch (error) {
          // Coverage is advisory: the reply is already saved, so a failed assessment isn't fatal.
          if (error instanceof LLMError) {
            logger.warn({ providerKind: resolved.kind }, "coverage assessment failed");
          } else {
            throw error;
          }
        }
        await send({ type: "done", usage: result.usage });
      });
    })
    .post("/:id/draft", zValidate("param", idParam), zValidate("json", draftRequest), async (c) => {
      const { auth, doc, resolved, data } = await prepare(c, c.req.valid("param").id);
      requireNotApproved(doc);
      const { sections: requested, force, fromSource } = c.req.valid("json");
      if (fromSource && !(await sourceContext(db, doc, data))) {
        throw new AppError("invalid_source", 409, "This document has no source you can view");
      }
      const { template } = await documentContext(db, doc, data);
      const current = await sectionsOf(db, doc);
      const known = new Set(current.map((s) => s.key));
      for (const key of requested ?? []) {
        if (!known.has(key)) throw new AppError("not_found", 404, `Unknown section: ${key}`);
      }
      // Draft all touches only empty sections; explicit requests may overwrite.
      const targets =
        requested ?? current.filter((s) => s.completeness === "empty").map((s) => s.key);
      const state = await loadState(db, doc.id);
      let coverage = new Map(state?.sections.map((s) => [s.key, s]) ?? []);
      const missingRequired = template.sections.filter(
        (s) =>
          s.required &&
          targets.includes(s.key) &&
          (coverage.get(s.key)?.coverage ?? "missing") === "missing",
      );
      // From a source, coverage is assessed in the stream below, so the gate doesn't apply yet.
      if (!force && !fromSource && missingRequired.length > 0) {
        throw new AppError(
          "coverage_incomplete",
          409,
          `${missingRequired.length} required sections lack information`,
          { sections: missingRequired.map((s) => s.key) },
        );
      }
      const threadId = await ensureThread(db, doc.id, auth.user.id);
      await audit(c, {
        action: "assistant.draft",
        targetType: "document",
        targetId: doc.id,
        metadata: { sections: targets },
      });

      return generate(c, doc, async (send, signal) => {
        const messageId = uuidv7();
        await send({ type: "message_start", messageId });
        const transcript = transcriptOf(await threadMessages(db, doc.id));
        const common = { provider: resolved.provider, model: resolved.model };
        const usage = { inputTokens: 0, outputTokens: 0 };
        const drafted: string[] = [];
        const skipped: string[] = [];
        let stopped = false;

        if (fromSource) {
          const { context } = await documentContext(db, doc, data);
          try {
            const assessed = await assessCoverage(common, { doc: context, transcript }, signal);
            await saveState(db, doc.id, assessed);
            await send({ type: "coverage", state: assessed });
            coverage = new Map(assessed.sections.map((s) => [s.key, s]));
          } catch (error) {
            if (!(error instanceof LLMError)) throw error;
            await send(providerError(resolved, error, logger));
            return;
          }
        }

        for (const key of targets) {
          const section = template.sections.find((s) => s.key === key);
          if (!section) continue;
          const sectionCoverage = coverage.get(key);
          if ((sectionCoverage?.coverage ?? "missing") === "missing") {
            skipped.push(section.title);
            await send({ type: "section_skipped", key, reason: "missing_coverage" });
            continue;
          }
          const before = await sectionByKey(db, doc, key);
          await send({ type: "section_start", key });
          // Context is reloaded per section so later sections see earlier drafts.
          const { context } = await documentContext(db, doc, data);
          const result = await relay(
            draftSection(
              common,
              { doc: context, transcript, section, note: sectionCoverage?.note ?? "" },
              signal,
            ),
            (delta) => send({ type: "text", delta, sectionKey: key }),
          );
          usage.inputTokens += result.usage.inputTokens;
          usage.outputTokens += result.usage.outputTokens;
          if (result.error) {
            // The section in progress is discarded; finished ones stay.
            await send(providerError(resolved, result.error, logger));
            stopped = true;
            break;
          }

          const content = await withRenderedDiagrams(
            fromMarkdown(result.text),
            resolved,
            section,
            signal,
          );
          const check = await checkSection(
            common,
            { section, markdown: result.text },
            signal,
          ).catch(() => ({ completeness: "partial" as const, note: "" }));
          if (signal.aborted) {
            stopped = true;
            break;
          }
          const saved = await saveSection(db, doc.id, key, {
            content,
            revision: before.revision,
            userId: auth.user.id,
            source: "llm",
            completeness: check.completeness,
          });
          if (saved === "conflict") {
            await send({ type: "section_conflict", key });
            continue;
          }
          drafted.push(section.title);
          await send({ type: "section_done", section: await sectionByKey(db, doc, key) });
        }

        const summary = [
          drafted.length ? `Drafted ${drafted.join(", ")}.` : "Nothing was drafted.",
          skipped.length ? `Skipped (not enough information yet): ${skipped.join(", ")}.` : "",
        ]
          .filter(Boolean)
          .join(" ");
        await saveAssistantMessage(threadId, {
          id: messageId,
          kind: "draft",
          content: summary,
          interrupted: stopped,
          usage,
          resolved,
        });
        await send({ type: "done", usage });
      });
    })
    .post(
      "/:id/sections/:key/revise",
      zValidate("param", sectionParam),
      zValidate("json", reviseRequest),
      async (c) => {
        const { id, key } = c.req.valid("param");
        const { auth, doc, resolved, data } = await prepare(c, id);
        // A proposal couldn't be accepted anyway while the document is approved.
        requireNotApproved(doc);
        const { instruction } = c.req.valid("json");
        const { template } = await documentContext(db, doc, data);
        const section = template.sections.find((s) => s.key === key);
        if (!section) throw new AppError("not_found", 404, "Section not found");
        const threadId = await ensureThread(db, doc.id, auth.user.id);
        await db.insert(chatMessages).values({
          threadId,
          role: "user",
          kind: "revise",
          content: `@${section.title} ${instruction}`,
          createdBy: auth.user.id,
        });
        await audit(c, {
          action: "assistant.revise",
          targetType: "document",
          targetId: doc.id,
          metadata: { section: key },
        });

        return generate(c, doc, async (send, signal) => {
          const messageId = uuidv7();
          await send({ type: "message_start", messageId });
          const { context } = await documentContext(db, doc, data);
          const current = context.sections.find((s) => s.key === key)?.markdown ?? "";
          const result = await relay(
            reviseSection(
              { provider: resolved.provider, model: resolved.model },
              { doc: context, section, current, instruction },
              signal,
            ),
            (delta) => send({ type: "text", delta, sectionKey: key }),
          );
          await saveAssistantMessage(threadId, {
            id: messageId,
            kind: "revise",
            content: result.error
              ? `Couldn't revise ${section.title}.`
              : `Proposed changes to ${section.title}. Review them in the document.`,
            interrupted: result.error !== null,
            usage: result.usage,
            resolved,
          });
          if (result.error) {
            await send(providerError(resolved, result.error, logger));
            return;
          }
          const proposed = fromMarkdown(result.text);
          const rendered = await withRenderedDiagrams(proposed, resolved, section, signal);
          if (rendered !== proposed) {
            await send({ type: "proposal", sectionKey: key, markdown: toMarkdown(rendered) });
          }
          await send({ type: "done", usage: result.usage });
        });
      },
    );
}
