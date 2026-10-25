import { chatMessages, collections, groups, sectionVersions } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { createProvider, fakeResponses } from "@jangka/llm";
import { SECRET_KEY, type Stub, startStub } from "@jangka/llm/testing";
import { collectionSummary } from "@jangka/shared/access";
import { type AssistantEvent, assistantEvent, chatThread } from "@jangka/shared/assistant";
import { type DocNode, documentDetail, documentSummary, section } from "@jangka/shared/document";
import { builtinTemplates } from "@jangka/templates";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RateLimiter } from "../src/lib/rate-limit";
import {
  buildApp,
  call,
  createUser,
  login,
  ORIGIN,
  setupInstance,
  type TestApp,
  testDatabase,
} from "./helpers";

const { db, pool } = testDatabase();
let stub: Stub;
beforeAll(async () => {
  stub = await startStub();
});
afterAll(async () => {
  await stub.close();
  await pool.end();
});

const template = builtinTemplates[0];
if (!template) throw new Error("PRD template missing");
const KEYS = template.sections.map((s) => s.key);

let app: TestApp;
let adminCookie: string;
let docId: string;

beforeEach(async () => {
  await truncateAll(pool);
  // Fake for most tests; "openai" goes to the stub (abort and error paths).
  app = buildApp(db, pool, {
    llm: (config) =>
      createProvider(
        config.kind === "openai" ? { ...config, baseUrl: `${stub.url}/v1`, maxRetries: 0 } : config,
      ),
  }).app;
  adminCookie = await setupInstance(app, db);
  docId = await createDoc();
});

async function createDoc(): Promise<string> {
  const res = await call(app, "POST", "/documents", {
    cookie: adminCookie,
    body: { title: "Refunds", collectionId: null, docType: "prd" },
  });
  return documentSummary.parse(await res.json()).id;
}

async function useFake() {
  const res = await call(app, "POST", "/admin/llm-providers", {
    cookie: adminCookie,
    body: { kind: "fake", label: "Fake", apiKey: "", defaultModel: "fake-small" },
  });
  expect(res.status).toBe(201);
}

async function useStubOpenAI() {
  stub.handle(() => ({
    json: { object: "list", data: [{ id: "gpt-x", object: "model", created: 1, owned_by: "x" }] },
  }));
  const res = await call(app, "POST", "/admin/llm-providers", {
    cookie: adminCookie,
    body: { kind: "openai", label: "OpenAI", apiKey: SECRET_KEY, defaultModel: "gpt-x" },
  });
  expect(res.status).toBe(201);
}

function post(path: string, body: unknown, signal?: AbortSignal, cookie = adminCookie) {
  return app.request(`/api/v1${path}`, {
    method: "POST",
    headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * Parses an SSE response into validated assistant events. Stopping early cancels the body,
 * which is what @hono/node-server does when the client disconnects.
 */
async function* events(res: Response): AsyncGenerator<AssistantEvent> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    yield* frames();
  } finally {
    await reader.cancel().catch(() => {});
  }

  async function* frames(): AsyncGenerator<AssistantEvent> {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) yield assistantEvent.parse(JSON.parse(data));
        end = buffer.indexOf("\n\n");
      }
    }
  }
}

async function all(res: Response): Promise<AssistantEvent[]> {
  const list: AssistantEvent[] = [];
  for await (const event of events(res)) list.push(event);
  return list;
}

async function thread() {
  const res = await call(app, "GET", `/documents/${docId}/chat`, { cookie: adminCookie });
  return chatThread.parse(await res.json());
}

async function sectionsNow() {
  const res = await call(app, "GET", `/documents/${docId}`, { cookie: adminCookie });
  return documentDetail.parse(await res.json()).sections;
}

const coverageWith = (missing: string[]) => ({
  coverage: Object.fromEntries(KEYS.map((k) => [k, missing.includes(k) ? "missing" : "covered"])),
  notes: Object.fromEntries(KEYS.map((k) => [k, ""])),
  openQuestions: [],
  readyToDraft: true,
});

