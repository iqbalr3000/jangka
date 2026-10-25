import {
  authProviders,
  collections,
  groupMembers,
  groups,
  instanceSettings,
  userIdentities,
  users,
} from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { encryptSecret } from "@jangka/shared/crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resolveSsoLogin, type SsoProvider } from "../src/services/sso";
import { buildApp, createUser, setupInstance, TEST_MASTER_KEY, testDatabase } from "./helpers";

const { db, pool } = testDatabase();
afterAll(async () => {
  await pool.end();
});

let rinaId: string;

beforeEach(async () => {
  await truncateAll(pool);
  const { app } = buildApp(db, pool);
  await setupInstance(app, db);
  rinaId = await createUser(db, {
    name: "Rina",
    email: "rina@acme.co",
    password: "rina-password-123",
  });
});

async function provider(overrides: Partial<typeof authProviders.$inferInsert> = {}) {
  const [row] = await db
    .insert(authProviders)
    .values({
      kind: "oidc",
      name: "Okta",
      issuer: "https://idp.example.com",
      clientId: "client",
      clientSecretEnc: encryptSecret("secret", TEST_MASTER_KEY),
      secretLast4: "cret",
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("provider not created");
  return row satisfies SsoProvider;
}

async function identitiesOf(userId: string) {
  return db.select().from(userIdentities).where(eq(userIdentities.userId, userId));
}

describe("resolveSsoLogin", () => {
  it("logs in by (provider, subject) first", async () => {
    const okta = await provider();
    await db.insert(userIdentities).values({ userId: rinaId, providerId: okta.id, subject: "s-1" });
    // Even with a different, unverified email: the subject decides.
    const result = await resolveSsoLogin(db, okta, { sub: "s-1", email: "other@else.co" });
    expect(result).toEqual({ kind: "login", userId: rinaId, via: "subject" });
    const [identity] = await identitiesOf(rinaId);
    expect(identity?.lastLoginAt).toBeInstanceOf(Date);
    const [rina] = await db.select().from(users).where(eq(users.id, rinaId));
    expect(rina?.lastLoginAt).toBeInstanceOf(Date);
  });

  it("links an existing user when the email is verified", async () => {
    const okta = await provider();
    const result = await resolveSsoLogin(db, okta, {
      sub: "s-2",
      email: "Rina@Acme.co",
      email_verified: true,
    });
    expect(result).toEqual({ kind: "login", userId: rinaId, via: "email" });
    expect((await identitiesOf(rinaId)).map((i) => [i.subject, i.email])).toEqual([
      ["s-2", "rina@acme.co"],
    ]);
  });

  it("refuses to link by an unverified or unreported email", async () => {
    const okta = await provider({ autoProvision: true });
    for (const claims of [
      { sub: "s-3", email: "rina@acme.co", email_verified: false },
      { sub: "s-3", email: "rina@acme.co" },
    ]) {
      expect(await resolveSsoLogin(db, okta, claims)).toEqual({
        kind: "denied",
        reason: "not_linked",
        email: "rina@acme.co",
      });
    }
    expect(await identitiesOf(rinaId)).toEqual([]);
  });

  it("auto-provisions a new user with a personal collection and the default group", async () => {
    const okta = await provider({ autoProvision: true });
    const [support] = await db.insert(groups).values({ name: "Support" }).returning();
    await db.update(instanceSettings).set({ defaultGroupId: support?.id ?? null });
    const result = await resolveSsoLogin(db, okta, {
      sub: "s-4",
      email: "new@acme.co",
      email_verified: true,
      name: "Nina New",
    });
    expect(result).toMatchObject({ kind: "login", via: "provisioned" });
    if (result.kind !== "login") throw new Error("expected a login");
    const [user] = await db.select().from(users).where(eq(users.id, result.userId));
    expect(user).toMatchObject({ name: "Nina New", email: "new@acme.co", passwordHash: null });
    const personal = await db
      .select()
      .from(collections)
      .where(eq(collections.personalOwnerId, result.userId));
    expect(personal).toHaveLength(1);
    const memberOf = await db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.userId, result.userId));
    expect(memberOf.map((m) => m.groupId)).toEqual([support?.id]);
    expect(await identitiesOf(result.userId)).toHaveLength(1);
  });

  it("auto-provisions without a default group, naming the user after the email", async () => {
    const okta = await provider({ autoProvision: true });
    const result = await resolveSsoLogin(db, okta, { sub: "s-5", email: "budi@acme.co" });
    if (result.kind !== "login") throw new Error("expected a login");
    const [user] = await db.select().from(users).where(eq(users.id, result.userId));
    expect(user?.name).toBe("budi");
    expect(
      await db.select().from(groupMembers).where(eq(groupMembers.userId, result.userId)),
    ).toEqual([]);
  });

  it("denies an unknown identity when auto-provision is off, or when there is no email", async () => {
    const okta = await provider();
    expect(
      await resolveSsoLogin(db, okta, { sub: "s-6", email: "x@acme.co", email_verified: true }),
    ).toEqual({
      kind: "denied",
      reason: "not_linked",
      email: "x@acme.co",
    });
    const open = await provider({ name: "Open", autoProvision: true });
    expect(await resolveSsoLogin(db, open, { sub: "s-7" })).toEqual({
      kind: "denied",
      reason: "not_linked",
      email: null,
    });
  });

  it("denies inactive users on both the subject and the email path", async () => {
    const okta = await provider();
    await db.update(users).set({ isActive: false }).where(eq(users.id, rinaId));
    expect(
      await resolveSsoLogin(db, okta, { sub: "s-8", email: "rina@acme.co", email_verified: true }),
    ).toMatchObject({ kind: "denied", reason: "inactive" });
    await db.insert(userIdentities).values({ userId: rinaId, providerId: okta.id, subject: "s-9" });
    expect(await resolveSsoLogin(db, okta, { sub: "s-9" })).toMatchObject({
      kind: "denied",
      reason: "inactive",
    });
  });

  it("enforces allowed domains before anything else, case-insensitively", async () => {
    const okta = await provider({ allowedDomains: ["acme.co"], autoProvision: true });
    await db
      .insert(userIdentities)
      .values({ userId: rinaId, providerId: okta.id, subject: "s-10" });
    expect(await resolveSsoLogin(db, okta, { sub: "s-10", email: "rina@ACME.co" })).toMatchObject({
      kind: "login",
    });
    // A linked identity whose email moved to another domain is refused too.
    expect(await resolveSsoLogin(db, okta, { sub: "s-10", email: "rina@gmail.com" })).toEqual({
      kind: "denied",
      reason: "domain_not_allowed",
      email: "rina@gmail.com",
    });
    expect(await resolveSsoLogin(db, okta, { sub: "s-11" })).toEqual({
      kind: "denied",
      reason: "domain_not_allowed",
      email: null,
    });
  });

  it("checks Google's hd claim against the allowed domains", async () => {
    const google = await provider({
      kind: "google",
      name: "Google",
      issuer: "https://accounts.google.com",
      allowedDomains: ["acme.co"],
    });
    const claims = { sub: "g-1", email: "rina@acme.co", email_verified: true };
    expect(await resolveSsoLogin(db, google, { ...claims, hd: "other.co" })).toMatchObject({
      kind: "denied",
      reason: "domain_not_allowed",
    });
    expect(await resolveSsoLogin(db, google, claims)).toMatchObject({
      kind: "denied",
      reason: "domain_not_allowed",
    });
    expect(await resolveSsoLogin(db, google, { ...claims, hd: "acme.co" })).toMatchObject({
      kind: "login",
      userId: rinaId,
    });
  });

  it("links a second provider to the same user", async () => {
    const okta = await provider();
    const google = await provider({ kind: "google", name: "Google" });
    const verified = { email: "rina@acme.co", email_verified: true };
    await resolveSsoLogin(db, okta, { sub: "o-1", ...verified });
    await resolveSsoLogin(db, google, { sub: "g-1", ...verified });
    expect((await identitiesOf(rinaId)).map((i) => i.providerId).sort()).toEqual(
      [okta.id, google.id].sort(),
    );
  });
});
