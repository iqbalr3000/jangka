import {
  type authProviders,
  type Database,
  groupMembers,
  instanceSettings,
  userIdentities,
  users,
} from "@jangka/db";
import type { SsoError } from "@jangka/shared/auth";
import { and, eq } from "drizzle-orm";
import { createPersonalCollection } from "./access";

export type SsoProvider = Pick<
  typeof authProviders.$inferSelect,
  "id" | "kind" | "allowedDomains" | "autoProvision"
>;

/** Claims from a verified ID token. */
export type SsoClaims = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  /** Google Workspace domain. */
  hd?: string;
};

export type SsoResult =
  | { kind: "login"; userId: string; via: "subject" | "email" | "provisioned" }
  | { kind: "denied"; reason: SsoError; email: string | null };

/** With `allowed_domains` set, the email's domain (and Google's `hd`) must be listed. */
export function domainAllowed(provider: SsoProvider, email: string | null, hd?: string): boolean {
  if (provider.allowedDomains.length === 0) return true;
  const domain = email?.split("@")[1];
  if (!domain || !provider.allowedDomains.includes(domain)) return false;
  return provider.kind !== "google" || provider.allowedDomains.includes(hd?.toLowerCase() ?? "");
}

/**
 * Account linking: (1) known (provider, subject); (2) an existing user with the same
 * email, only when the IdP says it's verified; (3) auto-provision; else deny. Inactive users are
 * denied on every path.
 */
export async function resolveSsoLogin(
  db: Database,
  provider: SsoProvider,
  claims: SsoClaims,
): Promise<SsoResult> {
  const email = claims.email?.trim().toLowerCase() || null;
  const denied = (reason: SsoError): SsoResult => ({ kind: "denied", reason, email });
  if (!domainAllowed(provider, email, claims.hd)) return denied("domain_not_allowed");

  return db.transaction(async (tx) => {
    const now = new Date();
    const login = async (userId: string, via: "subject" | "email" | "provisioned") => {
      await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, userId));
      await tx
        .update(userIdentities)
        .set({ lastLoginAt: now })
        .where(
          and(eq(userIdentities.providerId, provider.id), eq(userIdentities.subject, claims.sub)),
        );
      return { kind: "login", userId, via } satisfies SsoResult;
    };
    const link = (userId: string) =>
      tx.insert(userIdentities).values({
        userId,
        providerId: provider.id,
        subject: claims.sub,
        email,
      });

    const [known] = await tx
      .select({ userId: users.id, isActive: users.isActive })
      .from(userIdentities)
      .innerJoin(users, eq(users.id, userIdentities.userId))
      .where(
        and(eq(userIdentities.providerId, provider.id), eq(userIdentities.subject, claims.sub)),
      );
    if (known) return known.isActive ? login(known.userId, "subject") : denied("inactive");

    const [existing] = email ? await tx.select().from(users).where(eq(users.email, email)) : [];
    if (existing) {
      // An unverified email could be anyone's: never link on it.
      if (claims.email_verified !== true) return denied("not_linked");
      if (!existing.isActive) return denied("inactive");
      await link(existing.id);
      return login(existing.id, "email");
    }

    if (!provider.autoProvision || !email) return denied("not_linked");
    const [created] = await tx
      .insert(users)
      .values({ email, name: claims.name?.trim() || email.split("@")[0] || email })
      .returning();
    if (!created) throw new Error("user not created");
    await createPersonalCollection(tx, created);
    const [settings] = await tx
      .select({ defaultGroupId: instanceSettings.defaultGroupId })
      .from(instanceSettings);
    if (settings?.defaultGroupId) {
      await tx
        .insert(groupMembers)
        .values({ groupId: settings.defaultGroupId, userId: created.id });
    }
    await link(created.id);
    return login(created.id, "provisioned");
  });
}
