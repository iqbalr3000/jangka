import { llmProviders } from "@jangka/db";
import { encryptSecret } from "@jangka/shared/crypto";
import { AppError } from "@jangka/shared/errors";
import {
  createProviderRequest,
  type LLMSettings,
  llmSettings,
  testProviderRequest,
  updateProviderRequest,
} from "@jangka/shared/llm";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/session";
import { zValidate } from "../lib/validate";
import {
  assertProviderInput,
  callProvider,
  defaultProvider,
  type ProviderRow,
  providerView,
  setDefault,
  storedConfig,
  testProvider,
} from "../services/llm-providers";
import type { AppEnv, RouteDeps } from "../types";

const idParam = z.object({ id: z.uuid() });

function last4(apiKey: string): string | null {
  return apiKey === "" ? null : apiKey.slice(-4);
}

export function adminLlmRoutes({ db, config, llm, logger }: RouteDeps) {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    requireAdmin(c);
    await next();
  });

  async function findProvider(id: string): Promise<ProviderRow> {
    const [row] = await db.select().from(llmProviders).where(eq(llmProviders.id, id));
    if (!row) throw new AppError("not_found", 404, "Provider not found");
    return row;
  }

  return app
    .get("/llm-providers", async (c) => {
      const rows = await db.select().from(llmProviders).orderBy(asc(llmProviders.createdAt));
      const { providerId } = await defaultProvider(db);
      return c.json({
        items: rows.map((row) => providerView(row, providerId)),
        fakeEnabled: config.enableFakeLlm,
      });
    })
    .post("/llm-providers/test", zValidate("json", testProviderRequest), async (c) => {
      const input = c.req.valid("json");
      assertProviderInput(input, config.enableFakeLlm);
      const result = await testProvider(llm, logger, input);
      await audit(c, {
        action: "llm_provider.test",
        targetType: "llm_provider",
        targetId: null,
        metadata: { kind: input.kind },
      });
      return c.json(result);
    })
    .post("/llm-providers", zValidate("json", createProviderRequest), async (c) => {
      const input = c.req.valid("json");
      assertProviderInput(input, config.enableFakeLlm);
      const { models } = await testProvider(llm, logger, input);
      if (input.defaultModel && !models.some((m) => m.id === input.defaultModel)) {
        throw new AppError("validation_failed", 400, "That model isn't offered by this provider", [
          { path: ["defaultModel"], message: "Pick a model from the list" },
        ]);
      }

      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(llmProviders)
          .values({
            kind: input.kind,
            label: input.label,
            apiKeyEnc: input.apiKey === "" ? null : encryptSecret(input.apiKey, config.masterKey),
            keyLast4: last4(input.apiKey),
            baseUrl: input.baseUrl ?? null,
            lastTestedAt: new Date(),
          })
          .returning();
        if (!created) throw new Error("provider not created");
        if (input.defaultModel) await setDefault(tx, created.id, input.defaultModel);
        return created;
      });

      await audit(c, {
        action: "llm_provider.create",
        targetType: "llm_provider",
        targetId: row.id,
        metadata: { kind: row.kind },
      });
      const { providerId } = await defaultProvider(db);
      return c.json(providerView(row, providerId), 201);
    })
    .patch(
      "/llm-providers/:id",
      zValidate("param", idParam),
      zValidate("json", updateProviderRequest),
      async (c) => {
        const { id } = c.req.valid("param");
        const input = c.req.valid("json");
        const row = await findProvider(id);
        const changes: Partial<typeof llmProviders.$inferInsert> = {};
        if (input.label !== undefined) changes.label = input.label;
        if (input.enabled !== undefined) changes.enabled = input.enabled;

        // A new key or endpoint must pass a test before it replaces the working one.
        if (input.apiKey !== undefined || input.baseUrl !== undefined) {
          const current = storedConfig(row, config.masterKey);
          const next = {
            kind: row.kind,
            apiKey: input.apiKey ?? current.apiKey,
            baseUrl: input.baseUrl === undefined ? row.baseUrl : input.baseUrl,
          };
          assertProviderInput(next, config.enableFakeLlm);
          await testProvider(llm, logger, next);
          if (input.apiKey !== undefined) {
            changes.apiKeyEnc = encryptSecret(input.apiKey, config.masterKey);
            changes.keyLast4 = last4(input.apiKey);
          }
          changes.baseUrl = next.baseUrl;
          changes.lastTestedAt = new Date();
          changes.lastTestError = null;
        }

        const updated = await db.transaction(async (tx) => {
          const [saved] = await tx
            .update(llmProviders)
            .set(changes)
            .where(eq(llmProviders.id, id))
            .returning();
          if (!saved) throw new AppError("not_found", 404, "Provider not found");
          const { providerId } = await defaultProvider(tx);
          if (!saved.enabled && providerId === id) await setDefault(tx, null, null);
          return saved;
        });

        await audit(c, {
          action: "llm_provider.update",
          targetType: "llm_provider",
          targetId: id,
          metadata: { fields: Object.keys(input) },
        });
        const { providerId } = await defaultProvider(db);
        return c.json(providerView(updated, providerId));
      },
    )
    .delete("/llm-providers/:id", zValidate("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      await findProvider(id);
      await db.transaction(async (tx) => {
        const { providerId } = await defaultProvider(tx);
        if (providerId === id) await setDefault(tx, null, null);
        await tx.delete(llmProviders).where(eq(llmProviders.id, id));
      });
      await audit(c, { action: "llm_provider.delete", targetType: "llm_provider", targetId: id });
      return c.body(null, 204);
    })
    .post("/llm-providers/:id/test", zValidate("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const row = await findProvider(id);
      try {
        const result = await testProvider(llm, logger, storedConfig(row, config.masterKey));
        await db
          .update(llmProviders)
          .set({ lastTestedAt: new Date(), lastTestError: null })
          .where(eq(llmProviders.id, id));
        await audit(c, { action: "llm_provider.test", targetType: "llm_provider", targetId: id });
        return c.json(result);
      } catch (error) {
        if (error instanceof AppError && error.code === "llm_error") {
          const details = z.object({ reason: z.string() }).safeParse(error.details);
          await db
            .update(llmProviders)
            .set({
              lastTestedAt: new Date(),
              lastTestError: details.success ? details.data.reason : "provider_down",
            })
            .where(eq(llmProviders.id, id));
        }
        throw error;
      }
    })
    .get("/llm-providers/:id/models", zValidate("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const row = await findProvider(id);
      const provider = llm(storedConfig(row, config.masterKey));
      const models = await callProvider(logger, row.kind, () => provider.listModels());
      return c.json({ models });
    })
    .get("/settings/llm", async (c) => {
      const settings: LLMSettings = await defaultProvider(db).then(({ providerId, model }) =>
        providerId && model ? { providerId, model } : { providerId: null, model: null },
      );
      return c.json(settings);
    })
    .put("/settings/llm", zValidate("json", llmSettings), async (c) => {
      const input = c.req.valid("json");
      if (input.providerId !== null) {
        const row = await findProvider(input.providerId);
        if (!row.enabled) {
          throw new AppError(
            "validation_failed",
            400,
            "Enable the provider before making it the default",
          );
        }
      }
      await setDefault(db, input.providerId, input.model);
      await audit(c, {
        action: "settings.llm_default",
        targetType: "settings",
        targetId: null,
        metadata: { ...input },
      });
      return c.json(input);
    });
}
