import { type Database, sessions, type Transaction, users } from "@jangka/db";
import { generateToken, hashToken } from "@jangka/shared/crypto";
import { AppError } from "@jangka/shared/errors";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { memberships } from "../services/access";
import type { AppConfig, AppEnv, Auth } from "../types";

export const SESSION_COOKIE = "jangka_session";
const DAY_MS = 24 * 60 * 60 * 1000;

function cookieOptions(config: AppConfig) {
  return {
    httpOnly: true,
    sameSite: "Lax" as const,
    path: "/",
    secure: config.publicUrl.startsWith("https://"),
  };
}

function setSessionCookie(c: Context, token: string, config: AppConfig): void {
  setCookie(c, SESSION_COOKIE, token, {
    ...cookieOptions(config),
    maxAge: config.sessionTtlDays * 24 * 60 * 60,
  });
}

export function clearSessionCookie(c: Context, config: AppConfig): void {
  deleteCookie(c, SESSION_COOKIE, cookieOptions(config));
}

/** Creates a session row and sets the cookie; the raw token only ever lives in the cookie. */
export async function startSession(
  c: Context,
  db: Database | Transaction,
  userId: string,
  config: AppConfig,
  meta: { ip: string; userAgent: string | null },
): Promise<void> {
  const token = generateToken();
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + config.sessionTtlDays * DAY_MS),
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  setSessionCookie(c, token, config);
}

/** Resolves `c.var.auth`; expired sessions are deleted, stale ones extended (rolling expiry). */
export function sessionMiddleware(db: Database, config: AppConfig) {
  return createMiddleware<AppEnv>(async (c, next) => {
    c.set("auth", null);
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      const [row] = await db
        .select({
          sessionId: sessions.id,
          expiresAt: sessions.expiresAt,
          touchedAt: sessions.updatedAt,
          user: { id: users.id, name: users.name, email: users.email, isActive: users.isActive },
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.tokenHash, hashToken(token)))
        .limit(1);

      const now = Date.now();
      if (row && (row.expiresAt.getTime() <= now || !row.user.isActive)) {
        await db.delete(sessions).where(eq(sessions.id, row.sessionId));
      } else if (row) {
        if (now - row.touchedAt.getTime() > DAY_MS) {
          await db
            .update(sessions)
            .set({
              expiresAt: new Date(now + config.sessionTtlDays * DAY_MS),
              updatedAt: new Date(now),
            })
            .where(eq(sessions.id, row.sessionId));
          setSessionCookie(c, token, config);
        }
        const { id, name, email } = row.user;
        const { groupIds, isAdmin } = await memberships(db, id);
        c.set("auth", { sessionId: row.sessionId, user: { id, name, email, isAdmin }, groupIds });
      }
    }
    await next();
  });
}

export function requireAuth(c: Context<AppEnv>): Auth {
  const auth = c.get("auth");
  if (!auth) throw new AppError("unauthorized", 401, "Sign in required");
  return auth;
}

export function requireAdmin(c: Context<AppEnv>): Auth {
  const auth = requireAuth(c);
  if (!auth.user.isAdmin) throw new AppError("forbidden", 403, "Admins only");
  return auth;
}
