import { authProviders } from "@jangka/db";
import type { AuthOptions, SsoError } from "@jangka/shared/auth";
import { asc, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { audit } from "../lib/audit";
import { requestMeta } from "../lib/request-meta";
import { startSession } from "../lib/session";
import { zValidate } from "../lib/validate";
import { passwordLoginAllowed } from "../services/auth-settings";
import { finishFlow, readFlow, startFlow } from "../services/oidc";
import { resolveSsoLogin } from "../services/sso";
import type { AppEnv, RouteDeps } from "../types";

const FLOW_COOKIE = "jangka_oidc";
const COOKIE_PATH = "/api/v1/auth/oidc";
const idParam = z.object({ id: z.uuid() });
const startQuery = z.object({ redirect: z.string().max(2000).optional() });

export function oidcRoutes({ db, config, logger }: RouteDeps) {
  const cookieOptions = {
    httpOnly: true,
    sameSite: "Lax" as const,
    path: COOKIE_PATH,
    secure: config.publicUrl.startsWith("https://"),
  };

  async function enabledProvider(id: string) {
    const [row] = await db.select().from(authProviders).where(eq(authProviders.id, id));
    return row?.enabled ? row : null;
  }

  function fail(c: Context<AppEnv>, error: SsoError, email?: string | null) {
    deleteCookie(c, FLOW_COOKIE, cookieOptions);
    const query = new URLSearchParams({ sso_error: error });
    if (email) query.set("email", email);
    return c.redirect(`/login?${query}`, 302);
  }

  return new Hono<AppEnv>()
    .get("/providers", async (c) => {
      const rows = await db
        .select({ id: authProviders.id, name: authProviders.name, kind: authProviders.kind })
        .from(authProviders)
        .where(eq(authProviders.enabled, true))
        .orderBy(asc(authProviders.createdAt));
      const options: AuthOptions = {
        passwordLoginEnabled: await passwordLoginAllowed(db, config),
        providers: rows,
      };
      return c.json(options);
    })
    .get("/:id/start", zValidate("param", idParam), zValidate("query", startQuery), async (c) => {
      const provider = await enabledProvider(c.req.valid("param").id);
      if (!provider) return fail(c, "provider_error");
      try {
        const { url, cookie } = await startFlow(provider, {
          publicUrl: config.publicUrl,
          masterKey: config.masterKey,
          redirect: c.req.valid("query").redirect,
        });
        setCookie(c, FLOW_COOKIE, cookie, { ...cookieOptions, maxAge: 10 * 60 });
        return c.redirect(url, 302);
      } catch (err) {
        logger.warn({ err, providerId: provider.id }, "oidc discovery failed");
        return fail(c, "provider_error");
      }
    })
    .get("/callback", async (c) => {
      const flow = readFlow(getCookie(c, FLOW_COOKIE), config.masterKey);
      if (!flow) return fail(c, "invalid_state");
      const provider = await enabledProvider(flow.providerId);
      if (!provider) return fail(c, "provider_error");

      // Rebuilt from PUBLIC_URL: behind a proxy the request URL isn't the registered redirect URI.
      const incoming = new URL(c.req.url);
      const callbackUrl = new URL(`${config.publicUrl}${incoming.pathname}${incoming.search}`);
      let claims: Awaited<ReturnType<typeof finishFlow>>;
      try {
        claims = await finishFlow(provider, flow, callbackUrl, config.masterKey);
      } catch (err) {
        // State/nonce/PKCE/signature checks, an IdP error response, or a cancelled sign-in.
        logger.warn({ err, providerId: provider.id }, "oidc callback rejected");
        return fail(c, "invalid_state");
      }

      const result = await resolveSsoLogin(db, provider, claims);
      if (result.kind === "denied") {
        logger.info({ providerId: provider.id, reason: result.reason }, "sso login denied");
        await audit(c, {
          action: "auth.sso_denied",
          targetType: "auth_provider",
          targetId: provider.id,
          metadata: { reason: result.reason, email: result.email },
        });
        return fail(c, result.reason, result.reason === "domain_not_allowed" ? result.email : null);
      }
      deleteCookie(c, FLOW_COOKIE, cookieOptions);
      await startSession(c, db, result.userId, config, requestMeta(c));
      await audit(c, {
        action: result.via === "subject" ? "auth.sso_login" : `auth.sso_${result.via}`,
        targetType: "user",
        targetId: result.userId,
        actorId: result.userId,
        metadata: { providerId: provider.id },
      });
      return c.redirect(flow.redirect, 302);
    });
}