describe("chat", () => {
  it("needs a configured LLM", async () => {
    const res = await post(`/documents/${docId}/chat`, { message: "Hi" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "llm_not_configured" } });
  });

  it("streams the reply, saves both messages with usage, and updates coverage", async () => {
    await useFake();
    const list = await all(
      await post(`/documents/${docId}/chat`, { message: "Refunds take 7 days" }),
    );
    expect(list[0]?.type).toBe("message_start");
    const text = list.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
    expect(text).toContain("This is a fake reply");
    expect(list.find((e) => e.type === "coverage")).toBeTruthy();
    expect(list.at(-1)?.type).toBe("done");

    const { messages, state } = await thread();
    expect(messages.map((m) => [m.role, m.kind])).toEqual([
      ["user", "chat"],
      ["assistant", "chat"],
    ]);
    expect(messages[0]?.author?.name).toBe("Ada Admin");
    expect(messages[1]?.content).toBe(text);
    expect(state?.sections).toHaveLength(12);
    expect(state?.readyToDraft).toBe(true);
    const [row] = await db.select().from(chatMessages).where(eq(chatMessages.role, "assistant"));
    expect(row).toMatchObject({ providerKind: "fake", model: "fake-small" });
    expect(row?.outputTokens).toBeGreaterThan(0);
  });

  it("lets viewers read the thread but not post", async () => {
    await useFake();
    const [personal] = await db.select().from(collections);
    expect(personal).toBeTruthy();
    const platformRes = await call(app, "POST", "/collections", {
      cookie: adminCookie,
      body: { name: "Platform", parentId: null },
    });
    const platform = collectionSummary.parse(await platformRes.json()).id;
    const moved = await call(app, "POST", `/documents/${docId}/move`, {
      cookie: adminCookie,
      body: { collectionId: platform },
    });
    expect(moved.status).toBe(200);
    const [allUsers] = await db.select().from(groups).where(eq(groups.systemKey, "all_users"));
    await call(app, "PUT", "/admin/permissions", {
      cookie: adminCookie,
      body: { changes: [{ collectionId: platform, groupId: allUsers?.id, level: "view" }] },
    });
    await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
    const rina = await login(app, "rina@acme.co", "rina-password-123");
    expect((await call(app, "GET", `/documents/${docId}/chat`, { cookie: rina })).status).toBe(200);
    expect((await post(`/documents/${docId}/chat`, { message: "x" }, undefined, rina)).status).toBe(
      403,
    );
  });

  it("allows one generation per document at a time", async () => {
    await useFake();
    const controller = new AbortController();
    const first = await post(
      `/documents/${docId}/chat`,
      { message: "[slow] tell me" },
      controller.signal,
    );
    const iterator = events(first);
    await iterator.next();
    const second = await post(`/documents/${docId}/chat`, { message: "again" });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: "generation_in_progress" } });
    controller.abort();
    await iterator.return(undefined);
  });
});

describe("abort and provider errors", () => {
  it("stopping mid-stream closes the provider request and keeps the partial reply as interrupted", async () => {
    await useStubOpenAI();
    stub.handle(() => ({
      hang: true,
      sse: [
        {
          data: {
            id: "c",
            object: "chat.completion.chunk",
            created: 1,
            model: "gpt-x",
            choices: [{ index: 0, delta: { content: "Partial" }, finish_reason: null }],
          },
        },
      ],
    }));
    const controller = new AbortController();
    const res = await post(`/documents/${docId}/chat`, { message: "Hi" }, controller.signal);
    for await (const event of events(res)) {
      if (event.type === "text") break;
    }
    controller.abort();

    await expect.poll(() => stub.closedEarly(), { timeout: 3000 }).toBeGreaterThan(0);
    await expect
      .poll(async () => (await thread()).messages.find((m) => m.role === "assistant"), {
        timeout: 3000,
      })
      .toMatchObject({ content: "Partial", interrupted: true });
    // The lock is released.
    stub.handle(() => ({ status: 500, json: { error: { message: "down" } } }));
    expect((await post(`/documents/${docId}/chat`, { message: "again" })).status).toBe(200);
  });

  it("reports a provider failure as a normalized error event without the key", async () => {
    await useStubOpenAI();
    stub.handle(() => ({
      status: 401,
      json: { error: { message: `Incorrect API key provided: ${SECRET_KEY}` } },
    }));
    const res = await post(`/documents/${docId}/chat`, { message: "Hi" });
    const raw = await res.clone().text();
    expect(raw).not.toContain(SECRET_KEY);
    const list = await all(res);
    expect(list.at(-1)).toEqual({
      type: "error",
      code: "auth",
      message: "Key rejected by provider",
    });
  });
});

