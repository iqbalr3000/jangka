import { diagramRenders } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { mermaidBlocks } from "@jangka/export";
import { diagramHash } from "@jangka/export/render";
import { createProvider, fakeResponses, LLMError, type ProviderFactory } from "@jangka/llm";
import { type AssistantEvent, assistantEvent } from "@jangka/shared/assistant";
import { type DocNode, documentDetail, documentSummary } from "@jangka/shared/document";
import { builtinTemplates } from "@jangka/templates";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  type DiagramCheck,
  type DiagramChecker,
  ensureDiagrams,
  queuedDiagramChecker,
} from "../src/services/diagrams";
import {
  buildApp,
  call,
  ORIGIN,
  RecordingQueue,
  setupInstance,
  type TestApp,
  testDatabase,
} from "./helpers";

const { db, pool } = testDatabase();
afterAll(async () => {
  await pool.end();
});

const BROKEN = "flowchart TD\n  A -->";
const FIXED = "flowchart TD\n  A --> B";
const STILL_BROKEN = "flowchart TD\n  A -->>";

const doc = (...sources: string[]): DocNode => ({
  type: "doc",
  content: sources.map((source) => ({ type: "mermaidBlock", attrs: { source } })),
});

/** Verdicts by source; unknown sources render fine. Records what was checked. */
function checker(verdicts: Record<string, DiagramCheck>): DiagramChecker & { checked: string[] } {
  const checked: string[] = [];
  return {
    checked,
    async check(source) {
      checked.push(source);
      return source in verdicts ? (verdicts[source] ?? null) : { ok: true };
    },
  };
}

const never = new AbortController().signal;

describe("ensureDiagrams", () => {
  it("replaces a rejected diagram with a fix that renders", async () => {
    const check = checker({ [BROKEN]: { error: "Parse error" } });
    const fixes: string[] = [];
    const out = await ensureDiagrams(
      doc(BROKEN),
      {
        checker: check,
        fix: async (source, error) => {
          fixes.push(`${source}|${error}`);
          return FIXED;
        },
      },
      never,
    );
    expect(mermaidBlocks(out)).toEqual([FIXED]);
    expect(fixes).toEqual([`${BROKEN}|Parse error`]);
    expect(check.checked).toEqual([BROKEN, FIXED]);
  });

  it("keeps the source after two failed fixes", async () => {
    const check = checker({
      [BROKEN]: { error: "e1" },
      [STILL_BROKEN]: { error: "e2" },
    });
    let fixes = 0;
    const input = doc(BROKEN);
    const out = await ensureDiagrams(
      input,
      {
        checker: check,
        fix: async () => {
          fixes++;
          return STILL_BROKEN;
        },
      },
      never,
    );
    expect(out).toBe(input);
    expect(fixes).toBe(2);
    expect(check.checked).toHaveLength(3);
  });

  it("keeps the source when there is no verdict or the fix call fails", async () => {
    const fix = async () => FIXED;
    const input = doc(BROKEN);
    expect(await ensureDiagrams(input, { checker: checker({ [BROKEN]: null }), fix }, never)).toBe(
      input,
    );
    const failing = async (): Promise<string> => {
      throw new LLMError("rate_limit");
    };
    expect(
      await ensureDiagrams(
        input,
        { checker: checker({ [BROKEN]: { error: "x" } }), fix: failing },
        never,
      ),
    ).toBe(input);
  });

  it("checks each distinct source once and stops when aborted", async () => {
    const check = checker({});
    await ensureDiagrams(doc(FIXED, FIXED), { checker: check, fix: async () => FIXED }, never);
    expect(check.checked).toEqual([FIXED]);

    const aborted = new AbortController();
    aborted.abort();
    const none = checker({});
    await ensureDiagrams(doc(FIXED), { checker: none, fix: async () => FIXED }, aborted.signal);
    expect(none.checked).toEqual([]);
  });
});

