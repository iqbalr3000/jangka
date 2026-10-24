import { type Database, invites, sessions, type Transaction, users } from "@jangka/db";
import type { InviteKind } from "@jangka/shared/auth";
import { generateToken, hashPassword, hashToken } from "@jangka/shared/crypto";
import { AppError } from "@jangka/shared/errors";
import { and, eq, gt, isNull } from "drizzle-orm";
import { createPersonalCollection } from "./access";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
type Db = Database | Transaction;

const inviteInvalid = () =>
  new AppError("invite_invalid", 410, "This link is invalid or has expired");

/** Returns the link once; only its hash is stored. */
export async function createLink(
  db: Db,
  input: { kind: InviteKind; email: string; userId: string | null; createdBy: string },
  publicUrl: string,
): Promise<{ url: string; expiresAt: string }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await db.insert(invites).values({ ...input, tokenHash: hashToken(token), expiresAt });
  return { url: `${publicUrl}/invite/${token}`, expiresAt: expiresAt.toISOString() };
}

/** Usable = unused, unexpired, and (for resets) the user is still active. */
export async function findUsableInvite(db: Db, token: string, options: { lock?: boolean } = {}) {
  const query = db
    .select({ invite: invites, userName: users.name, userActive: users.isActive })
    .from(invites)
    .leftJoin(users, eq(users.id, invites.userId))
    .where(
      and(
        eq(invites.tokenHash, hashToken(token)),
        isNull(invites.usedAt),
        gt(invites.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const [row] = options.lock ? await query.for("update", { of: invites }) : await query;
  if (!row || (row.invite.kind === "password_reset" && !row.userActive)) throw inviteInvalid();
  return row;
}

/** Consumes the link and returns the user to sign in. */
export async function acceptInvite(
  db: Database,
  token: string,
  input: { name?: string; password: string },
): Promise<{ userId: string }> {
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const { invite } = await findUsableInvite(tx, token, { lock: true });
    let userId: string;

    if (invite.kind === "invite") {
      if (!input.name) {
        throw new AppError("validation_failed", 400, "Invalid request", [
          { path: ["name"], message: "Required" },
        ]);
      }
      const [user] = await tx
        .insert(users)
        .values({ email: invite.email, name: input.name, passwordHash })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id });
      if (!user) throw new AppError("conflict", 409, "An account with this email already exists");
      userId = user.id;
      await createPersonalCollection(tx, { id: userId, name: input.name });
    } else {
      if (!invite.userId) throw inviteInvalid();
      userId = invite.userId;
      await tx.update(users).set({ passwordHash }).where(eq(users.id, userId));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    }

    await tx.update(invites).set({ usedAt: new Date() }).where(eq(invites.id, invite.id));
    return { userId };
  });
}
