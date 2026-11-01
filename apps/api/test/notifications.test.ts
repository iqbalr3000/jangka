import { notifications, users } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { documentSummary } from "@jangka/shared/document";
import {
  mentionableList,
  mentionToken,
  notificationList,
  unreadCount,
} from "@jangka/shared/notifications";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ADMIN,
  buildApp,
  call,
  createCollection,
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

let app: TestApp;
let admin: string;
let rina: string;
let budi: string;
let ids: { admin: string; rina: string; budi: string; cici: string };
let collectionId: string;
let docId: string;

async function userId(email: string): Promise<string> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!row) throw new Error(`no user ${email}`);
  return row.id;
}

beforeEach(async () => {
  await truncateAll(pool);
  app = buildApp(db, pool).app;
  admin = await setupInstance(app, db);
  collectionId = await createCollection(app, admin, "Platform");
  docId = documentSummary.parse(
    await (
      await call(app, "POST", "/documents", {
        cookie: admin,
        body: { title: "Refund PRD", collectionId, docType: "prd" },
      })
    ).json(),
  ).id;
  await createUser(db, {
    name: "Rina Putri",
    email: "rina@acme.co",
    password: "rina-password-123",
  });
  await createUser(db, { name: "Budi", email: "budi@acme.co", password: "budi-password-123" });
  await createUser(db, {
    name: "Cici",
    email: "cici@acme.co",
    password: "cici-password-123",
    isActive: false,
  });
  rina = await login(app, "rina@acme.co", "rina-password-123");
  budi = await login(app, "budi@acme.co", "budi-password-123");
  ids = {
    admin: await userId(ADMIN.email),
    rina: await userId("rina@acme.co"),
    budi: await userId("budi@acme.co"),
    cici: await userId("cici@acme.co"),
  };
  await grantAllUsers(app, db, admin, collectionId, "edit");
});

const at = (id: string, name: string) => mentionToken({ id, name });

async function comment(
  cookie: string,
  body: string,
  options: { parentId?: string; sectionKey?: string } = {},
): Promise<string> {
  const res = await call(app, "POST", `/documents/${docId}/comments`, {
    cookie,
    body: { sectionKey: options.sectionKey ?? "overview", parentId: options.parentId, body },
  });
  expect(res.status).toBe(201);
  return z.object({ id: z.string() }).parse(await res.json()).id;
}

async function list(cookie: string, query = "") {
  const res = await call(app, "GET", `/notifications${query}`, { cookie });
  expect(res.status).toBe(200);
  return notificationList.parse(await res.json());
}

async function count(cookie: string): Promise<number> {
  const res = await call(app, "GET", "/notifications/unread-count", { cookie });
  expect(res.status).toBe(200);
  return unreadCount.parse(await res.json()).count;
}

const kinds = async (cookie: string) => (await list(cookie)).items.map((n) => n.kind);