describe("queuedDiagramChecker", () => {
  beforeEach(async () => {
    await truncateAll(pool);
  });

  it("answers from the cache without queueing", async () => {
    await db.insert(diagramRenders).values({ sourceHash: diagramHash(BROKEN), error: "bad" });
    const queue = new RecordingQueue();
    const result = await queuedDiagramChecker(db, queue).check(BROKEN, never);
    expect(result).toEqual({ error: "bad" });
    expect(queue.sent).toEqual([]);
  });

  it("queues a render and waits for the row the worker writes", async () => {
    const queue = new RecordingQueue();
    const pending = queuedDiagramChecker(db, queue).check(FIXED, never);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(queue.sent).toEqual([{ name: "diagram.render", payload: { source: FIXED } }]);
    await db
      .insert(diagramRenders)
      .values({ sourceHash: diagramHash(FIXED), svg: "<svg/>", png: Buffer.from("png") });
    expect(await pending).toEqual({ ok: true });
  });

  it("gives up without a verdict when aborted", async () => {
    const controller = new AbortController();
    const pending = queuedDiagramChecker(db, new RecordingQueue()).check(FIXED, controller.signal);
    setTimeout(() => controller.abort(), 100);
    expect(await pending).toBeNull();
  });
});

describe("assistant writes rendered diagrams", () => {
  const template = builtinTemplates[0];
  if (!template) throw new Error("PRD template missing");
  const KEYS = template.sections.map((s) => s.key);
  const MARKDOWN = `The flow:\n\n\`\`\`mermaid\n${BROKEN}\n\`\`\``;

  // The fake provider, but every stream answers with a broken diagram.
  const llm: ProviderFactory = (config) => {
    const provider = createProvider(config);
    return {
      ...provider,
      async *streamText() {
        yield { type: "text", delta: MARKDOWN };
        yield { type: "done", usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
  };

  let app: TestApp;
  let cookie: string;
  let docId: string;

  beforeEach(async () => {
    await truncateAll(pool);
    app = buildApp(db, pool, {
      llm,
      diagrams: checker({ [BROKEN]: { error: "Parse error on line 2" } }),
    }).app;
    cookie = await setupInstance(app, db);
    await call(app, "POST", "/admin/llm-providers", {
      cookie,
      body: { kind: "fake", label: "Fake", apiKey: "", defaultModel: "fake-small" },
    });
    const res = await call(app, "POST", "/documents", {
      cookie,
      body: { title: "Refunds", collectionId: null, docType: "prd" },
    });
    docId = documentSummary.parse(await res.json()).id;
  });

  async function stream(path: string, body: unknown): Promise<AssistantEvent[]> {
    const res = await app.request(`/api/v1${path}`, {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return text
      .split("\n\n")
      .map((frame) => frame.replace(/^data: ?/m, ""))
      .filter((data) => data.startsWith("{"))
      .map((data) => assistantEvent.parse(JSON.parse(data)));
  }

  it("draft saves the fixed diagram", async () => {
    fakeResponses({
      coverage: Object.fromEntries(KEYS.map((k) => [k, "covered"])),
      notes: Object.fromEntries(KEYS.map((k) => [k, ""])),
      openQuestions: [],
      readyToDraft: true,
    });
    await stream(`/documents/${docId}/chat`, { message: "Refunds" });
    fakeResponses({ source: FIXED });
    const events = await stream(`/documents/${docId}/draft`, { sections: ["user_flow"] });
    const done = events.find((e) => e.type === "section_done");
    expect(done?.type === "section_done" && mermaidBlocks(done.section.content)).toEqual([FIXED]);

    const res = await call(app, "GET", `/documents/${docId}`, { cookie });
    const saved = documentDetail
      .parse(await res.json())
      .sections.find((s) => s.key === "user_flow");
    expect(saved && mermaidBlocks(saved.content)).toEqual([FIXED]);
  });

  it("revise replaces the streamed proposal with the fixed markdown", async () => {
    fakeResponses({ source: FIXED });
    const events = await stream(`/documents/${docId}/sections/user_flow/revise`, {
      instruction: "Add the refund step",
    });
    expect(events).toContainEqual({
      type: "proposal",
      sectionKey: "user_flow",
      markdown: `The flow:\n\n\`\`\`mermaid\n${FIXED}\n\`\`\``,
    });
    expect(events.at(-1)?.type).toBe("done");
  });
});
