import { invites, sessions } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { adminUserList, inviteLinkResponse } from "@jangka/shared/auth";
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
let adminCookie: string;
beforeEach(async () => {
  await truncateAll(pool);
  app = buildApp(db, pool).app;
  adminCookie = await setupInstance(app, db);
});

const RINA = { name: "Rina", email: "rina@acme.co", password: "rina-password-123" };

async function inviteToken(email: string): Promise<string> {
  const res = await call(app, "POST", "/admin/invites", { cookie: adminCookie, body: { email } });
  expect(res.status).toBe(201);
  const { url } = inviteLinkResponse.parse(await res.json());
  expect(url).toMatch(/^http:\/\/jangka\.test\/invite\//);
  return url.split("/invite/")[1] ?? "";
}

async function resetToken(userId: string): Promise<string> {
  const res = await call(app, "POST", `/admin/users/${userId}/reset-link`, { cookie: adminCookie });
  expect(res.status).toBe(201);
  return inviteLinkResponse.parse(await res.json()).url.split("/invite/")[1] ?? "";
}

describe("admin authorization", () => {
  it("rejects non-admins and anonymous users", async () => {
    await createUser(db, RINA);
    const cookie = await login(app, RINA.email, RINA.password);
    expect((await call(app, "GET", "/admin/users", { cookie })).status).toBe(403);
    expect((await call(app, "GET", "/admin/users")).status).toBe(401);
  });
});

describe("invites", () => {
  it("creates a non-admin account and logs the new user in", async () => {
    const token = await inviteToken("Rina@Acme.co");

    const info = await call(app, "GET", `/invites/${token}`);
    expect(await info.json()).toEqual({
      kind: "invite",
      email: "rina@acme.co",
      orgName: "Acme",
      name: null,
    });

    const res = await call(app, "POST", `/invites/${token}/accept`, {
      body: { name: "Rina", password: RINA.password },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { email: "rina@acme.co", isAdmin: false } });
    expect(sessionCookie(res)).not.toBeNull();
    await login(app, RINA.email, RINA.password);
  });

  it("requires a name when accepting an invite", async () => {
    const token = await inviteToken(RINA.email);
    const res = await call(app, "POST", `/invites/${token}/accept`, {
      body: { password: RINA.password },
    });
    expect(res.status).toBe(400);
  });

  it("is single-use", async () => {
    const token = await inviteToken(RINA.email);
    const body = { name: "Rina", password: RINA.password };
    await call(app, "POST", `/invites/${token}/accept`, { body });
    const again = await call(app, "POST", `/invites/${token}/accept`, { body });
    expect(again.status).toBe(410);
    expect((await call(app, "GET", `/invites/${token}`)).status).toBe(410);
  });

  it("rejects an expired invite", async () => {
    const token = await inviteToken(RINA.email);
    await db.update(invites).set({ expiresAt: sql`now() - interval '1 minute'` });
    expect((await call(app, "GET", `/invites/${token}`)).status).toBe(410);
  });

  it("rejects inviting an email that already has an account", async () => {
    const res = await call(app, "POST", "/admin/invites", {
      cookie: adminCookie,
      body: { email: ADMIN.email },
    });
    expect(res.status).toBe(409);
  });

  it("lists pending invites and revokes them", async () => {
    const token = await inviteToken(RINA.email);
    const list = await call(app, "GET", "/admin/invites", { cookie: adminCookie });
    const { items } = (await list.json()) as { items: { id: string; email: string }[] };
    expect(items.map((i) => i.email)).toEqual([RINA.email]);
    expect(JSON.stringify(items)).not.toContain(token);

    const id = items[0]?.id;
    expect(
      (await call(app, "DELETE", `/admin/invites/${id}`, { cookie: adminCookie })).status,
    ).toBe(204);
    expect((await call(app, "GET", `/invites/${token}`)).status).toBe(410);
  });
});

describe("password reset links", () => {
  it("sets a new password and revokes existing sessions", async () => {
    const userId = await createUser(db, RINA);
    const oldCookie = await login(app, RINA.email, RINA.password);
    const token = await resetToken(userId);

    const info = await call(app, "GET", `/invites/${token}`);
    expect(await info.json()).toMatchObject({ kind: "password_reset", name: "Rina" });

    const res = await call(app, "POST", `/invites/${token}/accept`, {
      body: { password: "brand-new-password" },
    });
    expect(res.status).toBe(200);
    expect((await call(app, "GET", "/auth/me", { cookie: oldCookie })).status).toBe(401);
    expect(
      (
        await call(app, "POST", "/auth/login", {
          body: { email: RINA.email, password: RINA.password },
        })
      ).status,
    ).toBe(401);
    await login(app, RINA.email, "brand-new-password");
  });

  it("expires the previous link when a new one is issued", async () => {
    const userId = await createUser(db, RINA);
    const first = await resetToken(userId);
    await resetToken(userId);
    expect((await call(app, "GET", `/invites/${first}`)).status).toBe(410);
  });
});

describe("PATCH /admin/users/:id", () => {
  it("deactivating removes sessions and blocks login; reactivating restores login", async () => {
    const userId = await createUser(db, RINA);
    const cookie = await login(app, RINA.email, RINA.password);

    const res = await call(app, "PATCH", `/admin/users/${userId}`, {
      cookie: adminCookie,
      body: { isActive: false },
    });
    expect(res.status).toBe(200);
    expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(0);
    expect((await call(app, "GET", "/auth/me", { cookie })).status).toBe(401);
    expect(
      (
        await call(app, "POST", "/auth/login", {
          body: { email: RINA.email, password: RINA.password },
        })
      ).status,
    ).toBe(401);

    await call(app, "PATCH", `/admin/users/${userId}`, {
      cookie: adminCookie,
      body: { isActive: true },
    });
    await login(app, RINA.email, RINA.password);
  });

  it("refuses to deactivate yourself", async () => {
    const me = (await (await call(app, "GET", "/auth/me", { cookie: adminCookie })).json()) as {
      user: { id: string };
    };
    const res = await call(app, "PATCH", `/admin/users/${me.user.id}`, {
      cookie: adminCookie,
      body: { isActive: false },
    });
    expect(res.status).toBe(409);
  });
});

describe("GET /admin/users", () => {
  it("paginates with a cursor and never exposes password hashes", async () => {
    for (let i = 0; i < 3; i++) {
      await createUser(db, {
        name: `User ${i}`,
        email: `user${i}@acme.co`,
        password: "user-password-123",
      });
    }
    const first = await call(app, "GET", "/admin/users?limit=2", { cookie: adminCookie });
    const page1 = adminUserList.parse(await first.json());
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0]).toMatchObject({ email: ADMIN.email, isAdmin: true, isActive: true });
    expect(page1.nextCursor).not.toBeNull();

    const second = await call(app, "GET", `/admin/users?limit=2&cursor=${page1.nextCursor}`, {
      cookie: adminCookie,
    });
    const page2 = adminUserList.parse(await second.json());
    expect(page2.items.map((u) => u.email)).toEqual(["user1@acme.co", "user2@acme.co"]);
    expect(page2.nextCursor).toBeNull();
    expect(JSON.stringify([page1, page2])).not.toContain("argon2");
  });
});
