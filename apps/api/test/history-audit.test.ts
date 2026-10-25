import { auditLogs, groups, sectionVersions } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { collectionSummary } from "@jangka/shared/access";
import { auditLogList } from "@jangka/shared/audit";
import {
  type DocNode,
  documentSummary,
  section,
  sectionVersionList,
} from "@jangka/shared/document";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import pino from "pino";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { audit, auditExempt, auditMiddleware } from "../src/lib/audit";
import type { AppEnv } from "../src/types";
import {
  ADMIN,
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

let app: TestApp;
let admin: string;

beforeEach(async () => {
  await truncateAll(pool);
  app = buildApp(db, pool).app;
  admin = await setupInstance(app, db);
});

const text = (value: string): DocNode => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
});

async function rows() {
  return db.select().from(auditLogs).orderBy(asc(auditLogs.id));
}

describe("audit()", () => {
  it("records actor, request details and metadata; sign-ins name who signed in", async () => {
    const [setup] = await rows();
    expect(setup).toMatchObject({ action: "instance.setup", targetType: "user" });
    expect(setup?.actorId).toBe(setup?.targetId);
    const res = await call(app, "POST", "/auth/login", {
      body: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(res.status).toBe(200);
    const last = (await rows()).at(-1);
    expect(last).toMatchObject({ action: "auth.login", actorId: setup?.actorId, ip: "unknown" });
  });

  it("records failed sign-ins without an actor", async () => {
    await call(app, "POST", "/auth/login", {
      body: { email: ADMIN.email, password: "wrong-password-123" },
    });
    await call(app, "POST", "/auth/login", {
      body: { email: "nobody@acme.co", password: "wrong-password-123" },
    });
    const failed = (await rows()).filter((r) => r.action === "auth.login_failed");
    expect(failed.map((r) => [r.actorId, r.metadata])).toEqual([
      [null, { email: ADMIN.email }],
      [null, { email: "nobody@acme.co" }],
    ]);
    expect(failed[0]?.targetId).not.toBeNull();
    expect(failed[1]?.targetId).toBeNull();
  });

  it("is append-only", async () => {
    await expect(db.update(auditLogs).set({ action: "x" })).rejects.toThrow();
    await expect(db.delete(auditLogs)).rejects.toThrow();
    expect((await rows()).length).toBeGreaterThan(0);
  });
});

describe("audit guard", () => {
  const logs: string[] = [];
  const logger = pino({ level: "warn" }, { write: (line: string) => logs.push(line) });

  function mini(strict: boolean) {
    return new Hono<AppEnv>()
      .use(auditMiddleware(db, logger, strict))
      .onError((err, c) => c.json({ error: err.message }, 500))
      .post("/forgot", (c) => c.json({ ok: true }))
      .post("/exempt", (c) => {
        auditExempt(c, "test");
        return c.json({ ok: true });
      })
      .post("/secret", async (c) => {
        await audit(c, {
          action: "x.secret",
          targetType: "x",
          targetId: null,
          metadata: { provider: { apiKey: "sk-123", kind: "openai" } },
        });
        return c.json({ ok: true });
      })
      .post("/failing", (c) => c.json({ error: "no" }, 400));
  }

  it("fails an un-audited successful mutation in strict mode, warns otherwise", async () => {
    const strict = mini(true);
    expect((await strict.request("/forgot", { method: "POST" })).status).toBe(500);
    expect((await strict.request("/exempt", { method: "POST" })).status).toBe(200);
    expect((await strict.request("/failing", { method: "POST" })).status).toBe(400);
    logs.length = 0;
    expect((await mini(false).request("/forgot", { method: "POST" })).status).toBe(200);
    expect(logs.join("")).toContain("POST /forgot succeeded without an audit() call");
  });

  it("refuses secret-like metadata keys: throws when strict, drops them otherwise", async () => {
    expect((await mini(true).request("/secret", { method: "POST" })).status).toBe(500);
    expect((await mini(false).request("/secret", { method: "POST" })).status).toBe(200);
    const row = (await rows()).find((r) => r.action === "x.secret");
    expect(row?.metadata).toEqual({ provider: { kind: "openai" } });
    expect(JSON.stringify(await rows())).not.toContain("sk-123");
  });
});

describe("section history", () => {
  let docId: string;

  beforeEach(async () => {
    const res = await call(app, "POST", "/documents", {
      cookie: admin,
      body: { title: "Refunds", collectionId: null, docType: "prd" },
    });
    docId = documentSummary.parse(await res.json()).id;
  });

  async function put(key: string, content: DocNode, revision: number, source?: "llm") {
    const res = await call(app, "PUT", `/documents/${docId}/sections/${key}`, {
      cookie: admin,
      body: { content, revision, source },
    });
    expect(res.status).toBe(200);
    return section.parse(await res.json());
  }

  async function versions(key: string) {
    const res = await call(app, "GET", `/documents/${docId}/sections/${key}/versions`, {
      cookie: admin,
    });
    return sectionVersionList.parse(await res.json()).items;
  }

  it("restores an old version as a new, marked version", async () => {
    await put("overview", text("First"), 0, "llm");
    const second = await put("overview", text("Second"), 1, "llm");
    const first = (await versions("overview")).find((v) => v.revision === 1);
    const res = await call(app, "POST", `/documents/${docId}/sections/overview/restore`, {
      cookie: admin,
      body: { versionId: first?.id, revision: second.revision },
    });
    expect(res.status).toBe(200);
    const restored = section.parse(await res.json());
    expect(restored).toMatchObject({ revision: 3, content: text("First") });
    const latest = (await versions("overview"))[0];
    expect(latest).toMatchObject({ revision: 3, source: "human", restoredFromRevision: 1 });
    const log = (await rows()).at(-1);
    expect(log).toMatchObject({
      action: "document.restore_section",
      targetId: docId,
      metadata: { section: "overview", versionId: first?.id, fromRevision: 1 },
    });
  });

  it("rejects a stale revision, another section's version, and viewers", async () => {
    await put("overview", text("First"), 0, "llm");
    await put("goals", text("Goal"), 0, "llm");
    const [overview] = await versions("overview");
    const [goal] = await versions("goals");

    const stale = await call(app, "POST", `/documents/${docId}/sections/overview/restore`, {
      cookie: admin,
      body: { versionId: overview?.id, revision: 0 },
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "revision_conflict" } });

    const wrong = await call(app, "POST", `/documents/${docId}/sections/overview/restore`, {
      cookie: admin,
      body: { versionId: goal?.id, revision: 1 },
    });
    expect(wrong.status).toBe(404);

    const platform = collectionSummary.parse(
      await (
        await call(app, "POST", "/collections", {
          cookie: admin,
          body: { name: "Platform", parentId: null },
        })
      ).json(),
    ).id;
    await call(app, "POST", `/documents/${docId}/move`, {
      cookie: admin,
      body: { collectionId: platform },
    });
    const [allUsers] = await db.select().from(groups).where(eq(groups.systemKey, "all_users"));
    await call(app, "PUT", "/admin/permissions", {
      cookie: admin,
      body: { changes: [{ collectionId: platform, groupId: allUsers?.id, level: "view" }] },
    });
    await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
    const rina = await login(app, "rina@acme.co", "rina-password-123");
    const viewer = await call(app, "POST", `/documents/${docId}/sections/overview/restore`, {
      cookie: rina,
      body: { versionId: overview?.id, revision: 1 },
    });
    expect(viewer.status).toBe(403);
    expect(await db.select().from(sectionVersions)).toHaveLength(2);
  });
});

describe("audit log viewer", () => {
  async function list(query = "", cookie = admin) {
    const res = await call(app, "GET", `/admin/audit-logs${query}`, { cookie });
    expect(res.status).toBe(200);
    return auditLogList.parse(await res.json());
  }

  it("lists newest first with actors and resolved targets", async () => {
    const res = await call(app, "POST", "/documents", {
      cookie: admin,
      body: { title: "Refunds", collectionId: null, docType: "prd" },
    });
    const docId = documentSummary.parse(await res.json()).id;
    const { items } = await list();
    expect(items[0]).toMatchObject({
      action: "document.create",
      actor: { name: ADMIN.name },
      target: { label: "Refunds", href: `/d/${docId}` },
    });
    expect(items.at(-1)?.action).toBe("instance.setup");
  });

  it("filters by action prefix, actor and date, and pages with a cursor", async () => {
    await call(app, "POST", "/auth/login", {
      body: { email: ADMIN.email, password: "wrong-password-123" },
    });
    for (const name of ["A", "B", "C"]) {
      await call(app, "POST", "/collections", { cookie: admin, body: { name, parentId: null } });
    }
    expect((await list("?action=collection")).items.map((i) => i.action)).toEqual([
      "collection.create",
      "collection.create",
      "collection.create",
    ]);
    expect((await list("?action=auth.login_failed")).items).toHaveLength(1);
    expect((await list("?action=auth")).items.map((i) => i.action)).toContain("auth.login_failed");
    // `_` is a LIKE wildcard; the prefix must still match literally.
    expect((await list("?action=auth.login_")).items).toEqual([]);

    const adminId = (await list("?action=instance.setup")).items[0]?.actor?.id ?? "";
    const byAdmin = await list(`?actorId=${adminId}`);
    expect(byAdmin.items.every((i) => i.actor?.id === adminId)).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    expect((await list(`?from=${today}&to=${today}`)).items.length).toBeGreaterThan(0);
    expect((await list("?from=2999-01-01")).items).toEqual([]);

    const first = await list("?action=collection&limit=2");
    expect(first.items).toHaveLength(2);
    const second = await list(`?action=collection&limit=2&cursor=${first.nextCursor}`);
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it("is admin only", async () => {
    await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
    const rina = await login(app, "rina@acme.co", "rina-password-123");
    const res = await call(app, "GET", "/admin/audit-logs", { cookie: rina });
    expect(res.status).toBe(403);
  });
});
