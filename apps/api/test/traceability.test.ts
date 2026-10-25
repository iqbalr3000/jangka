import { groups, requirements } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { createProvider, type ProviderFactory } from "@jangka/llm";
import { collectionSummary } from "@jangka/shared/access";
import { type AssistantEvent, assistantEvent } from "@jangka/shared/assistant";
import {
  type BlockNode,
  type DocNode,
  documentDetail,
  documentList,
  documentSummary,
  type TableRowNode,
} from "@jangka/shared/document";
import { traceResponse } from "@jangka/shared/trace";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
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

function table(rows: string[][]): DocNode {
  const row = (cells: string[], header: boolean): TableRowNode => ({
    type: "tableRow",
    content: cells.map((text) => ({
      type: header ? "tableHeader" : "tableCell",
      content: [p(text)],
    })),
  });
  const [head = [], ...body] = rows;
  return {
    type: "doc",
    content: [{ type: "table", content: [row(head, true), ...body.map((r) => row(r, false))] }],
  };
}

const SOURCE_SECRET = "Refund fraud costs 2M a year";
const FR_TABLE = [
  "| ID | Requirement | Priority | Upstream |",
  "| --- | --- | --- | --- |",
  "| FR-001 | Customer requests a refund | Must | BR-001 |",
  "| FR-002 | Customer tracks the refund | Should | BR-001, BR-009 |",
].join("\n");

/** Records every system prompt; streams the FR table so drafts carry requirements. */
const systems: string[] = [];
const llm: ProviderFactory = (config) => {
  const provider = createProvider(config);
  return {
    ...provider,
    async *streamText(req) {
      systems.push(req.system ?? "");
      yield { type: "text", delta: FR_TABLE };
      yield { type: "done", usage: { inputTokens: 1, outputTokens: 1 } };
    },
    generateObject(req, schema, signal) {
      systems.push(req.system ?? "");
      return provider.generateObject(req, schema, signal);
    },
  };
};

let app: TestApp;
let admin: string;
let rina: string;
let business: string;
let product: string;
let brdId: string;

async function collection(name: string): Promise<string> {
  const res = await call(app, "POST", "/collections", {
    cookie: admin,
    body: { name, parentId: null },
  });
  return collectionSummary.parse(await res.json()).id;
}

async function grant(collectionId: string, level: "view" | "edit" | "none") {
  const [allUsers] = await db.select().from(groups).where(eq(groups.systemKey, "all_users"));
  const res = await call(app, "PUT", "/admin/permissions", {
    cookie: admin,
    body: { changes: [{ collectionId, groupId: allUsers?.id, level }] },
  });
  expect(res.status).toBe(200);
}

async function create(
  body: { title: string; collectionId: string; docType: string; sourceDocumentId?: string },
  cookie = admin,
) {
  return call(app, "POST", "/documents", { cookie, body });
}

async function createId(body: Parameters<typeof create>[0], cookie = admin): Promise<string> {
  const res = await create(body, cookie);
  expect(res.status).toBe(201);
  return documentSummary.parse(await res.json()).id;
}

async function save(docId: string, key: string, content: DocNode, cookie = admin) {
  const detail = documentDetail.parse(
    await (await call(app, "GET", `/documents/${docId}`, { cookie })).json(),
  );
  const revision = detail.sections.find((s) => s.key === key)?.revision ?? 0;
  const res = await call(app, "PUT", `/documents/${docId}/sections/${key}`, {
    cookie,
    body: { content, revision },
  });
  expect(res.status).toBe(200);
}

async function trace(docId: string, cookie = admin) {
  const res = await call(app, "GET", `/documents/${docId}/trace`, { cookie });
  expect(res.status).toBe(200);
  return traceResponse.parse(await res.json());
}

