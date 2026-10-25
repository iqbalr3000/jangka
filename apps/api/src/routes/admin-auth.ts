import { authProviders, groups, instanceSettings, userIdentities } from "@jangka/db";
import {
  type AuthProviderView,
  createAuthProviderRequest,
  GOOGLE_ISSUER,
  updateAuthProviderRequest,
  updateSettingsRequest,
} from "@jangka/shared/auth";
import { decryptSecret, encryptSecret } from "@jangka/shared/crypto";
import { AppError } from "@jangka/shared/errors";
import { asc, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/session";
import { zValidate } from "../lib/validate";
import {
  assertProviderCanBeDisabled,
  disablePasswordLoginBlocker,
  settingsView,
} from "../services/auth-settings";
import { assertIssuerAllowed, redirectUri, testDiscovery } from "../services/oidc";
import type { AppEnv, RouteDeps } from "../types";

const idParam = z.object({ id: z.uuid() });

type ProviderRow = typeof authProviders.$inferSelect;

export function adminAuthRoutes({ db, config }: RouteDeps) {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    requireAdmin(c);
    await next();
  });

  function view(row: ProviderRow, linkedUsers: number): AuthProviderView {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      issuer: row.issuer,
      clientId: row.clientId,
      secretLast4: row.secretLast4,
      allowedDomains: row.allowedDomains,
      autoProvision: row.autoProvision,
      enabled: row.enabled,
      linkedUsers,
    };
  }

  async function linkedCount(providerId: string): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(userIdentities)
      .where(eq(userIdentities.providerId, providerId));
    return row?.n ?? 0;
  }

  async function findProvider(id: string): Promise<ProviderRow> {
    const [row] = await db.select().from(authProviders).where(eq(authProviders.id, id));
    if (!row) throw new AppError("not_found", 404, "Provider not found");
    return row;
  }

  return app
    .get("/auth-providers", async (c) => {
      const rows = await db.select().from(authProviders).orderBy(asc(authProviders.createdAt));
      const counts = await db
        .select({ providerId: userIdentities.providerId, n: count() })
        .from(userIdentities)
        .groupBy(userIdentities.providerId);
      const byProvider = new Map(counts.map((r) => [r.providerId, r.n]));
      return c.json({
        items: rows.map((row) => view(row, byProvider.get(row.id) ?? 0)),
        redirectUri: redirectUri(config.publicUrl),
      });
    })
    .post("/auth-providers", zValidate("json", createAuthProviderRequest), async (c) => {
      const input = c.req.valid("json");
      const issuer = input.kind === "google" ? GOOGLE_ISSUER : input.issuer;
      assertIssuerAllowed(issuer);
      await testDiscovery({ issuer, clientId: input.clientId, clientSecret: input.clientSecret });
      const [row] = await db
        .insert(authProviders)
        .values({
          kind: input.kind,
          name: input.name,
          issuer,
          clientId: input.clientId,
          clientSecretEnc: encryptSecret(input.clientSecret, config.masterKey),
          secretLast4: input.clientSecret.slice(-4),
          allowedDomains: input.allowedDomains,
          autoProvision: input.autoProvision,
          enabled: input.enabled,
        })
        .returning();
      if (!row) throw new Error("provider not created");
      await audit(c, {
        action: "auth_provider.create",
        targetType: "auth_provider",
        targetId: row.id,
        metadata: { kind: row.kind },
      });
      return c.json(view(row, 0), 201);
    })
    .patch(
      "/auth-providers/:id",
      zValidate("param", idParam),
      zValidate("json", updateAuthProviderRequest),
      async (c) => {
        const { id } = c.req.valid("param");
        const input = c.req.valid("json");
        const row = await findProvider(id);
        const issuer = row.kind === "google" ? GOOGLE_ISSUER : (input.issuer ?? row.issuer);
        if (input.enabled === false && row.enabled) await assertProviderCanBeDisabled(db, id);

        // A new endpoint or credential must work before it replaces the current one.
        if (input.issuer !== undefined || input.clientId !== undefined || input.clientSecret) {
          assertIssuerAllowed(issuer);
          await testDiscovery({
            issuer,
            clientId: input.clientId ?? row.clientId,
            clientSecret:
              input.clientSecret ?? decryptSecret(row.clientSecretEnc, config.masterKey),
          });
        }
        const [updated] = await db
          .update(authProviders)
          .set({
            name: input.name,
            issuer,
            clientId: input.clientId,
            allowedDomains: input.allowedDomains,
            autoProvision: input.autoProvision,
            enabled: input.enabled,
            ...(input.clientSecret
              ? {
                  clientSecretEnc: encryptSecret(input.clientSecret, config.masterKey),
                  secretLast4: input.clientSecret.slice(-4),
                }
              : {}),
          })
          .where(eq(authProviders.id, id))
          .returning();
        if (!updated) throw new AppError("not_found", 404, "Provider not found");
        await audit(c, {
          action: "auth_provider.update",
          targetType: "auth_provider",
          targetId: id,
          metadata: { fields: Object.keys(input).filter((k) => k !== "clientSecret") },
        });
        return c.json(view(updated, await linkedCount(id)));
      },
    )
    .delete("/auth-providers/:id", zValidate("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const row = await findProvider(id);
      if (row.enabled) await assertProviderCanBeDisabled(db, id);
      await db.delete(authProviders).where(eq(authProviders.id, id));
      await audit(c, { action: "auth_provider.delete", targetType: "auth_provider", targetId: id });
      return c.body(null, 204);
    })
    .post("/auth-providers/:id/test", zValidate("param", idParam), async (c) => {
      const row = await findProvider(c.req.valid("param").id);
      await testDiscovery({
        issuer: row.issuer,
        clientId: row.clientId,
        clientSecret: decryptSecret(row.clientSecretEnc, config.masterKey),
      });
      return c.json({ ok: true });
    })
    .get("/settings", async (c) => c.json(await settingsView(db, config)))
    .put("/settings", zValidate("json", updateSettingsRequest), async (c) => {
      const input = c.req.valid("json");
      if (input.passwordLoginEnabled === false) {
        const blocker = await disablePasswordLoginBlocker(db);
        if (blocker) throw new AppError("lockout_risk", 409, blocker);
      }
      if (input.defaultGroupId) {
        // System groups are off limits: auto-provisioned users must never become admins.
        const [group] = await db.select().from(groups).where(eq(groups.id, input.defaultGroupId));
        if (!group || group.systemKey !== null) {
          throw new AppError("validation_failed", 400, "Pick a group you created", [
            { path: ["defaultGroupId"], message: "Pick a group you created" },
          ]);
        }
      }
      await db.update(instanceSettings).set({
        passwordLoginEnabled: input.passwordLoginEnabled,
        defaultGroupId: input.defaultGroupId,
      });
      await audit(c, {
        action: "settings.update",
        targetType: "instance_settings",
        targetId: null,
        metadata: { fields: Object.keys(input) },
      });
      return c.json(await settingsView(db, config));
    });
}
