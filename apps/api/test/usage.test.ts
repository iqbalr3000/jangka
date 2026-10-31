import { readFileSync } from "node:fs";
import { chatMessages, chatThreads, llmUsage } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { collectionDetail } from "@jangka/shared/access";
import { documentSummary } from "@jangka/shared/document";
import { type LlmOperation, usageReport } from "@jangka/shared/llm";
import { builtinTemplates } from "@jangka/templates";
import { asc, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { periodRange } from "../src/routes/admin-usage";
import {
  ADMIN,
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
afterAll(() => pool.end());

const template = builtinTemplates[0];
if (!template) throw new Error("PRD template missing");

let app: TestApp;
let admin: string;
let docId: string;

beforeEach(async () => {
  await truncateAll(pool);
  app = buildApp(db, pool).app;
  admin = await setupInstance(app, db);
  const created = await call(app, "POST", "/documents", {
    cookie: admin,
    body: { title: "Refunds", collectionId: null, docType: "prd" },
  });
  docId = documentSummary.parse(await created.json()).id;
  const provider = await call(app, "POST", "/admin/llm-providers", {
    cookie: admin,
    body: { kind: "fake", label: "Fake", apiKey: "", defaultModel: "fake-small" },
  });
  expect(provider.status).toBe(201);
});

/** Runs an SSE endpoint to the end. */
async function stream(path: string, body: unknown) {
  const res = await app.request(`/api/v1${path}`, {
    method: "POST",
    headers: { cookie: admin, origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  await res.text();
}

const rows = () => db.select().from(llmUsage).orderBy(asc(llmUsage.createdAt));
const operations = async () => (await rows()).map((r) => r.operation);

describe("recording", () => {
  it("a chat turn records the reply and the coverage assessment, with user and document", async () => {
    await stream(`/documents/${docId}/chat`, { message: "Refunds take 7 days" });
    const recorded = await rows();
    expect(recorded.map((r) => r.operation)).toEqual(["chat", "coverage"]);
    for (const row of recorded) {
      expect(row).toMatchObject({ documentId: docId, providerKind: "fake", model: "fake-small" });
      expect(row.userId).toBeTruthy();
      expect(row.inputTokens + row.outputTokens).toBeGreaterThan(0);
    }
  });

  it("drafting records a draft and a completeness check per section", async () => {
    await stream(`/documents/${docId}/chat`, { message: "Refunds take 7 days" });
    await stream(`/documents/${docId}/draft`, { sections: ["overview", "problem"] });
    expect((await operations()).slice(2)).toEqual(["draft", "check", "draft", "check"]);
  });

  it("revise and diagram fixes record their operations", async () => {
    await stream(`/documents/${docId}/sections/overview/revise`, { instruction: "Shorter" });
    const fix = await call(app, "POST", `/documents/${docId}/sections/user_flow/fix-diagram`, {
      cookie: admin,
      body: { source: "flowchart TD\n  A-->", error: "Parse error" },
    });
    expect(fix.status).toBe(200);
    expect(await operations()).toEqual(["revise", "diagram_fix"]);
  });
});

describe("GET /admin/usage", () => {
  async function insertUsage(
    daysAgo: number,
    inputTokens: number,
    operation: LlmOperation = "chat",
  ) {
    const [user] = await db
      .execute<{ id: string }>(sql`select id from users limit 1`)
      .then((r) => r.rows);
    await db.insert(llmUsage).values({
      userId: user?.id,
      documentId: docId,
      providerKind: "anthropic",
      model: "claude-x",
      operation,
      inputTokens,
      outputTokens: 10,
      createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
    });
  }

  it("totals, groups and fills days for the period", async () => {
    await insertUsage(1, 100);
    await insertUsage(2, 50, "coverage");
    await insertUsage(40, 999);

    const res = await call(app, "GET", "/admin/usage?period=30d", { cookie: admin });
    expect(res.status).toBe(200);
    const report = usageReport.parse(await res.json());
    expect(report.totals).toEqual({ requests: 2, inputTokens: 150, outputTokens: 20 });
    expect(report.daily.length).toBeGreaterThanOrEqual(30);
    expect(report.daily.reduce((n, d) => n + d.inputTokens, 0)).toBe(150);
    expect(report.byModel).toEqual([
      {
        providerKind: "anthropic",
        model: "claude-x",
        requests: 2,
        inputTokens: 150,
        outputTokens: 20,
      },
    ]);
    expect(report.byOperation.map((o) => o.operation)).toEqual(["chat", "coverage"]);
    expect(report.byUser[0]?.user?.name).toBe(ADMIN.name);
    expect(report.topDocuments[0]?.document).toMatchObject({ id: docId, title: "Refunds" });
  });

  it("hides the title of a document the admin can't view", async () => {
    await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
    const rina = await login(app, "rina@acme.co", "rina-password-123");
    // Rina's personal collection is private, admins included.
    const personal = await call(app, "GET", "/collections/personal", { cookie: rina });
    const personalId = collectionDetail.parse(await personal.json()).collection?.id;
    const created = await call(app, "POST", "/documents", {
      cookie: rina,
      body: { title: "Secret plan", collectionId: personalId, docType: "prd" },
    });
    docId = documentSummary.parse(await created.json()).id;
    await insertUsage(0, 10);

    const report = usageReport.parse(
      await (await call(app, "GET", "/admin/usage", { cookie: admin })).json(),
    );
    expect(report.topDocuments).toHaveLength(1);
    expect(report.topDocuments[0]?.document).toBeNull();
  });

  it("is admin only", async () => {
    await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
    const rina = await login(app, "rina@acme.co", "rina-password-123");
    expect((await call(app, "GET", "/admin/usage", { cookie: rina })).status).toBe(403);
  });
});

describe("periods", () => {
  const now = new Date("2026-10-31T15:00:00Z");

  it("rolling periods end now; calendar months at their UTC boundaries", () => {
    expect(periodRange("7d", now).from.toISOString()).toBe("2026-10-24T15:00:00.000Z");
    expect(periodRange("month", now)).toEqual({ from: new Date("2026-10-01T00:00:00Z"), to: now });
    expect(periodRange("last_month", now)).toEqual({
      from: new Date("2026-09-01T00:00:00Z"),
      to: new Date("2026-10-01T00:00:00Z"),
    });
  });
});

describe("backfill (migration 0012)", () => {
  it("attributes an assistant message to the thread's latest user message before it", async () => {
    const [user] = (await db.execute<{ id: string }>(sql`select id from users limit 1`)).rows;
    const [thread] = await db
      .insert(chatThreads)
      .values({ documentId: docId, createdBy: user?.id })
      .returning();
    if (!thread || !user) throw new Error("setup failed");
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 10, minutes));
    await db.insert(chatMessages).values([
      {
        threadId: thread.id,
        role: "user",
        kind: "chat",
        content: "Hi",
        createdBy: user.id,
        createdAt: at(0),
      },
      {
        threadId: thread.id,
        role: "assistant",
        kind: "chat",
        content: "Hello",
        providerKind: "openai",
        model: "gpt-x",
        inputTokens: 30,
        outputTokens: 5,
        createdAt: at(1),
      },
      {
        threadId: thread.id,
        role: "assistant",
        kind: "revise",
        content: "Proposed updates to Goals. Review them in the document.",
        providerKind: "openai",
        model: "gpt-x",
        inputTokens: 40,
        outputTokens: 8,
        createdAt: at(2),
      },
    ]);

    const migration = readFileSync(
      new URL("../../../packages/db/migrations/0012_llm_usage.sql", import.meta.url),
      "utf8",
    );
    const backfill = migration.slice(migration.indexOf('INSERT INTO "llm_usage"'));
    await db.execute(sql.raw(backfill));

    expect(
      (await rows()).map((r) => [
        r.operation,
        r.userId,
        r.documentId,
        r.inputTokens,
        r.outputTokens,
      ]),
    ).toEqual([
      ["chat", user.id, docId, 30, 5],
      ["propose", user.id, docId, 40, 8],
    ]);
  });
});