async function stream(path: string, body: unknown, cookie = admin): Promise<AssistantEvent[]> {
  const res = await app.request(`/api/v1${path}`, {
    method: "POST",
    headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.text())
    .split("\n\n")
    .map((frame) => frame.replace(/^data: ?/m, ""))
    .filter((data) => data.startsWith("{"))
    .map((data) => assistantEvent.parse(JSON.parse(data)));
}

beforeEach(async () => {
  await truncateAll(pool);
  systems.length = 0;
  app = buildApp(db, pool, { llm }).app;
  admin = await setupInstance(app, db);
  business = await collection("Business");
  product = await collection("Product");
  await grant(product, "edit");
  await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
  rina = await login(app, "rina@acme.co", "rina-password-123");
  brdId = await createId({ title: "Refund BRD", collectionId: business, docType: "brd" });
  await save(brdId, "business_problem", { type: "doc", content: [p(SOURCE_SECRET)] });
  await save(
    brdId,
    "business_requirements",
    table([
      ["ID", "Requirement", "Priority"],
      ["BR-001", "Refunds within 24 hours", "Must"],
    ]),
  );
});

describe("requirements index", () => {
  it("follows every save of a requirement section", async () => {
    const prd = await createId({ title: "PRD", collectionId: product, docType: "prd" });
    const rows = () =>
      db
        .select()
        .from(requirements)
        .where(eq(requirements.documentId, prd))
        .orderBy(asc(requirements.position));

    await save(
      prd,
      "functional_requirements",
      table([
        ["ID", "Requirement", "Priority", "Upstream"],
        ["FR-001", "Request a refund", "Must", "BR-001"],
        ["FR-002", "Track it", "Could", ""],
      ]),
    );
    const first = await rows();
    expect(first.map((r) => [r.code, r.kind, r.priority, r.upstreamCodes])).toEqual([
      ["FR-001", "functional", "must", ["BR-001"]],
      ["FR-002", "functional", "could", []],
    ]);

    await save(
      prd,
      "functional_requirements",
      table([
        ["ID", "Requirement", "Priority", "Upstream"],
        ["FR-001", "Request a refund", "Must", "BR-001"],
        ["FR-003", "Cancel it", "Should", ""],
      ]),
    );
    const second = await rows();
    expect(second.map((r) => r.code)).toEqual(["FR-001", "FR-003"]);
    // Unchanged rows keep their identity and timestamp.
    expect(second[0]?.id).toBe(first[0]?.id);
    expect(second[0]?.updatedAt).toEqual(first[0]?.updatedAt);

    // Non-requirement sections and wrong prefixes are ignored; the legacy list format counts.
    await save(prd, "overview", { type: "doc", content: [p("FR-009: not here")] });
    await save(prd, "non_functional_requirements", {
      type: "doc",
      content: [p("NFR-001: p95 under 300 ms"), p("FR-004: wrong section")],
    });
    expect((await rows()).map((r) => r.code).sort()).toEqual(["FR-001", "FR-003", "NFR-001"]);

    await save(prd, "functional_requirements", { type: "doc", content: [{ type: "paragraph" }] });
    expect((await rows()).map((r) => r.code)).toEqual(["NFR-001"]);
  });
});

describe("source documents", () => {
  it("lists viewable candidates by type and title", async () => {
    await createId({ title: "Payments BRD", collectionId: product, docType: "brd" });
    const list = async (query: string, cookie = admin) =>
      documentList
        .parse(await (await call(app, "GET", `/documents?${query}`, { cookie })).json())
        .items.map((d) => d.title);
    expect(await list("docType=brd")).toEqual(["Payments BRD", "Refund BRD"]);
    expect(await list("docType=brd&q=refund")).toEqual(["Refund BRD"]);
    expect(await list("docType=brd&q=%25")).toEqual([]);
    expect(await list("docType=brd", rina)).toEqual(["Payments BRD"]);
  });

  it("must be the upstream type, viewable and not archived", async () => {
    const prd = await createId({ title: "PRD", collectionId: product, docType: "prd" });
    const invalid = async (body: Parameters<typeof create>[0], cookie = admin) => {
      const res = await create(body, cookie);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "invalid_source" } });
    };
    await invalid({ title: "x", collectionId: product, docType: "prd", sourceDocumentId: prd });
    await invalid({ title: "x", collectionId: product, docType: "tsd", sourceDocumentId: brdId });
    await invalid({ title: "x", collectionId: product, docType: "brd", sourceDocumentId: brdId });
    // Rina can't view the BRD: same answer as a wrong one.
    await invalid(
      { title: "x", collectionId: product, docType: "prd", sourceDocumentId: brdId },
      rina,
    );
    const archived = await createId({ title: "Old", collectionId: business, docType: "brd" });
    await call(app, "POST", `/documents/${archived}/archive`, { cookie: admin });
    await invalid({
      title: "x",
      collectionId: product,
      docType: "prd",
      sourceDocumentId: archived,
    });
  });

  it("shows the source, or Restricted document to a viewer who can't see it", async () => {
    const prd = await createId({
      title: "PRD",
      collectionId: product,
      docType: "prd",
      sourceDocumentId: brdId,
    });
    const detail = async (cookie: string) =>
      documentDetail.parse(await (await call(app, "GET", `/documents/${prd}`, { cookie })).json());
    expect((await detail(admin)).source).toEqual({
      id: brdId,
      title: "Refund BRD",
      docType: "brd",
    });
    expect((await detail(rina)).source).toEqual({ restricted: true });
  });
});

