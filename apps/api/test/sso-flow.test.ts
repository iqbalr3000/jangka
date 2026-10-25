import { authProviders, groups } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import {
  adminUserList,
  authOptions,
  authProviderList,
  authProviderView,
  instanceSettingsView,
} from "@jangka/shared/auth";
import { encryptSecret } from "@jangka/shared/crypto";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN,
  buildApp,
  call,
  createUser,
  PUBLIC_URL,
  sessionCookie,
  setupInstance,
  TEST_MASTER_KEY,
  type TestApp,
  testDatabase,
} from "./helpers";
import { type OidcStub, startOidcStub } from "./oidc-stub";

const { db, pool } = testDatabase();
let stub: OidcStub;
beforeAll(async () => {
  stub = await startOidcStub();
});
afterAll(async () => {
  await stub.close();
  await pool.end();
});

const CLIENT_SECRET = "oidc-SECRET-value-0123456789";
const logLines: string[] = [];
const logger = pino({ level: "debug" }, { write: (line: string) => logLines.push(line) });

let app: TestApp;
let admin: string;

beforeEach(async () => {
  await truncateAll(pool);
  logLines.length = 0;
  stub.state.tamper = {};
  stub.state.nextClaims = { sub: "ada-1", email: ADMIN.email, email_verified: true };
  app = buildApp(db, pool, { logger }).app;
  admin = await setupInstance(app, db);
});

async function addProvider(overrides: Record<string, unknown> = {}) {
  const res = await call(app, "POST", "/admin/auth-providers", {
    cookie: admin,
    body: {
      kind: "oidc",
      name: "Stub IdP",
      issuer: stub.issuer,
      clientId: "jangka",
      clientSecret: CLIENT_SECRET,
      allowedDomains: [],
      autoProvision: false,
      enabled: true,
      ...overrides,
    },
  });
  expect(res.status).toBe(201);
  return authProviderView.parse(await res.json());
}

function cookieValue(res: Response, name: string): string | null {
  for (const header of res.headers.getSetCookie()) {
    const match = new RegExp(`^${name}=([^;]*)`).exec(header);
    if (match) return match[1] ? `${name}=${match[1]}` : null;
  }
  return null;
}

/** Start → IdP (signs in as stub.state.nextClaims) → callback URL; nothing followed after that. */
async function signIn(providerId: string, redirect = "/") {
  const start = await app.request(
    `/api/v1/auth/oidc/${providerId}/start?redirect=${encodeURIComponent(redirect)}`,
  );
  expect(start.status).toBe(302);
  const flowCookie = cookieValue(start, "jangka_oidc");
  const idp = await fetch(start.headers.get("location") ?? "", { redirect: "manual" });
  const callback = new URL(idp.headers.get("location") ?? "");
  expect(callback.origin).toBe(PUBLIC_URL);
  return { flowCookie, callback };
}

function finish(callback: URL, flowCookie: string | null) {
  return app.request(`${callback.pathname}${callback.search}`, {
    headers: flowCookie ? { cookie: flowCookie } : {},
  });
}