describe("notifications from comments", () => {
  it("notifies mentioned viewers with a readable excerpt, not the actor", async () => {
    const id = await comment(
      admin,
      `${at(ids.rina, "Rina Putri")} can you check this? ${at(ids.admin, "Ada Admin")}`,
    );
    const { items, unreadCount } = await list(rina);
    expect(unreadCount).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "mention",
      document: { id: docId, title: "Refund PRD", docType: "prd" },
      sectionKey: "overview",
      sectionTitle: "Overview",
      threadId: id,
      actor: { id: ids.admin, name: ADMIN.name },
      excerpt: "@Rina Putri can you check this? @Ada Admin",
      read: false,
    });
    expect(await kinds(admin)).toEqual([]);
  });

  it("skips mentioned users who can't view the document, inactive users and unknown ids", async () => {
    const restricted = await createCollection(app, admin, "Secret");
    const secretDoc = documentSummary.parse(
      await (
        await call(app, "POST", "/documents", {
          cookie: admin,
          body: { title: "Secret PRD", collectionId: restricted, docType: "prd" },
        })
      ).json(),
    ).id;
    await grantAllUsers(app, db, admin, restricted, "none");
    const res = await call(app, "POST", `/documents/${secretDoc}/comments`, {
      cookie: admin,
      body: {
        sectionKey: "overview",
        body: `${at(ids.rina, "Rina")} ${at("01890a5d-ac96-774b-bcce-b302099a8057", "Ghost")}`,
      },
    });
    expect(res.status).toBe(201);
    expect(await kinds(rina)).toEqual([]);

    await comment(admin, `${at(ids.cici, "Cici")} ${at(ids.budi, "Budi")}`);
    const rows = await db.select().from(notifications);
    expect(rows.map((r) => r.recipientId)).toEqual([ids.budi]);
  });

  it("notifies the thread's author and earlier repliers of a reply, once each", async () => {
    const root = await comment(rina, "Which markets?");
    await comment(budi, "ID first", { parentId: root });
    expect(await kinds(rina)).toEqual(["reply"]);
    expect(await kinds(budi)).toEqual([]);

    // Mentioned and a participant: one notification, the mention.
    await comment(admin, `${at(ids.rina, "Rina")} and SG`, { parentId: root });
    expect(await kinds(rina)).toEqual(["mention", "reply"]);
    expect(await kinds(budi)).toEqual(["reply"]);
    expect(await kinds(admin)).toEqual([]);
    const [latest] = (await list(rina)).items;
    expect(latest?.threadId).toBe(root);
  });

  it("notifies only mentions added by an edit", async () => {
    const id = await comment(admin, `${at(ids.rina, "Rina")} please look`);
    const res = await call(app, "PATCH", `/comments/${id}`, {
      cookie: admin,
      body: { body: `${at(ids.rina, "Rina")} and ${at(ids.budi, "Budi")} please look` },
    });
    expect(res.status).toBe(204);
    expect(await kinds(rina)).toEqual(["mention"]);
    expect(await kinds(budi)).toEqual(["mention"]);
  });

  it("notifies the thread author when someone else resolves it", async () => {
    const own = await comment(admin, "Mine");
    await call(app, "POST", `/comments/${own}/resolve`, { cookie: admin });
    expect(await kinds(admin)).toEqual([]);

    const root = await comment(rina, "Missing goal");
    expect((await call(app, "POST", `/comments/${root}/resolve`, { cookie: budi })).status).toBe(
      204,
    );
    await call(app, "POST", `/comments/${root}/reopen`, { cookie: budi });
    const { items } = await list(rina);
    expect(items.map((n) => [n.kind, n.actor?.name, n.excerpt])).toEqual([
      ["resolved", "Budi", "Missing goal"],
    ]);
  });

  it("shows no excerpt once the comment is deleted", async () => {
    const id = await comment(admin, `${at(ids.rina, "Rina")} hi`);
    await call(app, "DELETE", `/comments/${id}`, { cookie: admin });
    expect((await list(rina)).items[0]).toMatchObject({ kind: "mention", excerpt: null });
  });
});

describe("status notifications", () => {
  it("tells the document's creator when someone else moves it", async () => {
    const res = await call(app, "POST", `/documents/${docId}/status`, {
      cookie: rina,
      body: { status: "in_review" },
    });
    expect(res.status).toBe(200);
    const { items } = await list(admin);
    expect(items.map((n) => [n.kind, n.status, n.actor?.name, n.sectionKey])).toEqual([
      ["status", "in_review", "Rina Putri", null],
    ]);
    await call(app, "POST", `/documents/${docId}/status`, {
      cookie: admin,
      body: { status: "draft" },
    });
    expect(await kinds(admin)).toEqual(["status"]);
  });
});

