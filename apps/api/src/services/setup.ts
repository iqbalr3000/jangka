import { type Database, groupMembers, groups, instanceSettings, users } from "@jangka/db";
import type { SetupRequest } from "@jangka/shared/auth";
import { generateToken, hashPassword, hashToken, matchesTokenHash } from "@jangka/shared/crypto";
import { AppError } from "@jangka/shared/errors";
import { eq, sql } from "drizzle-orm";

// Arbitrary constant, distinct from the migration lock.
const SETUP_LOCK_KEY = 7_311_208_554n;

/** Caches completion: once set up, an instance never goes back, so `true` is safe to keep. */
export class SetupState {
  private completed = false;

  constructor(private readonly db: Database) {}

  async isCompleted(): Promise<boolean> {
    if (this.completed) return true;
    const [settings] = await this.db
      .select({ completedAt: instanceSettings.setupCompletedAt })
      .from(instanceSettings)
      .where(eq(instanceSettings.id, 1));
    this.completed = Boolean(settings?.completedAt);
    return this.completed;
  }

  markCompleted(): void {
    this.completed = true;
  }
}

/**
 * Issues a fresh setup token on every boot until setup completes, so lost logs never lock the
 * admin out. Printing it is the one sanctioned exception to "never log the setup token": it goes
 * straight to stdout, not through the (redacting) logger.
 */
export async function ensureSetupToken(
  db: Database,
  write: (text: string) => void = (text) => process.stdout.write(text),
): Promise<void> {
  await db.insert(instanceSettings).values({ id: 1 }).onConflictDoNothing();
  const [settings] = await db.select().from(instanceSettings).where(eq(instanceSettings.id, 1));
  if (settings?.setupCompletedAt) return;

  const token = `jk_setup_${generateToken()}`;
  await db
    .update(instanceSettings)
    .set({ setupTokenHash: hashToken(token) })
    .where(eq(instanceSettings.id, 1));

  const rule = "=".repeat(72);
  write(
    `\n${rule}\nJangka is not set up yet. Open the app and enter this token:\n\nSETUP TOKEN: ${token}\n${rule}\n\n`,
  );
}

export async function verifySetupToken(db: Database, token: string): Promise<void> {
  const [settings] = await db.select().from(instanceSettings).where(eq(instanceSettings.id, 1));
  if (!settings || settings.setupCompletedAt) {
    throw new AppError("setup_completed", 409, "Setup is already complete");
  }
  if (!settings.setupTokenHash || !matchesTokenHash(token, settings.setupTokenHash)) {
    throw new AppError("invalid_setup_token", 403, "Setup token is not valid");
  }
}

/** Serialized by an advisory lock so concurrent requests can't both create an admin. */
export async function completeSetup(
  db: Database,
  input: SetupRequest,
): Promise<{ userId: string }> {
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);
    const [settings] = await tx.select().from(instanceSettings).where(eq(instanceSettings.id, 1));
    if (!settings || settings.setupCompletedAt) {
      throw new AppError("setup_completed", 409, "Setup is already complete");
    }
    if (!settings.setupTokenHash || !matchesTokenHash(input.token, settings.setupTokenHash)) {
      throw new AppError("invalid_setup_token", 403, "Setup token is not valid");
    }

    await tx
      .insert(groups)
      .values([
        { name: "Administrators", systemKey: "admins" },
        { name: "All Users", systemKey: "all_users" },
      ])
      .onConflictDoNothing();
    const [admins] = await tx.select().from(groups).where(eq(groups.systemKey, "admins"));
    if (!admins) throw new Error("admins group missing after seeding");

    const [user] = await tx
      .insert(users)
      .values({ email: input.adminEmail, name: input.adminName, passwordHash })
      .returning({ id: users.id });
    if (!user) throw new Error("admin user not created");
    await tx.insert(groupMembers).values({ groupId: admins.id, userId: user.id });

    await tx
      .update(instanceSettings)
      .set({ orgName: input.orgName, setupCompletedAt: new Date(), setupTokenHash: null })
      .where(eq(instanceSettings.id, 1));

    return { userId: user.id };
  });
}
