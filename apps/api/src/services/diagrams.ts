import { type Database, diagramRenders } from "@jangka/db";
import { mapMermaid, mermaidBlocks } from "@jangka/export";
import { diagramHash } from "@jangka/export/render";
import { LLMError } from "@jangka/llm";
import type { DocNode } from "@jangka/shared/document";
import { JOBS, type JobQueue } from "@jangka/worker/jobs";
import { eq } from "drizzle-orm";

/** `null`: no verdict (worker down, timeout, or aborted); the source is kept as is. */
export type DiagramCheck = { ok: true } | { error: string } | null;

export interface DiagramChecker {
  check(source: string, signal: AbortSignal): Promise<DiagramCheck>;
}

const POLL_MS = 250;
const WAIT_MS = 20_000;
/** Fix attempts per diagram before keeping the source with its error badge. */
export const MAX_DIAGRAM_FIXES = 2;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

/** Asks the worker to render (via the queue) and waits for the cache row it writes. */
export function queuedDiagramChecker(db: Database, queue: JobQueue): DiagramChecker {
  async function lookup(hash: string): Promise<DiagramCheck> {
    const [row] = await db
      .select({ error: diagramRenders.error })
      .from(diagramRenders)
      .where(eq(diagramRenders.sourceHash, hash));
    if (!row) return null;
    return row.error === null ? { ok: true } : { error: row.error };
  }

  return {
    async check(source, signal) {
      const hash = diagramHash(source);
      const cached = await lookup(hash);
      if (cached) return cached;
      await queue.send(JOBS.diagramRender, { source });
      const deadline = Date.now() + WAIT_MS;
      while (!signal.aborted && Date.now() < deadline) {
        await sleep(POLL_MS, signal);
        const result = await lookup(hash);
        if (result) return result;
      }
      return null;
    },
  };
}

/**
 * Renders every diagram in `doc`; a rejected one goes back to the LLM with the error (at most
 * MAX_DIAGRAM_FIXES times). Only a fix that renders replaces the source.
 */
export async function ensureDiagrams(
  doc: DocNode,
  deps: {
    checker: DiagramChecker;
    fix: (source: string, error: string) => Promise<string>;
  },
  signal: AbortSignal,
): Promise<DocNode> {
  const replacements = new Map<string, string>();
  for (const source of new Set(mermaidBlocks(doc))) {
    let current = source;
    for (let attempt = 0; attempt <= MAX_DIAGRAM_FIXES && !signal.aborted; attempt++) {
      const result = await deps.checker.check(current, signal);
      if (result === null) break;
      if ("ok" in result) {
        if (current !== source) replacements.set(source, current);
        break;
      }
      if (attempt === MAX_DIAGRAM_FIXES) break;
      try {
        current = await deps.fix(current, result.error);
      } catch (error) {
        // Fixing is best effort: a provider failure keeps the source.
        if (error instanceof LLMError) break;
        throw error;
      }
    }
  }
  return replacements.size ? mapMermaid(doc, (s) => replacements.get(s) ?? s) : doc;
}