describe("reading notifications", () => {
  it("hides notifications on documents the reader can no longer view", async () => {
    await comment(admin, `${at(ids.rina, "Rina")} look`);
    expect(await count(rina)).toBe(1);
    await grantAllUsers(app, db, admin, collectionId, "none");
    expect(await count(rina)).toBe(0);
    expect((await list(rina)).items).toEqual([]);
  });

  it("marks chosen ones or all as read, only the caller's", async () => {
    await comment(admin, `${at(ids.rina, "Rina")} one`);
    await comment(admin, `${at(ids.rina, "Rina")} two`);
    await comment(admin, `${at(ids.budi, "Budi")} three`);
    const [newest] = (await list(rina)).items;
    if (!newest) throw new Error("missing");

    const byOther = await call(app, "POST", "/notifications/read", {
      cookie: budi,
      body: { ids: [newest.id] },
    });
    expect(byOther.status).toBe(204);
    expect(await count(rina)).toBe(2);

    await call(app, "POST", "/notifications/read", { cookie: rina, body: { ids: [newest.id] } });
    expect((await list(rina)).items.map((n) => n.read)).toEqual([true, false]);
    expect(await count(rina)).toBe(1);

    await call(app, "POST", "/notifications/read", { cookie: rina, body: { all: true } });
    expect(await count(rina)).toBe(0);
    expect(await count(budi)).toBe(1);
    const bad = await call(app, "POST", "/notifications/read", { cookie: rina, body: {} });
    expect(bad.status).toBe(400);
  });

  it("pages newest first with a cursor", async () => {
    for (const n of [1, 2, 3]) await comment(admin, `${at(ids.rina, "Rina")} ${n}`);
    const first = await list(rina, "?limit=2");
    expect(first.items.map((n) => n.excerpt)).toEqual(["@Rina 3", "@Rina 2"]);
    expect(first.nextCursor).not.toBeNull();
    const second = await list(rina, `?limit=2&cursor=${first.nextCursor}`);
    expect(second.items.map((n) => n.excerpt)).toEqual(["@Rina 1"]);
    expect(second.nextCursor).toBeNull();
    expect((await call(app, "GET", "/notifications?cursor=nope", { cookie: rina })).status).toBe(
      400,
    );
  });

  it("purges the reader's notifications older than 90 days", async () => {
    await comment(admin, `${at(ids.rina, "Rina")} old`);
    await comment(admin, `${at(ids.budi, "Budi")} old too`);
    await db
      .update(notifications)
      .set({ createdAt: sql`now() - interval '91 days'` })
      .where(sql`true`);
    await comment(admin, `${at(ids.rina, "Rina")} new`);
    expect((await list(rina)).items.map((n) => n.excerpt)).toEqual(["@Rina new"]);
    const rows = await db.select().from(notifications);
    // Budi hasn't loaded his list yet.
    expect(rows.map((r) => r.recipientId).sort()).toEqual([ids.budi, ids.rina].sort());
  });

  it("requires a session", async () => {
    expect((await call(app, "GET", "/notifications")).status).toBe(401);
    expect((await call(app, "GET", "/notifications/unread-count")).status).toBe(401);
  });
});

describe("mentionable users", () => {
  async function mentionable(cookie: string, q = "", doc = docId) {
    const res = await call(app, "GET", `/documents/${doc}/mentionable?q=${encodeURIComponent(q)}`, {
      cookie,
    });
    return { status: res.status, names: mentionableList.parse(await res.json()).items };
  }

  it("lists active users who can view the document, matching a name or email prefix", async () => {
    expect((await mentionable(admin)).names.map((u) => u.name)).toEqual(["Budi", "Rina Putri"]);
    expect((await mentionable(admin, "put")).names.map((u) => u.name)).toEqual(["Rina Putri"]);
    expect((await mentionable(admin, "budi@")).names.map((u) => u.name)).toEqual(["Budi"]);
    expect((await mentionable(admin, "%")).names).toEqual([]);
    expect((await mentionable(rina)).names.map((u) => u.name)).toEqual(["Ada Admin", "Budi"]);

    await grantAllUsers(app, db, admin, collectionId, "none");
    expect((await mentionable(admin)).names).toEqual([]);
    const res = await call(app, "GET", `/documents/${docId}/mentionable`, { cookie: rina });
    expect(res.status).toBe(404);
  });
});