describe("sign-in flow", () => {
  it("links by verified email, starts a session and returns to a relative path", async () => {
    const provider = await addProvider();
    const { flowCookie, callback } = await signIn(provider.id, "/d/abc?x=1");
    const res = await finish(callback, flowCookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/d/abc?x=1");
    expect(cookieValue(res, "jangka_oidc")).toBeNull();
    const session = sessionCookie(res);
    const me = await call(app, "GET", "/auth/me", { cookie: session });
    expect(await me.json()).toMatchObject({ user: { email: ADMIN.email, isAdmin: true } });

    const users = adminUserList.parse(
      await (await call(app, "GET", "/admin/users", { cookie: admin })).json(),
    );
    expect(users.items.find((u) => u.email === ADMIN.email)?.identities).toEqual(["Stub IdP"]);
  });

  it("never redirects off-site", async () => {
    const provider = await addProvider();
    for (const target of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
      const { flowCookie, callback } = await signIn(provider.id, target);
      expect((await finish(callback, flowCookie)).headers.get("location")).toBe("/");
    }
  });

  it("rejects a missing, tampered or expired flow cookie, and a wrong state or nonce", async () => {
    const provider = await addProvider();
    const failure = (res: Response) => res.headers.get("location");
    const invalid = "/login?sso_error=invalid_state";

    let flow = await signIn(provider.id);
    expect(failure(await finish(flow.callback, null))).toBe(invalid);

    flow = await signIn(provider.id);
    expect(failure(await finish(flow.callback, `${flow.flowCookie}x`))).toBe(invalid);

    flow = await signIn(provider.id);
    const expired = encryptSecret(
      JSON.stringify({
        providerId: provider.id,
        state: flow.callback.searchParams.get("state"),
        nonce: "n",
        verifier: "v",
        redirect: "/",
        expiresAt: Date.now() - 1000,
      }),
      TEST_MASTER_KEY,
    );
    expect(failure(await finish(flow.callback, `jangka_oidc=${expired}`))).toBe(invalid);

    flow = await signIn(provider.id);
    flow.callback.searchParams.set("state", "forged");
    expect(failure(await finish(flow.callback, flow.flowCookie))).toBe(invalid);

    stub.state.tamper = { nonce: "replayed" };
    flow = await signIn(provider.id);
    const res = await finish(flow.callback, flow.flowCookie);
    expect(failure(res)).toBe(invalid);
    expect(sessionCookie(res)).toBeNull();
  });

  it("reports denials to the login page", async () => {
    const provider = await addProvider({ allowedDomains: ["acme.co"] });
    stub.state.nextClaims = { sub: "x-1", email: "eve@other.co", email_verified: true };
    let flow = await signIn(provider.id);
    expect((await finish(flow.callback, flow.flowCookie)).headers.get("location")).toBe(
      "/login?sso_error=domain_not_allowed&email=eve%40other.co",
    );

    stub.state.nextClaims = { sub: "x-2", email: ADMIN.email, email_verified: "true" };
    flow = await signIn(provider.id);
    expect((await finish(flow.callback, flow.flowCookie)).headers.get("location")).toBe(
      "/login?sso_error=not_linked",
    );
  });

  it("refuses disabled providers", async () => {
    const provider = await addProvider();
    const flow = await signIn(provider.id);
    await db.update(authProviders).set({ enabled: false }).where(eq(authProviders.id, provider.id));
    expect((await finish(flow.callback, flow.flowCookie)).headers.get("location")).toBe(
      "/login?sso_error=provider_error",
    );
    const start = await app.request(`/api/v1/auth/oidc/${provider.id}/start`);
    expect(start.headers.get("location")).toBe("/login?sso_error=provider_error");
  });

  it("lists enabled providers for the login page", async () => {
    const provider = await addProvider();
    await addProvider({ name: "Off", enabled: false });
    const res = await call(app, "GET", "/auth/oidc/providers");
    expect(authOptions.parse(await res.json())).toEqual({
      passwordLoginEnabled: true,
      providers: [{ id: provider.id, name: "Stub IdP", kind: "oidc" }],
    });
  });
});

describe("admin", () => {
  it("never exposes or logs the client secret", async () => {
    const provider = await addProvider();
    expect(provider.secretLast4).toBe("6789");
    const patched = await call(app, "PATCH", `/admin/auth-providers/${provider.id}`, {
      cookie: admin,
      body: { name: "Renamed", clientSecret: `${CLIENT_SECRET}-2` },
    });
    const list = await call(app, "GET", "/admin/auth-providers", { cookie: admin });
    const listText = await list.text();
    expect(authProviderList.parse(JSON.parse(listText)).redirectUri).toBe(
      `${PUBLIC_URL}/api/v1/auth/oidc/callback`,
    );
    const bodies = [JSON.stringify(provider), await patched.text(), listText];
    for (const body of bodies) expect(body).not.toContain(CLIENT_SECRET);
    const { flowCookie, callback } = await signIn(provider.id);
    await finish(callback, flowCookie);
    expect(logLines.join("")).not.toContain(CLIENT_SECRET);
    const [row] = await db.select().from(authProviders);
    expect(row?.clientSecretEnc).not.toContain(CLIENT_SECRET);
  });

  it("requires https issuers except on localhost, and a working discovery", async () => {
    const insecure = await call(app, "POST", "/admin/auth-providers", {
      cookie: admin,
      body: {
        kind: "oidc",
        name: "Bad",
        issuer: "http://idp.example.com",
        clientId: "c",
        clientSecret: "s",
        allowedDomains: [],
        autoProvision: false,
        enabled: true,
      },
    });
    expect(insecure.status).toBe(400);
    const broken = await call(app, "POST", "/admin/auth-providers", {
      cookie: admin,
      body: {
        kind: "oidc",
        name: "Broken",
        issuer: `${stub.issuer}/nowhere`,
        clientId: "c",
        clientSecret: "s",
        allowedDomains: [],
        autoProvision: false,
        enabled: true,
      },
    });
    expect(broken.status).toBe(400);
    expect(await broken.json()).toMatchObject({ error: { code: "invalid_provider" } });
  });

  it("keeps Google's issuer fixed", async () => {
    const [google] = await db
      .insert(authProviders)
      .values({
        kind: "google",
        name: "Google",
        issuer: "https://accounts.google.com",
        clientId: "g",
        clientSecretEnc: encryptSecret("s", TEST_MASTER_KEY),
        secretLast4: "s",
      })
      .returning();
    const res = await call(app, "PATCH", `/admin/auth-providers/${google?.id}`, {
      cookie: admin,
      body: { name: "Google Workspace" },
    });
    expect(authProviderView.parse(await res.json()).issuer).toBe("https://accounts.google.com");
  });

  it("guards password login against lockout in both directions", async () => {
    const settings = (body: unknown) =>
      call(app, "PUT", "/admin/settings", { cookie: admin, body });
    expect((await settings({ passwordLoginEnabled: false })).status).toBe(409);

    const provider = await addProvider();
    const view = instanceSettingsView.parse(
      await (await call(app, "GET", "/admin/settings", { cookie: admin })).json(),
    );
    expect(view.disablePasswordLoginBlocker).toMatch(/admin must sign in with SSO/);

    const { flowCookie, callback } = await signIn(provider.id);
    await finish(callback, flowCookie);
    const off = await settings({ passwordLoginEnabled: false });
    expect(instanceSettingsView.parse(await off.json())).toMatchObject({
      passwordLoginEnabled: false,
      disablePasswordLoginBlocker: null,
    });

    const disable = await call(app, "PATCH", `/admin/auth-providers/${provider.id}`, {
      cookie: admin,
      body: { enabled: false },
    });
    expect(disable.status).toBe(409);
    expect(await disable.json()).toMatchObject({ error: { code: "lockout_risk" } });
    const remove = await call(app, "DELETE", `/admin/auth-providers/${provider.id}`, {
      cookie: admin,
    });
    expect(remove.status).toBe(409);

    await settings({ passwordLoginEnabled: true });
    expect(
      (await call(app, "DELETE", `/admin/auth-providers/${provider.id}`, { cookie: admin })).status,
    ).toBe(204);
  });

  it("refuses password sign-in when off, unless FORCE_PASSWORD_LOGIN is set", async () => {
    const provider = await addProvider();
    const { flowCookie, callback } = await signIn(provider.id);
    await finish(callback, flowCookie);
    await call(app, "PUT", "/admin/settings", {
      cookie: admin,
      body: { passwordLoginEnabled: false },
    });
    const login = (target: TestApp) =>
      call(target, "POST", "/auth/login", {
        body: { email: ADMIN.email, password: ADMIN.password },
      });
    const refused = await login(app);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "password_login_disabled" } });

    const forced = buildApp(db, pool, { forcePasswordLogin: true }).app;
    expect((await login(forced)).status).toBe(200);
    const options = authOptions.parse(
      await (await call(forced, "GET", "/auth/oidc/providers")).json(),
    );
    expect(options.passwordLoginEnabled).toBe(true);
  });

  it("only accepts groups admins created as the default group", async () => {
    const [admins] = await db.select().from(groups).where(eq(groups.systemKey, "admins"));
    const bad = await call(app, "PUT", "/admin/settings", {
      cookie: admin,
      body: { defaultGroupId: admins?.id },
    });
    expect(bad.status).toBe(400);
    const [support] = await db.insert(groups).values({ name: "Support" }).returning();
    const ok = await call(app, "PUT", "/admin/settings", {
      cookie: admin,
      body: { defaultGroupId: support?.id },
    });
    expect(instanceSettingsView.parse(await ok.json()).defaultGroupId).toBe(support?.id);
  });

  it("is admin only", async () => {
    await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
    const rina = await call(app, "POST", "/auth/login", {
      body: { email: "rina@acme.co", password: "rina-password-123" },
    });
    const cookie = sessionCookie(rina);
    expect((await call(app, "GET", "/admin/auth-providers", { cookie })).status).toBe(403);
    expect((await call(app, "GET", "/admin/settings", { cookie })).status).toBe(403);
    authProviderList.parse(
      await (await call(app, "GET", "/admin/auth-providers", { cookie: admin })).json(),
    );
  });
});