describe("draft", () => {
  it("refuses without coverage unless forced, then skips missing sections", async () => {
    await useFake();
    const refused = await post(`/documents/${docId}/draft`, {});
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "coverage_incomplete" } });

    const list = await all(await post(`/documents/${docId}/draft`, { force: true }));
    expect(list.filter((e) => e.type === "section_skipped")).toHaveLength(12);
    expect((await sectionsNow()).every((s) => s.completeness === "empty")).toBe(true);
  });

  it("drafts empty sections as llm versions and leaves written ones alone", async () => {
    await useFake();
    fakeResponses(coverageWith(["risks"]));
    await all(await post(`/documents/${docId}/chat`, { message: "Refunds" }));
    const mine: DocNode = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Mine" }] }],
    };
    await call(app, "PUT", `/documents/${docId}/sections/overview`, {
      cookie: adminCookie,
      body: { content: mine, revision: 0 },
    });

    const list = await all(await post(`/documents/${docId}/draft`, {}));
    const done = list.flatMap((e) => (e.type === "section_done" ? [e.section.key] : []));
    expect(done).toHaveLength(10);
    expect(done).not.toContain("overview");
    expect(list).toContainEqual({
      type: "section_skipped",
      key: "risks",
      reason: "missing_coverage",
    });

    const sections = await sectionsNow();
    expect(sections.find((s) => s.key === "overview")?.content).toEqual(mine);
    expect(sections.find((s) => s.key === "problem")).toMatchObject({
      completeness: "complete",
      revision: 1,
    });
    const versions = await db
      .select()
      .from(sectionVersions)
      .where(eq(sectionVersions.source, "llm"));
    expect(versions).toHaveLength(10);

    const { messages } = await thread();
    expect(messages.at(-1)).toMatchObject({ kind: "draft", role: "assistant" });
    expect(messages.at(-1)?.content).toContain(
      "Skipped (not enough information yet): Risks & Mitigations",
    );
  });

  it("does not overwrite a section a human edited while it was being drafted", async () => {
    await useFake();
    fakeResponses(coverageWith([]));
    await all(await post(`/documents/${docId}/chat`, { message: "[slow] Refunds" }));
    const res = await post(`/documents/${docId}/draft`, { sections: ["problem"] });
    const iterator = events(res);
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
      if (next.value.type === "section_start") break;
    }
    const human: DocNode = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Human" }] }],
    };
    const put = await call(app, "PUT", `/documents/${docId}/sections/problem`, {
      cookie: adminCookie,
      body: { content: human, revision: 0 },
    });
    expect(put.status).toBe(200);
    const rest: AssistantEvent[] = [];
    for (let next = await iterator.next(); !next.done; next = await iterator.next())
      rest.push(next.value);
    expect(rest).toContainEqual({ type: "section_conflict", key: "problem" });
    expect((await sectionsNow()).find((s) => s.key === "problem")?.content).toEqual(human);
  }, 20_000);
});

describe("revise", () => {
  it("streams a proposal without touching the section; accepting saves an llm version", async () => {
    await useFake();
    const list = await all(
      await post(`/documents/${docId}/sections/non_functional_requirements/revise`, {
        instruction: "Make every NFR measurable",
      }),
    );
    const proposal = list.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
    expect(proposal.length).toBeGreaterThan(0);
    expect(
      list.every((e) => e.type !== "text" || e.sectionKey === "non_functional_requirements"),
    ).toBe(true);
    expect(
      (await sectionsNow()).find((s) => s.key === "non_functional_requirements")?.revision,
    ).toBe(0);

    const { messages } = await thread();
    expect(messages.map((m) => [m.role, m.kind, m.content])).toEqual([
      ["user", "revise", "@Non-Functional Requirements Make every NFR measurable"],
      [
        "assistant",
        "revise",
        "Proposed changes to Non-Functional Requirements. Review them in the document.",
      ],
    ]);

    const accepted: DocNode = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: proposal }] }],
    };
    const res = await call(app, "PUT", `/documents/${docId}/sections/non_functional_requirements`, {
      cookie: adminCookie,
      body: { content: accepted, revision: 0, source: "llm" },
    });
    expect(section.parse(await res.json()).revision).toBe(1);
    const [version] = await db.select().from(sectionVersions);
    expect(version?.source).toBe("llm");
  });
});

describe("request limit", () => {
  it("caps LLM requests per user", async () => {
    app = buildApp(db, pool, { llmLimiter: new RateLimiter(2, 60_000) }).app;
    await useFake();
    for (let i = 0; i < 2; i++) {
      const ok = await post(`/documents/${docId}/chat`, { message: `Hi ${i}` });
      expect(ok.status).toBe(200);
      await ok.text();
    }
    const limited = await post(`/documents/${docId}/chat`, { message: "Again" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "rate_limited" } });

    // Another user has their own allowance.
    await createUser(db, {
      name: "Rina",
      email: "rina@acme.co",
      password: "rina-password-123",
      admin: true,
    });
    const rina = await login(app, "rina@acme.co", "rina-password-123");
    const theirs = await post(`/documents/${docId}/chat`, { message: "Hello" }, undefined, rina);
    expect(theirs.status).toBe(200);
    await theirs.text();
  });
});
