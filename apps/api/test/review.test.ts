import { truncateAll } from "@jangka/db/testing";
import { createProvider } from "@jangka/llm";
import { collectionSummary } from "@jangka/shared/access";
import {
  type DocNode,
  documentDetail,
  documentSummary,
  sectionVersionList,
} from "@jangka/shared/document";
import { commentList } from "@jangka/shared/review";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildApp,
  call,
  createUser,
  grantAllUsers,
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

let app: TestApp;
let admin: string;
let rina: string;
let docId: string;
let collectionId: string;

beforeEach(async () => {
  await truncateAll(pool);
  app = buildApp(db, pool, { llm: (config) => createProvider(config) }).app;
  admin = await setupInstance(app, db);
  collectionId = collectionSummary.parse(
    await (
      await call(app, "POST", "/collections", {
        cookie: admin,
        body: { name: "Platform", parentId: null },
      })
    ).json(),
  ).id;
  docId = documentSummary.parse(
    await (
      await call(app, "POST", "/documents", {
        cookie: admin,
        body: { title: "Refunds", collectionId, docType: "prd" },
      })
    ).json(),
  ).id;
  await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
  rina = await login(app, "rina@acme.co", "rina-password-123");
  await grantAllUsers(app, db, admin, collectionId, "view");
});

async function comment(body: unknown, cookie = admin) {
  return call(app, "POST", `/documents/${docId}/comments`, { cookie, body });
}

async function commentId(body: unknown, cookie = admin): Promise<string> {
  const res = await comment(body, cookie);
  expect(res.status).toBe(201);
  return z.object({ id: z.string() }).parse(await res.json()).id;
}

async function threads(state: "open" | "all" = "open", cookie = admin) {
  const res = await call(app, "GET", `/documents/${docId}/comments?state=${state}`, { cookie });
  expect(res.status).toBe(200);
  return commentList.parse(await res.json());
}

async function setStatus(status: string, cookie = admin) {
  return call(app, "POST", `/documents/${docId}/status`, { cookie, body: { status } });
}

describe("comments", () => {
  it("lets viewers start threads and reply; replies stay one level deep", async () => {
    const root = await commentId({ sectionKey: "overview", body: "Which markets?" }, rina);
    const reply = await commentId({ sectionKey: "overview", parentId: root, body: "ID and SG" });
    const nested = await comment({ sectionKey: "overview", parentId: reply, body: "Nested" });
    expect(nested.status).toBe(400);
    const wrongSection = await comment({ sectionKey: "goals", parentId: root, body: "x" });
    expect(wrongSection.status).toBe(404);
    expect((await comment({ sectionKey: "nope", body: "x" })).status).toBe(404);

    const list = await threads("open", rina);
    expect(list.openCountBySection).toEqual({ overview: 1 });
    expect(list.threads).toHaveLength(1);
    expect(list.threads[0]?.root).toMatchObject({ body: "Which markets?", canEdit: true });
    expect(list.threads[0]?.replies.map((r) => [r.body, r.author?.name, r.canEdit])).toEqual([
      ["ID and SG", "Ada Admin", false],
    ]);
  });

  it("hides documents from people who can't view them", async () => {
    const root = await commentId({ sectionKey: "overview", body: "Hidden?" });
    await grantAllUsers(app, db, admin, collectionId, "none");
    expect((await comment({ sectionKey: "overview", body: "x" }, rina)).status).toBe(404);
    expect((await call(app, "GET", `/documents/${docId}/comments`, { cookie: rina })).status).toBe(
      404,
    );
    expect((await call(app, "POST", `/comments/${root}/resolve`, { cookie: rina })).status).toBe(
      404,
    );
  });

  it("lets only the author edit or delete; deleted text is hidden, replies kept", async () => {
    const root = await commentId({ sectionKey: "overview", body: "Typo here" }, rina);
    await commentId({ sectionKey: "overview", parentId: root, body: "Fixed" });
    const byOther = await call(app, "PATCH", `/comments/${root}`, {
      cookie: admin,
      body: { body: "Hijack" },
    });
    expect(byOther.status).toBe(403);
    expect(
      (await call(app, "PATCH", `/comments/${root}`, { cookie: rina, body: { body: "Typo!" } }))
        .status,
    ).toBe(204);
    let thread = (await threads("all")).threads[0];
    expect(thread?.root.body).toBe("Typo!");
    expect(thread?.root.editedAt).not.toBeNull();

    expect((await call(app, "DELETE", `/comments/${root}`, { cookie: admin })).status).toBe(403);
    expect((await call(app, "DELETE", `/comments/${root}`, { cookie: rina })).status).toBe(204);
    thread = (await threads("all")).threads[0];
    expect(thread?.root).toMatchObject({ body: null, deleted: true, canEdit: false });
    expect(thread?.replies).toHaveLength(1);
    expect((await threads("open")).openCountBySection).toEqual({});
  });

  it("resolves by the thread's author or an editor, not other viewers", async () => {
    const adminThread = await commentId({ sectionKey: "overview", body: "Admin's" });
    const rinaThread = await commentId({ sectionKey: "goals", body: "Rina's" }, rina);
    expect(
      (await call(app, "POST", `/comments/${adminThread}/resolve`, { cookie: rina })).status,
    ).toBe(403);
    expect(
      (await call(app, "POST", `/comments/${rinaThread}/resolve`, { cookie: rina })).status,
    ).toBe(204);
    expect(
      (await call(app, "POST", `/comments/${adminThread}/resolve`, { cookie: admin })).status,
    ).toBe(204);

    const all = await threads("all");
    expect(all.threads.map((t) => [t.root.body, t.resolvedBy?.name])).toEqual([
      ["Admin's", "Ada Admin"],
      ["Rina's", "Rina"],
    ]);
    expect((await threads("open")).threads).toEqual([]);
    expect(
      (await call(app, "POST", `/comments/${adminThread}/reopen`, { cookie: admin })).status,
    ).toBe(204);
    expect((await threads("open")).openCountBySection).toEqual({ overview: 1 });
  });
});

