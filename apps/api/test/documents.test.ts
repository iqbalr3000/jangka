import { collections, groups, sectionVersions } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { collectionDocumentList, collectionList, collectionSummary } from "@jangka/shared/access";
import {
  type DocNode,
  documentDetail,
  documentSummary,
  revisionConflictDetails,
  section,
  sectionVersionList,
  templateList,
} from "@jangka/shared/document";
import { errorResponseSchema } from "@jangka/shared/errors";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { VERSION_SESSION_MS } from "../src/services/documents";
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
afterAll(() => pool.end());

const RINA = { name: "Rina", email: "rina@acme.co", password: "rina-password-123" };

let app: TestApp;
let adminCookie: string;
let rinaCookie: string;
let allUsers: string;
beforeEach(async () => {
  await truncateAll(pool);
  app = buildApp(db, pool).app;
  adminCookie = await setupInstance(app, db);
  await createUser(db, RINA);
  rinaCookie = await login(app, RINA.email, RINA.password);
  const [row] = await db.select().from(groups).where(eq(groups.systemKey, "all_users"));
  allUsers = row?.id ?? "";
});

const text = (value: string): DocNode => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
});

async function createCollection(name: string, parentId: string | null = null) {
  const res = await call(app, "POST", "/collections", {
    cookie: adminCookie,
    body: { name, parentId },
  });
  return collectionSummary.parse(await res.json()).id;
}

async function grant(collectionId: string | null, level: "view" | "edit" | "none") {
  await call(app, "PUT", "/admin/permissions", {
    cookie: adminCookie,
    body: { changes: [{ collectionId, groupId: allUsers, level }] },
  });
}

async function createDoc(collectionId: string | null, cookie = adminCookie, title = "Refunds") {
  const res = await call(app, "POST", "/documents", {
    cookie,
    body: { title, collectionId, docType: "prd" },
  });
  expect(res.status).toBe(201);
  return documentSummary.parse(await res.json());
}

async function documentsOf(collectionId: string, cookie = adminCookie, query = "") {
  const res = await call(app, "GET", `/collections/${collectionId}/documents${query}`, { cookie });
  expect(res.status).toBe(200);
  return collectionDocumentList.parse(await res.json());
}

async function detail(id: string, cookie = adminCookie) {
  const res = await call(app, "GET", `/documents/${id}`, { cookie });
  expect(res.status).toBe(200);
  return documentDetail.parse(await res.json());
}

async function save(
  id: string,
  key: string,
  content: DocNode,
  revision: number,
  cookie = adminCookie,
) {
  return call(app, "PUT", `/documents/${id}/sections/${key}`, {
    cookie,
    body: { content, revision },
  });
}

async function versions(id: string, key: string) {
  const res = await call(app, "GET", `/documents/${id}/sections/${key}/versions`, {
    cookie: adminCookie,
  });
  return sectionVersionList.parse(await res.json()).items;
}

describe("creating documents", () => {
  it("builds every template section, empty and unversioned", async () => {
    const platform = await createCollection("Platform");
    const doc = await createDoc(platform);
    expect(doc).toMatchObject({ docType: "prd", status: "draft", collectionId: platform });
    expect(doc.completeness).toHaveLength(12);
    expect(new Set(doc.completeness)).toEqual(new Set(["empty"]));

    const full = await detail(doc.id);
    expect(full.level).toBe("edit");
    expect(full.collection).toEqual({ id: platform, name: "Platform", personalOwnerId: null });
    expect(full.sections.map((s) => s.key)).toContain("functional_requirements");
    expect(full.sections[0]).toMatchObject({ title: "Overview", revision: 0, required: true });
    expect(full.sections.find((s) => s.key === "user_flow")?.expectsDiagram).toBe("flowchart");
    expect(await versions(doc.id, "overview")).toHaveLength(0);
  });

  it("requires edit on the collection: 404 when invisible, 403 when view-only", async () => {
    const platform = await createCollection("Platform");
    const body = { title: "X", collectionId: platform, docType: "prd" };
    expect((await call(app, "POST", "/documents", { cookie: rinaCookie, body })).status).toBe(404);
    await grant(platform, "view");
    expect((await call(app, "POST", "/documents", { cookie: rinaCookie, body })).status).toBe(403);
    await grant(platform, "edit");
    await createDoc(platform, rinaCookie);
  });

  it("lets users create in their personal collection, invisible to others", async () => {
    const [personal] = await db
      .select()
      .from(collections)
      .where(eq(collections.name, "Rina's personal collection"));
    const doc = await createDoc(personal?.id ?? null, rinaCookie);
    expect((await detail(doc.id, rinaCookie)).inPersonalTree).toBe(true);
    await createUser(db, { ...RINA, name: "Budi", email: "budi@acme.co" });
    const budi = await login(app, "budi@acme.co", RINA.password);
    expect((await call(app, "GET", `/documents/${doc.id}`, { cookie: budi })).status).toBe(404);
  });

  it("lists templates", async () => {
    const res = await call(app, "GET", "/templates", { cookie: rinaCookie });
    const { items } = templateList.parse(await res.json());
    // The newest published version of each family, built-ins as defaults.
    expect(items.map((t) => [`${t.docType}@${t.version}`, t.isBuiltin, t.isDefault])).toEqual([
      ["brd@1", true, true],
      ["prd@2", true, true],
      ["tsd@1", true, true],
    ]);
  });
});

