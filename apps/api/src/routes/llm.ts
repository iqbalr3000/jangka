import { llmProviders } from "@jangka/db";
import type { llmStatus } from "@jangka/shared/llm";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { z } from "zod";
import { requireAuth } from "../lib/session";
import { defaultProvider } from "../services/llm-providers";
import type { AppEnv, RouteDeps } from "../types";

export function llmRoutes({ db }: RouteDeps) {
  return new Hono<AppEnv>().get("/status", async (c) => {
    requireAuth(c);
    const { providerId, model } = await defaultProvider(db);
    let configured = false;
    if (providerId && model) {
      const [row] = await db
        .select({ enabled: llmProviders.enabled })
        .from(llmProviders)
        .where(eq(llmProviders.id, providerId));
      configured = row?.enabled ?? false;
    }
    const status: z.infer<typeof llmStatus> = { configured };
    return c.json(status);
  });
}
