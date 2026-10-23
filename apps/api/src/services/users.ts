import {
  type Database,
  groupMembers,
  groups,
  instanceSettings,
  type Transaction,
} from "@jangka/db";
import type { MeResponse, SessionUser } from "@jangka/shared/auth";
import { and, eq } from "drizzle-orm";

type Db = Database | Transaction;

export async function isAdmin(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groups.systemKey, "admins"), eq(groupMembers.userId, userId)))
    .limit(1);
  return rows.length > 0;
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
