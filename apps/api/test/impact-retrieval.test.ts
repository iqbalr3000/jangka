import { groups } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { createProvider, type ProviderFactory } from "@jangka/llm";
import { collectionSummary } from "@jangka/shared/access";
import { assistantEvent, chatThread } from "@jangka/shared/assistant";
import {
  type BlockNode,
  type DocNode,
  documentSummary,
  type TableRowNode,
} from "@jangka/shared/document";
import { traceResponse } from "@jangka/shared/trace";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { changedSince, reviewBaseline } from "../src/services/requirements";
import { searchTerms } from "../src/services/retrieval";
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
afterAll(async () => {
  await pool.end();
});

const p = (text: string): BlockNode =>
  text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };
const doc = (text: string): DocNode => ({ type: "doc", content: [p(text)] });
function table(rows: string[][]): DocNode {
  const row = (cells: string[], header: boolean): TableRowNode => ({
    type: "tableRow",
    content: cells.map((t) => ({ type: header ? "tableHeader" : "tableCell", content: [p(t)] })),
  });
  const [head = [], ...body] = rows;
  return {
    type: "doc",
    content: [{ type: "table", content: [row(head, true), ...body.map((r) => row(r, false))] }],
  };
}

describe("pure helpers", () => {
  it("builds safe search terms", () => {
    expect(searchTerms("What's the refund-window, in RUPIAH? ok ok 2026 & | !")).toEqual([
      "what",
      "the",
      "refund",
      "window",
      "rupiah",
      "2026",
    ]);
    expect(searchTerms("a b !! ")).toEqual([]);
    expect(
      searchTerms("word ".repeat(3) + Array.from({ length: 20 }, (_, i) => `term${i}`).join(" ")),
    ).toHaveLength(12);
  });

  it("flags only upstream changes after the last edit or review", () => {
    const t = (minute: number) => new Date(Date.UTC(2026, 9, 25, 10, minute));
    const fr = { contentChangedAt: t(10), upstreamReviewedAt: null };
    expect(changedSince({ contentChangedAt: t(5) }, reviewBaseline(fr))).toBeNull();
    expect(changedSince({ contentChangedAt: t(20) }, reviewBaseline(fr))).toEqual(t(20));
    const reviewed = { ...fr, upstreamReviewedAt: t(30) };
    expect(changedSince({ contentChangedAt: t(20) }, reviewBaseline(reviewed))).toBeNull();
  });
});

