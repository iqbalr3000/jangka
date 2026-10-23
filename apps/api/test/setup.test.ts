import { groupMembers, groups, instanceSettings, users } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { meResponse } from "@jangka/shared/auth";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureSetupToken } from "../src/services/setup";
import { ADMIN, buildApp, call, captureSetupToken, sessionCookie, testDatabase } from "./helpers";

const { db, pool } = testDatabase();
afterAll(() => pool.end());
beforeEach(() => truncateAll(pool));

function setupBody(token: string) {
  return {
    token,
    orgName: "Acme",
    adminName: ADMIN.name,
    adminEmail: "Ada@Acme.co",
    password: ADMIN.password,
  };
}

describe("ensureSetupToken", () => {
  it("prints the token and stores only its hash", async () => {
    let output = "";
    await ensureSetupToken(db, (text) => {
      output += text;
    });
    const token = /SETUP TOKEN: (jk_setup_\S+)/.exec(output)?.[1];
    expect(token).toBeDefined();

    const [settings] = await db.select().from(instanceSettings);
    expect(settings?.setupTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(settings)).not.toContain(token);
  });

  it("issues a new token on every boot while setup is incomplete", async () => {
    const first = await captureSetupToken(db);
    const second = await captureSetupToken(db);
    expect(second).not.toBe(first);

    const { app } = buildApp(db, pool);
    const stale = await call(app, "POST", "/setup/verify-token", { body: { token: first } });
    expect(stale.status).toBe(403);
  });

  it("prints nothing once setup is complete", async () => {
    const { app } = buildApp(db, pool);
    const token = await captureSetupToken(db);
    await call(app, "POST", "/setup", { body: setupBody(token) });

    let output = "";
    await ensureSetupToken(db, (text) => {
      output += text;
    });
    expect(output).toBe("");
  });
});

describe("setup gate", () => {
  it("blocks the API with 409 setup_required until setup completes", async () => {
    const { app } = buildApp(db, pool);
    await captureSetupToken(db);
    const res = await call(app, "GET", "/auth/me");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "setup_required" } });
  });

  it("keeps health and setup status reachable", async () => {
    const { app } = buildApp(db, pool);
    await captureSetupToken(db);
    expect((await call(app, "GET", "/health")).status).toBe(200);
    const status = await call(app, "GET", "/setup/status");
    expect(await status.json()).toEqual({ completed: false });
  });
});

describe("POST /setup/verify-token", () => {
  it("accepts the right token and rejects a wrong one", async () => {
    const { app } = buildApp(db, pool);
    const token = await captureSetupToken(db);
    expect((await call(app, "POST", "/setup/verify-token", { body: { token } })).status).toBe(204);
    const wrong = await call(app, "POST", "/setup/verify-token", { body: { token: "jk_setup_x" } });
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ error: { code: "invalid_setup_token" } });
  });
});

describe("POST /setup", () => {
  it("creates the admin, logs them in, and opens the gate", async () => {
    const { app } = buildApp(db, pool);
    const token = await captureSetupToken(db);
    const res = await call(app, "POST", "/setup", { body: setupBody(token) });

    expect(res.status).toBe(201);
    const body = meResponse.parse(await res.json());
    expect(body.user).toMatchObject({ email: "ada@acme.co", name: ADMIN.name, isAdmin: true });
    expect(body.org).toEqual({ name: "Acme", host: "jangka.test" });

    const cookie = sessionCookie(res);
    expect(cookie).not.toBeNull();
    const me = await call(app, "GET", "/auth/me", { cookie });
    expect(me.status).toBe(200);

    const [admins] = await db.select().from(groups).where(eq(groups.systemKey, "admins"));
    const memberships = await db.select().from(groupMembers);
    expect(memberships).toEqual([expect.objectContaining({ groupId: admins?.id })]);
    expect(await db.select().from(groups)).toHaveLength(2);

    const [settings] = await db.select().from(instanceSettings);
    expect(settings?.setupTokenHash).toBeNull();
    expect(settings?.setupCompletedAt).not.toBeNull();
    const status = await call(app, "GET", "/setup/status");
    expect(await status.json()).toEqual({ completed: true });
  });

  it("never returns the password hash", async () => {
    const { app } = buildApp(db, pool);
    const token = await captureSetupToken(db);
    const text = await (await call(app, "POST", "/setup", { body: setupBody(token) })).text();
    const [user] = await db.select().from(users);
    expect(text).not.toContain(user?.passwordHash ?? "missing");
    expect(text).not.toContain("argon2");
  });

  it("rejects a wrong token", async () => {
    const { app } = buildApp(db, pool);
    await captureSetupToken(db);
    const res = await call(app, "POST", "/setup", { body: setupBody("jk_setup_wrong") });
    expect(res.status).toBe(403);
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("rejects a second setup with 409 setup_completed", async () => {
    const { app } = buildApp(db, pool);
    const token = await captureSetupToken(db);
    await call(app, "POST", "/setup", { body: setupBody(token) });
    const again = await call(app, "POST", "/setup", { body: setupBody(token) });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "setup_completed" } });
  });

  it("lets exactly one of two concurrent setups succeed", async () => {
    const { app } = buildApp(db, pool);
    const token = await captureSetupToken(db);
    const [a, b] = await Promise.all([
      call(app, "POST", "/setup", { body: setupBody(token) }),
      call(app, "POST", "/setup", { body: { ...setupBody(token), adminEmail: "other@acme.co" } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await db.select().from(users)).toHaveLength(1);
  });
});
