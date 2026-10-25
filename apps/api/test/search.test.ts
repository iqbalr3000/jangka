import { collections, groups, users } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { collectionSummary } from "@jangka/shared/access";
import { type DocNode, documentSummary } from "@jangka/shared/document";
import { SNIPPET_END, SNIPPET_START, searchResponse } from "@jangka/shared/search";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prefixQuery } from "../src/routes/search";
import {
  buildApp,
  call,
  createUser,
  login,
  setupInstance,
  type TestApp,
  testDatabase,
} from "./helpers";

const { db, pool } = testDatabase();
afterAll(async () => {
  await pool.end();
});

const text = (value: string): DocNode => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
});

describe("prefixQuery", () => {
  it("ANDs prefix terms and drops symbols and one-letter words", () => {
    expect(prefixQuery("Refund wind")).toBe("refund:* & wind:*");
    expect(prefixQuery("a & | ! (x)")).toBeNull();
    expect(prefixQuery("go-live: 2026")).toBe("go:* & live:* & 2026:*");
  });
});

let app: TestApp;
let admin: string;
let rina: string;
let rinaId: string;
let product: string;
let finance: string;

async function collection(name: string): Promise<string> {
  const res = await call(app, "POST", "/collections", {
    cookie: admin,
    body: { name, parentId: null },
  });
  return collectionSummary.parse(await res.json()).id;
}

async function create(cookie: string, body: Record<string, unknown>, overview?: string) {
  const res = await call(app, "POST", "/documents", { cookie, body });
  expect(res.status).toBe(201);
  const id = documentSummary.parse(await res.json()).id;
  if (overview) {
    const saved = await call(app, "PUT", `/documents/${id}/sections/overview`, {
      cookie,
      body: { content: text(overview), revision: 0 },
    });
    expect(saved.status).toBe(200);
  }
  return id;
}

async function search(query: string, cookie = rina) {
  const res = await call(app, "GET", `/search?${query}`, { cookie });
  expect(res.status).toBe(200);
  return searchResponse.parse(await res.json()).items;
}

beforeEach(async () => {
  await truncateAll(pool);
  app = buildApp(db, pool).app;
  admin = await setupInstance(app, db);
  product = await collection("Product");
  finance = await collection("Finance");
  const [allUsers] = await db.select().from(groups).where(eq(groups.systemKey, "all_users"));
  await call(app, "PUT", "/admin/permissions", {
    cookie: admin,
    body: { changes: [{ collectionId: product, groupId: allUsers?.id, level: "view" }] },
  });
  rinaId = await createUser(db, {
    name: "Rina",
    email: "rina@acme.co",
    password: "rina-password-123",
  });
  rina = await login(app, "rina@acme.co", "rina-password-123");
});

describe("search", () => {
  it("finds by title first, then by content, with a marked snippet", async () => {
    const byContent = await create(
      admin,
      { title: "Checkout", collectionId: product, docType: "prd" },
      "Customers can request a refund window extension at checkout.",
    );
    const byTitle = await create(admin, {
      title: "Refund self-service",
      collectionId: product,
      docType: "prd",
    });

    const items = await search("q=refund");
    expect(items.map((i) => [i.id, i.matchedIn])).toEqual([
      [byTitle, "title"],
      [byContent, "content"],
    ]);
    expect(items[1]).toMatchObject({ collectionName: "Product", sectionTitle: "Overview" });
    expect(items[1]?.snippet).toContain(`${SNIPPET_START}refund${SNIPPET_END}`);

    // Every word must match, as a prefix.
    expect((await search("q=refund%20wind")).map((i) => i.id)).toEqual([byContent]);
    expect(await search("q=refund%20payroll")).toEqual([]);
  });

  it("filters by type and ignores very short queries", async () => {
    await create(admin, { title: "Refund BRD", collectionId: product, docType: "brd" });
    await create(admin, { title: "Refund PRD", collectionId: product, docType: "prd" });
    expect((await search("q=refund&type=brd")).map((i) => i.title)).toEqual(["Refund BRD"]);
    expect(await search("q=r")).toEqual([]);
  });

  it("leaves out archived documents and archived collections", async () => {
    const archived = await create(admin, {
      title: "Refund old",
      collectionId: product,
      docType: "prd",
    });
    await call(app, "POST", `/documents/${archived}/archive`, { cookie: admin });
    const legacy = await collection("Legacy");
    await create(admin, { title: "Refund legacy", collectionId: legacy, docType: "prd" });
    await call(app, "POST", `/collections/${legacy}/archive`, { cookie: admin });
    expect(await search("q=refund", admin)).toEqual([]);
  });

  it("never returns documents the user can't view (SPEC §11)", async () => {
    const visible = await create(admin, {
      title: "Refund policy",
      collectionId: product,
      docType: "prd",
    });
    await create(
      admin,
      { title: "Refund payroll", collectionId: finance, docType: "prd" },
      "Refund window for payroll is ninety days.",
    );
    // The admin's personal collection: nobody else can view it.
    const personal = async (userId: string) =>
      (await db.select().from(collections).where(eq(collections.personalOwnerId, userId)))[0]?.id;
    const [adminUser] = await db.select().from(users).where(eq(users.email, "ada@acme.co"));
    await create(
      admin,
      { title: "Refund notes", collectionId: await personal(adminUser?.id ?? ""), docType: "prd" },
      "Personal refund thoughts.",
    );

    const items = await search("q=refund&limit=50");
    expect(items.map((i) => i.id)).toEqual([visible]);
    expect(JSON.stringify(items)).not.toContain("payroll");
    expect(JSON.stringify(items)).not.toContain("ninety");
    expect(JSON.stringify(items)).not.toContain("thoughts");

    // Rina's own personal documents are hers, listed as "Personal"; the admin sees everything.
    await create(rina, {
      title: "Refund draft",
      collectionId: await personal(rinaId),
      docType: "prd",
    });
    const rinaItems = await search("q=refund&limit=50");
    expect(rinaItems.map((i) => [i.title, i.collectionName]).sort()).toEqual([
      ["Refund draft", "Personal"],
      ["Refund policy", "Product"],
    ]);
    expect((await search("q=refund&limit=50", admin)).length).toBe(4);
  });

  it("requires a session", async () => {
    expect((await call(app, "GET", "/search?q=refund", { cookie: null })).status).toBe(401);
  });
});