describe("status workflow", () => {
  it("follows draft → in review → approved → draft and refuses other moves", async () => {
    expect((await setStatus("approved")).status).toBe(400);
    expect((await setStatus("draft")).status).toBe(400);
    expect((await setStatus("in_review")).status).toBe(200);
    expect((await setStatus("in_review", rina)).status).toBe(403);
    const approved = await setStatus("approved");
    expect(documentSummary.parse(await approved.json()).status).toBe("approved");
    const detail = documentDetail.parse(
      await (await call(app, "GET", `/documents/${docId}`, { cookie: admin })).json(),
    );
    expect(detail.statusChange?.by?.name).toBe("Ada Admin");
    expect((await setStatus("draft")).status).toBe(200);
  });

  it("won't approve with open threads, and names their sections", async () => {
    const root = await commentId({ sectionKey: "goals", body: "Target?" }, rina);
    await setStatus("in_review");
    const blocked = await setStatus("approved");
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      error: { code: "open_comments", details: { sections: ["goals"] } },
    });
    await call(app, "POST", `/comments/${root}/resolve`, { cookie: admin });
    expect((await setStatus("approved")).status).toBe(200);
  });

  it("freezes an approved document's sections until it is reopened; comments still work", async () => {
    const put = (revision: number) =>
      call(app, "PUT", `/documents/${docId}/sections/overview`, {
        cookie: admin,
        body: { content: text(`v${revision}`), revision },
      });
    expect((await put(0)).status).toBe(200);
    await setStatus("in_review");
    await setStatus("approved");

    const frozen = await put(1);
    expect(frozen.status).toBe(409);
    expect(await frozen.json()).toMatchObject({ error: { code: "document_approved" } });
    const versions = sectionVersionList.parse(
      await (
        await call(app, "GET", `/documents/${docId}/sections/overview/versions`, { cookie: admin })
      ).json(),
    );
    const restore = await call(app, "POST", `/documents/${docId}/sections/overview/restore`, {
      cookie: admin,
      body: { versionId: versions.items[0]?.id, revision: 1 },
    });
    expect(restore.status).toBe(409);

    await call(app, "POST", "/admin/llm-providers", {
      cookie: admin,
      body: { kind: "fake", label: "Fake", apiKey: "", defaultModel: "fake-small" },
    });
    for (const path of [
      `/documents/${docId}/draft`,
      `/documents/${docId}/sections/overview/revise`,
    ]) {
      const res = await call(app, "POST", path, {
        cookie: admin,
        body: path.endsWith("draft") ? { force: true } : { instruction: "Shorter" },
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: "document_approved" } });
    }
    expect((await comment({ sectionKey: "overview", body: "Still fine?" }, rina)).status).toBe(201);

    await setStatus("draft");
    expect((await put(1)).status).toBe(200);
  });
});
