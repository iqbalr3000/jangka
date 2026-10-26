import {
  authProviders,
  type Database,
  groupMembers,
  groups,
  instanceSettings,
  type Transaction,
  userIdentities,
} from "@jangka/db";
import type { InstanceSettingsView } from "@jangka/shared/auth";
import { AppError } from "@jangka/shared/errors";
import { and, eq, ne } from "drizzle-orm";
import type { AppConfig } from "../types";

type Db = Database | Transaction;

async function settingsRow(db: Db) {
  const [row] = await db.select().from(instanceSettings);
  if (!row) throw new Error("instance settings missing");
  return row;
}

/** The setting, unless FORCE_PASSWORD_LOGIN overrides it (SSO lockout escape hatch). */
export async function passwordLoginAllowed(db: Db, config: AppConfig): Promise<boolean> {
  return config.forcePasswordLogin || (await settingsRow(db)).passwordLoginEnabled;
}

/**
 * Password login can go off only while SSO works for an admin: an enabled provider
 * through which some admin has signed in. Null when allowed.
 */
export async function disablePasswordLoginBlocker(db: Db): Promise<string | null> {
  const [enabled] = await db
    .select({ id: authProviders.id })
    .from(authProviders)
    .where(eq(authProviders.enabled, true))
    .limit(1);
  if (!enabled) return "Add and enable an SSO provider first.";
  const [linkedAdmin] = await db
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .innerJoin(authProviders, eq(authProviders.id, userIdentities.providerId))
    .innerJoin(groupMembers, eq(groupMembers.userId, userIdentities.userId))
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(authProviders.enabled, true), eq(groups.systemKey, "admins")))
    .limit(1);
  return linkedAdmin ? null : "An admin must sign in with SSO at least once first.";
}

/**
 * While password login is off, the last enabled provider (or the last one an admin is linked
 * through) can't go away, or nobody could sign in.
 */
export async function assertProviderCanBeDisabled(db: Db, providerId: string): Promise<void> {
  if ((await settingsRow(db)).passwordLoginEnabled) return;
  const [other] = await db
    .select({ id: authProviders.id })
    .from(authProviders)
    .innerJoin(userIdentities, eq(userIdentities.providerId, authProviders.id))
    .innerJoin(groupMembers, eq(groupMembers.userId, userIdentities.userId))
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(authProviders.enabled, true),
        ne(authProviders.id, providerId),
        eq(groups.systemKey, "admins"),
      ),
    )
    .limit(1);
  if (!other) {
    throw new AppError(
      "lockout_risk",
      409,
      "Turn password login back on first: no admin could sign in without this provider.",
    );
  }
}

export async function settingsView(db: Db, config: AppConfig): Promise<InstanceSettingsView> {
  const row = await settingsRow(db);
  return {
    passwordLoginEnabled: row.passwordLoginEnabled,
    passwordLoginForced: config.forcePasswordLogin,
    disablePasswordLoginBlocker: await disablePasswordLoginBlocker(db),
    defaultGroupId: row.defaultGroupId,
  };
}
