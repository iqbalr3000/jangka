import { sessions, users } from "@jangka/db";
import { loginRequest } from "@jangka/shared/auth";
import { hashPassword, verifyPassword } from "@jangka/shared/crypto";
import { AppError } from "@jangka/shared/errors";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { audit } from "../lib/audit";
import type { RateLimiter } from "../lib/rate-limit";
import { clientIp, requestMeta } from "../lib/request-meta";
import { clearSessionCookie, requireAuth, startSession } from "../lib/session";
import { zValidate } from "../lib/validate";
import { passwordLoginAllowed } from "../services/auth-settings";
import { isAdmin, meFor } from "../services/users";
import type { AppEnv, RouteDeps } from "../types";

const invalidCredentials = () =>
  new AppError("invalid_credentials", 401, "Email or password is incorrect");

// Verifying against a real hash for unknown emails keeps response time from revealing which emails exist.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("jangka-dummy-password");
  return dummyHash;
}

export function authRoutes({ db, config }: RouteDeps, loginLimiter: RateLimiter) {
  return new Hono<AppEnv>()
    .post("/login", zValidate("json", loginRequest), async (c) => {
      const { email, password } = c.req.valid("json");
      if (!(await passwordLoginAllowed(db, config))) {
        throw new AppError(
          "password_login_disabled",
          403,
          "Password sign-in is turned off. Use SSO.",
        );
      }
      const limitKey = `${clientIp(c)}|${email}`;
      if (loginLimiter.isLimited(limitKey)) {
        throw new AppError("rate_limited", 429, "Too many attempts. Try again in 15 minutes.");
      }

      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const valid = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
      if (!user?.passwordHash || !user.isActive || !valid) {
        loginLimiter.record(limitKey);
        await audit(c, {
          action: "auth.login_failed",
          targetType: "user",
          targetId: user?.id ?? null,
          metadata: { email },
        });
        throw invalidCredentials();
      }

      loginLimiter.reset(limitKey);
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await startSession(c, db, user.id, config, requestMeta(c));
      await audit(c, {
        action: "auth.login",
        targetType: "user",
        targetId: user.id,
        actorId: user.id,
      });
      const sessionUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        isAdmin: await isAdmin(db, user.id),
      };
      return c.json(await meFor(db, sessionUser, config.publicUrl));
    })
    .post("/logout", async (c) => {
      const auth = requireAuth(c);
      await db.delete(sessions).where(eq(sessions.id, auth.sessionId));
      clearSessionCookie(c, config);
      await audit(c, { action: "auth.logout", targetType: "user", targetId: auth.user.id });
      return c.body(null, 204);
    })
    .get("/me", async (c) => c.json(await meFor(db, requireAuth(c).user, config.publicUrl)));
}