describe("saving sections", () => {
  it("bumps the revision and derives markdown + completeness", async () => {
    const doc = await createDoc(null);
    const res = await save(doc.id, "overview", text("Let customers *request* refunds."), 0);
    expect(res.status).toBe(200);
    expect(section.parse(await res.json())).toMatchObject({
      revision: 1,
      completeness: "complete",
      updatedBy: { name: "Ada Admin" },
    });
    const rows = await db.execute<{ content_md: string }>(
      sql`select content_md from document_sections where section_key = 'overview'`,
    );
    expect(rows.rows[0]?.content_md).toBe("Let customers \\*request\\* refunds.");

    const cleared = await save(
      doc.id,
      "overview",
      { type: "doc", content: [{ type: "paragraph" }] },
      1,
    );
    expect(section.parse(await cleared.json()).completeness).toBe("empty");
  });

  it("rejects a stale revision with 409 revision_conflict and the current section", async () => {
    const doc = await createDoc(null);
    await save(doc.id, "overview", text("first"), 0);
    const stale = await save(doc.id, "overview", text("second"), 0);
    expect(stale.status).toBe(409);
    const body = errorResponseSchema.parse(await stale.json());
    expect(body.error.code).toBe("revision_conflict");
    const { current } = revisionConflictDetails.parse(body.error.details);
    expect(current).toMatchObject({ revision: 1, updatedBy: { name: "Ada Admin" } });
    expect(current.content).toEqual(text("first"));
  });

  it("rejects content outside the whitelist", async () => {
    const doc = await createDoc(null);
    const res = await call(app, "PUT", `/documents/${doc.id}/sections/overview`, {
      cookie: adminCookie,
      body: { content: { type: "doc", content: [{ type: "image" }] }, revision: 0 },
    });
    expect(res.status).toBe(400);
  });

  it("forbids view-only users and returns 404 for unknown sections", async () => {
    const platform = await createCollection("Platform");
    const doc = await createDoc(platform);
    await grant(platform, "view");
    expect((await detail(doc.id, rinaCookie)).level).toBe("view");
    expect((await save(doc.id, "overview", text("x"), 0, rinaCookie)).status).toBe(403);
    expect((await save(doc.id, "nope", text("x"), 0)).status).toBe(404);
  });

  it("bumps the document's updatedAt", async () => {
    const doc = await createDoc(null);
    await save(doc.id, "overview", text("x"), 0);
    expect((await detail(doc.id)).document.updatedAt > doc.updatedAt).toBe(true);
  });
});

describe("section versions (session-based)", () => {
  it("versions the first save, then not again within the same session", async () => {
    const doc = await createDoc(null);
    await save(doc.id, "overview", text("a"), 0);
    await save(doc.id, "overview", text("ab"), 1);
    await save(doc.id, "overview", text("abc"), 2);
    const list = await versions(doc.id, "overview");
    expect(list.map((v) => v.revision)).toEqual([1]);
    expect(list[0]).toMatchObject({ source: "human", createdBy: { name: "Ada Admin" } });
  });

  it("on a new session, versions the previous end state first", async () => {
    const doc = await createDoc(null);
    await save(doc.id, "overview", text("a"), 0);
    await save(doc.id, "overview", text("ab"), 1);
    // Age the session past the idle window.
    await db.execute(
      sql`alter table section_versions disable trigger section_versions_append_only`,
    );
    await db.execute(
      sql`update section_versions set created_at = now() - make_interval(secs => ${VERSION_SESSION_MS / 1000 + 60})`,
    );
    await db.execute(sql`alter table section_versions enable trigger section_versions_append_only`);

    await save(doc.id, "overview", text("abc"), 2);
    const list = await versions(doc.id, "overview");
    expect(list.map((v) => v.revision)).toEqual([3, 2, 1]);
    expect(list.find((v) => v.revision === 2)?.content).toEqual(text("ab"));
  });

  it("starts a new session when another user edits", async () => {
    const platform = await createCollection("Platform");
    await grant(platform, "edit");
    const doc = await createDoc(platform);
    await save(doc.id, "overview", text("admin"), 0);
    await save(doc.id, "overview", text("admin 2"), 1);
    await save(doc.id, "overview", text("rina"), 2, rinaCookie);
    const list = await versions(doc.id, "overview");
    expect(list.map((v) => [v.revision, v.createdBy?.name])).toEqual([
      [3, "Rina"],
      [2, "Ada Admin"],
      [1, "Ada Admin"],
    ]);
  });

  it("is append-only at the database level", async () => {
    const doc = await createDoc(null);
    await save(doc.id, "overview", text("a"), 0);
    await expect(db.update(sectionVersions).set({ revision: 99 })).rejects.toThrow();
    await expect(db.delete(sectionVersions)).rejects.toThrow();
  });
});

