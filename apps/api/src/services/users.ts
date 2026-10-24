import {
  type Database,
  groupMembers,
  groups,
  instanceSettings,
  type Transaction,
} from "@jangka/db";
import type { MeResponse, SessionUser } from "@jangka/shared/auth";
import { eq } from "drizzle-orm";
import { memberships } from "./access";

type Db = Database | Transaction;

export async function isAdmin(db: Db, userId: string): Promise<boolean> {
  return (await memberships(db, userId)).isAdmin;
}

export async function adminUserIds(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groups.systemKey, "admins"));
  return new Set(rows.map((row) => row.userId));
}

export async function orgName(db: Db): Promise<string> {
  const [settings] = await db
    .select({ orgName: instanceSettings.orgName })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, 1));
  return settings?.orgName ?? "";
}

export async function meFor(db: Db, user: SessionUser, publicUrl: string): Promise<MeResponse> {
  return { user, org: { name: await orgName(db), host: new URL(publicUrl).host } };
}