/** Records system prompts; streams a fixed reply. */
const systems: string[] = [];
const llm: ProviderFactory = (config) => {
  const provider = createProvider(config);
  return {
    ...provider,
    async *streamText(req) {
      systems.push(req.system ?? "");
      yield { type: "text", delta: "Answer." };
      yield { type: "done", usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
};

let app: TestApp;
let admin: string;
let rina: string;
let business: string;
let product: string;

async function collection(name: string): Promise<string> {
  const res = await call(app, "POST", "/collections", {
    cookie: admin,
    body: { name, parentId: null },
  });
  return collectionSummary.parse(await res.json()).id;
}

async function grantAllUsers(collectionId: string, level: "view" | "edit") {
  const [allUsers] = await db.select().from(groups).where(eq(groups.systemKey, "all_users"));
  await call(app, "PUT", "/admin/permissions", {
    cookie: admin,
    body: { changes: [{ collectionId, groupId: allUsers?.id, level }] },
  });
}

async function create(body: Record<string, unknown>): Promise<string> {
  const res = await call(app, "POST", "/documents", { cookie: admin, body });
  expect(res.status).toBe(201);
  return documentSummary.parse(await res.json()).id;
}

const revisions = new Map<string, number>();
async function save(docId: string, key: string, content: DocNode) {
  const revision = revisions.get(`${docId}:${key}`) ?? 0;
  const res = await call(app, "PUT", `/documents/${docId}/sections/${key}`, {
    cookie: admin,
    body: { content, revision },
  });
  expect(res.status).toBe(200);
  revisions.set(`${docId}:${key}`, revision + 1);
}

beforeEach(async () => {
  await truncateAll(pool);
  revisions.clear();
  systems.length = 0;
  app = buildApp(db, pool, { llm }).app;
  admin = await setupInstance(app, db);
  business = await collection("Business");
  product = await collection("Product");
  await grantAllUsers(product, "edit");
  await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
  rina = await login(app, "rina@acme.co", "rina-password-123");
});

describe("needs review", () => {
  let brd: string;
  let prd: string;
  const brTable = (text: string, priority = "Must") =>
    table([
      ["ID", "Requirement", "Priority"],
      ["BR-001", text, priority],
      ["BR-002", "Partial refunds", "Should"],
    ]);
  const frTable = (text: string) =>
    table([
      ["ID", "Requirement", "Priority", "Upstream"],
      ["FR-001", text, "Must", "BR-001"],
    ]);

  async function trace(cookie = admin) {
    const res = await call(app, "GET", `/documents/${prd}/trace`, { cookie });
    return traceResponse.parse(await res.json());
  }

  beforeEach(async () => {
    brd = await create({ title: "BRD", collectionId: business, docType: "brd" });
    await save(brd, "business_requirements", brTable("Refunds within 24 hours"));
    prd = await create({
      title: "PRD",
      collectionId: product,
      docType: "prd",
      sourceDocumentId: brd,
    });
    await save(prd, "functional_requirements", frTable("Request a refund"));
  });

  it("flags a downstream requirement when the cited upstream text or priority changes", async () => {
    expect((await trace()).needsReviewCount).toBe(0);
    await save(brd, "business_requirements", brTable("Refunds within 48 hours"));
    const flagged = await trace();
    expect(flagged.needsReviewCount).toBe(1);
    expect(flagged.requirements[0]).toMatchObject({ code: "FR-001", needsReview: true });
    expect(flagged.requirements[0]?.upstream[0]).toMatchObject({
      code: "BR-001",
      status: "linked",
      changedAt: expect.any(String),
    });

    const review = await call(app, "POST", `/documents/${prd}/requirements/FR-001/reviewed`, {
      cookie: admin,
    });
    expect(review.status).toBe(204);
    expect((await trace()).needsReviewCount).toBe(0);

    await save(brd, "business_requirements", brTable("Refunds within 48 hours", "Should"));
    expect((await trace()).needsReviewCount).toBe(1);
    // Editing the downstream requirement is a review too.
    await save(prd, "functional_requirements", frTable("Request a refund in 48 hours"));
    expect((await trace()).needsReviewCount).toBe(0);
  });

  it("ignores reorders and changes to other requirements", async () => {
    await save(
      brd,
      "business_requirements",
      table([
        ["ID", "Requirement", "Priority"],
        ["BR-002", "Partial refunds, capped", "Should"],
        ["BR-001", "Refunds within 24 hours", "Must"],
      ]),
    );
    expect((await trace()).needsReviewCount).toBe(0);
  });

  it("shows nothing about changes to people who can't see the source", async () => {
    await save(brd, "business_requirements", brTable("Refunds within 48 hours"));
    const asRina = await trace(rina);
    expect(asRina.requirements[0]).toMatchObject({ needsReview: false });
    expect(asRina.requirements[0]?.upstream).toEqual([{ code: "BR-001", status: "restricted" }]);
    expect(asRina.needsReviewCount).toBe(0);
  });

  it("guards Mark reviewed", async () => {
    await grantAllUsers(product, "view");
    const url = `/documents/${prd}/requirements/FR-001/reviewed`;
    expect((await call(app, "POST", url, { cookie: rina })).status).toBe(403);
    expect(
      (await call(app, "POST", `/documents/${prd}/requirements/FR-099/reviewed`, { cookie: admin }))
        .status,
    ).toBe(404);
    await call(app, "POST", `/documents/${prd}/status`, {
      cookie: admin,
      body: { status: "in_review" },
    });
    await call(app, "POST", `/documents/${prd}/status`, {
      cookie: admin,
      body: { status: "approved" },
    });
    expect((await call(app, "POST", url, { cookie: admin })).status).toBe(409);
  });
});

describe("retrieval", () => {
  let current: string;

  beforeEach(async () => {
    await call(app, "POST", "/admin/llm-providers", {
      cookie: admin,
      body: { kind: "fake", label: "Fake", apiKey: "", defaultModel: "fake-small" },
    });
    current = await create({ title: "Checkout", collectionId: product, docType: "prd" });
    await save(current, "overview", doc("Checkout redesign with a refund window banner."));
    const policy = await create({ title: "Refund policy", collectionId: product, docType: "prd" });
    await save(policy, "overview", doc("The refund window is fourteen days for all customers."));
    const secret = await create({ title: "Payroll plan", collectionId: business, docType: "prd" });
    await save(secret, "overview", doc("Secret refund window ninety days refund window payroll."));
    const old = await create({ title: "Old policy", collectionId: product, docType: "prd" });
    await save(old, "overview", doc("Refund window was seven days."));
    await call(app, "POST", `/documents/${old}/archive`, { cookie: admin });
  });

  async function chat(message: string, cookie: string) {
    const res = await app.request(`/api/v1/documents/${current}/chat`, {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
    expect(res.status).toBe(200);
    return (await res.text())
      .split("\n\n")
      .map((frame) => frame.replace(/^data: ?/m, ""))
      .filter((data) => data.startsWith("{"))
      .map((data) => assistantEvent.parse(JSON.parse(data)));
  }

  it("never puts a document the user can't view into the prompt (SPEC §11)", async () => {
    const events = await chat("Summarize the refund window in the Payroll plan", rina);
    const references = events.flatMap((e) => (e.type === "references" ? e.items : []));
    expect(references.map((r) => r.title)).toEqual(["Refund policy"]);
    const prompt = systems.join("\n");
    expect(prompt).toContain("fourteen days");
    expect(prompt).not.toContain("ninety");
    expect(prompt).not.toContain("Payroll plan");
    // Archived and the current document are left out too.
    expect(prompt).not.toContain("seven days");
    expect(references.some((r) => r.documentId === current)).toBe(false);
  });

  it("references what the user can view and stores it on the reply", async () => {
    const events = await chat("What is the refund window?", admin);
    const titles = events.flatMap((e) =>
      e.type === "references" ? e.items.map((r) => r.title) : [],
    );
    // The admin can view the Business collection too.
    expect([...titles].sort()).toEqual(["Payroll plan", "Refund policy"]);
    expect(titles).not.toContain("Old policy");

    const thread = chatThread.parse(
      await (await call(app, "GET", `/documents/${current}/chat`, { cookie: admin })).json(),
    );
    expect(thread.messages.at(-1)?.references.map((r) => [r.title, r.sectionTitle])).toEqual(
      titles.map((t) => [t, "Overview"]),
    );
  });

  it("sends no references when nothing matches", async () => {
    const events = await chat("Hello there", rina);
    expect(events.some((e) => e.type === "references")).toBe(false);
  });
});
