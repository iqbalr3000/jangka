import { sessions } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN,
  buildApp,
  call,
  createUser,
  login,
  sessionCookie,
  setupInstance,
  type TestApp,
  testDatabase,
} from "./helpers";

const { db, pool } = testDatabase();
afterAll(() => pool.end());

let app: TestApp;
beforeEach(async () => {
  await truncateAll(pool);
  app = buildApp(db, pool).app;
  await setupInstance(app, db);
});

const RINA = { name: "Rina", email: "rina@acme.co", password: "rina-password-123" };

describe("POST /auth/login", () => {
  it("sets a session cookie that authenticates /auth/me", async () => {
    await createUser(db, RINA);
    const res = await call(app, "POST", "/auth/login", {
      body: { email: RINA.email, password: RINA.password },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { email: RINA.email, isAdmin: false } });

    const header = res.headers.getSetCookie().find((h) => h.startsWith("jangka_session="));
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(header).not.toMatch(/Secure/i);

    const me = await call(app, "GET", "/auth/me", { cookie: sessionCookie(res) });
    expect(await me.json()).toMatchObject({ user: { email: RINA.email }, org: { name: "Acme" } });
  });

  it("treats email case-insensitively", async () => {
    await createUser(db, RINA);
    expect(await login(app, "RINA@Acme.CO", RINA.password)).toMatch(/^jangka_session=/);
  });

  it("returns the same 401 for a wrong password and an unknown email", async () => {
    await createUser(db, RINA);
    const wrong = await call(app, "POST", "/auth/login", {
      body: { email: RINA.email, password: "not-the-password" },
    });
    const unknown = await call(app, "POST", "/auth/login", {
      body: { email: "nobody@acme.co", password: "not-the-password" },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
  });

  it("rejects an inactive user with the same 401", async () => {
    await createUser(db, { ...RINA, isActive: false });
    const res = await call(app, "POST", "/auth/login", {
      body: { email: RINA.email, password: RINA.password },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_credentials" } });
  });

  it("rate limits after 10 failed attempts and resets on success", async () => {
    await createUser(db, RINA);
    const fail = () =>
      call(app, "POST", "/auth/login", { body: { email: RINA.email, password: "wrong-wrong" } });
    for (let i = 0; i < 10; i++) expect((await fail()).status).toBe(401);
    const limited = await fail();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: { code: "rate_limited" } });

    // Fresh limiter: 9 failures, a success, then 10 more failures must all be plain 401s.
    const other = buildApp(db, pool).app;
    const failOther = () =>
      call(other, "POST", "/auth/login", { body: { email: RINA.email, password: "wrong-wrong" } });
    for (let i = 0; i < 9; i++) await failOther();
    await login(other, RINA.email, RINA.password);
    for (let i = 0; i < 10; i++) expect((await failOther()).status).toBe(401);
  });
});

describe("sessions", () => {
  it("rejects /auth/me without a session", async () => {
    const res = await call(app, "GET", "/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects and deletes an expired session", async () => {
    const userId = await createUser(db, RINA);
    const cookie = await login(app, RINA.email, RINA.password);
    await db
      .update(sessions)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(eq(sessions.userId, userId));

    expect((await call(app, "GET", "/auth/me", { cookie })).status).toBe(401);
    expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(0);
  });

  it("extends a session last touched more than a day ago", async () => {
    await createUser(db, RINA);
    const cookie = await login(app, RINA.email, RINA.password);
    await db.update(sessions).set({
      expiresAt: sql`now() + interval '2 days'`,
      updatedAt: sql`now() - interval '2 days'`,
    });

    const res = await call(app, "GET", "/auth/me", { cookie });
    expect(res.status).toBe(200);
    expect(sessionCookie(res)).toBe(cookie);
    const [row] = await db
      .select({ days: sql<number>`extract(day from ${sessions.expiresAt} - now())::int` })
      .from(sessions)
      .where(sql`${sessions.userId} = (select id from users where email = ${RINA.email})`);
    expect(row?.days).toBeGreaterThanOrEqual(29);
  });

  it("does not touch a fresh session", async () => {
    await createUser(db, RINA);
    const cookie = await login(app, RINA.email, RINA.password);
    const res = await call(app, "GET", "/auth/me", { cookie });
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("logout deletes the session and clears the cookie", async () => {
    const cookie = await login(app, ADMIN.email, ADMIN.password);
    const res = await call(app, "POST", "/auth/logout", { cookie });
    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie().some((h) => /jangka_session=;/.test(h))).toBe(true);
    expect((await call(app, "GET", "/auth/me", { cookie })).status).toBe(401);
  });
});

describe("CSRF origin check", () => {
  it("rejects mutating requests without an Origin header", async () => {
    const res = await call(app, "POST", "/auth/login", {
      origin: null,
      body: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(res.status).toBe(403);
  });

  it("rejects mutating requests from another origin", async () => {
    const res = await call(app, "POST", "/auth/login", {
      origin: "https://evil.example",
      body: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(res.status).toBe(403);
  });

  it("allows safe requests without an Origin header", async () => {
    const res = await call(app, "GET", "/setup/status", { origin: null });
    expect(res.status).toBe(200);
  });
});
