import { Hono } from "hono";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/session";
import { createSampleDocuments } from "../services/samples";
import type { AppEnv, RouteDeps } from "../types";

export function adminSampleRoutes({ db }: RouteDeps) {
  return new Hono<AppEnv>().post("/samples", async (c) => {
    const auth = requireAdmin(c);
    const samples = await createSampleDocuments(db, { userId: auth.user.id });
    await audit(c, {
      action: "samples.create",
      targetType: "collection",
      targetId: samples.collectionId,
      metadata: { documentIds: samples.documentIds },
    });
    return c.json({ collectionId: samples.collectionId }, 201);
  });
}