describe("trace", () => {
  it("resolves upstream codes and lists downstream requirements, hiding what the viewer can't see", async () => {
    const prd = await createId({
      title: "PRD",
      collectionId: product,
      docType: "prd",
      sourceDocumentId: brdId,
    });
    await save(
      prd,
      "functional_requirements",
      table([
        ["ID", "Requirement", "Priority", "Upstream"],
        ["FR-001", "Request a refund", "Must", "BR-001, BR-009"],
      ]),
    );
    const tsd = await createId({
      title: "TSD",
      collectionId: business,
      docType: "tsd",
      sourceDocumentId: prd,
    });
    await save(
      tsd,
      "technical_requirements",
      table([
        ["ID", "Requirement", "Priority", "Upstream"],
        ["TR-001", "Refund queue", "Must", "FR-001"],
      ]),
    );

    const asAdmin = await trace(prd);
    expect(asAdmin.upstream).toEqual({ id: brdId, title: "Refund BRD", docType: "brd" });
    expect(asAdmin.downstream).toEqual([{ id: tsd, title: "TSD", docType: "tsd" }]);
    expect(asAdmin.requirements).toEqual([
      {
        code: "FR-001",
        kind: "functional",
        text: "Request a refund",
        priority: "must",
        sectionKey: "functional_requirements",
        upstream: [
          { code: "BR-001", status: "linked", text: "Refunds within 24 hours", documentId: brdId },
          { code: "BR-009", status: "missing" },
        ],
        // Written after BR-001, so nothing to review.
        needsReview: false,
        downstream: [{ documentId: tsd, code: "TR-001", text: "Refund queue" }],
      },
    ]);

    // Rina sees the PRD only: BRD restricted, TSD (in Business) omitted.
    const asRina = await trace(prd, rina);
    expect(asRina.upstream).toEqual({ restricted: true });
    expect(asRina.downstream).toEqual([]);
    expect(asRina.requirements[0]?.upstream).toEqual([
      { code: "BR-001", status: "restricted" },
      { code: "BR-009", status: "restricted" },
    ]);
    expect(asRina.requirements[0]?.downstream).toEqual([]);
    expect(JSON.stringify(asRina)).not.toContain("Refund BRD");
  });
});

describe("assistant with a source", () => {
  async function useFake() {
    await call(app, "POST", "/admin/llm-providers", {
      cookie: admin,
      body: { kind: "fake", label: "Fake", apiKey: "", defaultModel: "fake-small" },
    });
  }

  it("puts the source in the prompt only for users who can view it", async () => {
    await useFake();
    const prd = await createId({
      title: "PRD",
      collectionId: product,
      docType: "prd",
      sourceDocumentId: brdId,
    });
    await stream(`/documents/${prd}/chat`, { message: "Hi" });
    expect(systems.some((s) => s.includes(SOURCE_SECRET))).toBe(true);
    expect(systems.some((s) => s.includes("- BR-001: Refunds within 24 hours"))).toBe(true);

    systems.length = 0;
    await stream(`/documents/${prd}/chat`, { message: "Hi" }, rina);
    expect(systems.length).toBeGreaterThan(0);
    expect(systems.some((s) => s.includes(SOURCE_SECRET) || s.includes("BR-001"))).toBe(false);
  });

  it("drafts from the source: coverage first, then sections with linked requirements", async () => {
    await useFake();
    const prd = await createId({
      title: "PRD",
      collectionId: product,
      docType: "prd",
      sourceDocumentId: brdId,
    });
    const events = await stream(`/documents/${prd}/draft`, { fromSource: true });
    const types = events.map((e) => e.type);
    expect(types.indexOf("coverage")).toBeLessThan(types.indexOf("section_start"));
    expect(events.filter((e) => e.type === "section_done")).toHaveLength(12);

    const { requirements: list } = await trace(prd);
    expect(list.map((r) => [r.code, r.upstream.map((u) => `${u.code}:${u.status}`)])).toEqual([
      ["FR-001", ["BR-001:linked"]],
      ["FR-002", ["BR-001:linked", "BR-009:missing"]],
    ]);
  });

  it("refuses to draft from a source the user can't view", async () => {
    await useFake();
    const prd = await createId({
      title: "PRD",
      collectionId: product,
      docType: "prd",
      sourceDocumentId: brdId,
    });
    const res = await call(app, "POST", `/documents/${prd}/draft`, {
      cookie: rina,
      body: { fromSource: true },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_source" } });
  });
});