describe("moving and archiving", () => {
  it("needs edit on both the source and the destination", async () => {
    const product = await createCollection("Product");
    const platform = await createCollection("Platform");
    await grant(platform, "edit");
    await grant(product, "view");
    const doc = await createDoc(platform, rinaCookie);
    const denied = await call(app, "POST", `/documents/${doc.id}/move`, {
      cookie: rinaCookie,
      body: { collectionId: product },
    });
    expect(denied.status).toBe(403);
    await grant(product, "edit");
    const ok = await call(app, "POST", `/documents/${doc.id}/move`, {
      cookie: rinaCookie,
      body: { collectionId: product },
    });
    expect(documentSummary.parse(await ok.json()).collectionId).toBe(product);
  });

  it("archives and restores; restore waits for an archived collection", async () => {
    const platform = await createCollection("Platform");
    const doc = await createDoc(platform);
    await call(app, "POST", `/documents/${doc.id}/archive`, { cookie: adminCookie });
    expect((await documentsOf(platform)).items).toHaveLength(0);
    const archived = await (
      await call(app, "GET", "/collections/archived", { cookie: adminCookie })
    ).json();
    expect(archived).toMatchObject({ documents: [{ id: doc.id }] });

    await call(app, "POST", `/collections/${platform}/archive`, { cookie: adminCookie });
    expect(
      (await call(app, "POST", `/documents/${doc.id}/restore`, { cookie: adminCookie })).status,
    ).toBe(409);
    await call(app, "POST", `/collections/${platform}/restore`, { cookie: adminCookie });
    await call(app, "POST", `/documents/${doc.id}/restore`, { cookie: adminCookie });
    expect((await documentsOf(platform)).items.map((d) => d.id)).toEqual([doc.id]);
  });

  it("renames", async () => {
    const doc = await createDoc(null);
    const res = await call(app, "PATCH", `/documents/${doc.id}`, {
      cookie: adminCookie,
      body: { title: "Refund self-service" },
    });
    expect(documentSummary.parse(await res.json()).title).toBe("Refund self-service");
  });
});

describe("collection document pages", () => {
  it("pages through every document once, most recently updated first", async () => {
    const platform = await createCollection("Platform");
    const created: string[] = [];
    for (let i = 0; i < 5; i++)
      created.push((await createDoc(platform, adminCookie, `Doc ${i}`)).id);
    // Ties on updated_at are broken by id.
    await db.execute(
      sql`update documents set updated_at = '2026-10-01T10:00:00.123456Z' where id in (${sql.join(
        created.slice(0, 3).map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await documentsOf(
        platform,
        adminCookie,
        `?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(page.total).toBe(5);
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((d) => d.id));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);

    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    // The two untouched documents were updated later than the three pinned to October 1.
    expect(seen.slice(0, 2).sort()).toEqual(created.slice(3).sort());
    expect(seen.slice(2)).toEqual([...created.slice(0, 3)].sort().reverse());
  });

  it("defaults to 50 and rejects bad limits and cursors", async () => {
    const platform = await createCollection("Platform");
    await createDoc(platform);
    expect((await documentsOf(platform)).nextCursor).toBeNull();
    for (const query of ["?limit=0", "?limit=201", "?cursor=not-a-cursor"]) {
      const res = await call(app, "GET", `/collections/${platform}/documents${query}`, {
        cookie: adminCookie,
      });
      expect(res.status).toBe(400);
    }
  });

  it("collection details no longer carry the documents", async () => {
    const res = await call(app, "GET", "/collections/root/items", { cookie: adminCookie });
    expect(await res.json()).not.toHaveProperty("documents");
  });
});

describe("collections list documents", () => {
  it("shows documents and counts only to users who can view them", async () => {
    const platform = await createCollection("Platform");
    await createDoc(platform);
    await createDoc(null);

    expect(await documentsOf("root", rinaCookie)).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
    });
    expect(
      (await call(app, "GET", `/collections/${platform}/documents`, { cookie: rinaCookie })).status,
    ).toBe(404);

    await grant(platform, "view");
    expect((await documentsOf(platform, rinaCookie)).items.map((d) => d.title)).toEqual([
      "Refunds",
    ]);
    const tree = collectionList.parse(
      await (await call(app, "GET", "/collections", { cookie: rinaCookie })).json(),
    );
    expect(tree.items.find((i) => i.id === platform)?.documentCount).toBe(1);

    const graph = await (
      await call(app, "GET", "/admin/permissions", { cookie: adminCookie })
    ).json();
    expect(graph).toMatchObject({ rootDocumentCount: 1, collections: [{ documentCount: 1 }] });
  });
});
