import { setupRequest, verifySetupTokenRequest } from "@jangka/shared/auth";
import { Hono } from "hono";
import { audit, auditExempt } from "../lib/audit";
import { requestMeta } from "../lib/request-meta";
import { startSession } from "../lib/session";
import { zValidate } from "../lib/validate";
import { completeSetup, type SetupState, verifySetupToken } from "../services/setup";
import { meFor } from "../services/users";
import type { AppEnv, RouteDeps } from "../types";

export function setupRoutes({ db, config }: RouteDeps, setupState: SetupState) {
  return new Hono<AppEnv>()
    .get("/status", async (c) => c.json({ completed: await setupState.isCompleted() }))
    .post("/verify-token", zValidate("json", verifySetupTokenRequest), async (c) => {
      await verifySetupToken(db, c.req.valid("json").token);
      auditExempt(c, "read-only token check before setup");
      return c.body(null, 204);
    })
    .post("/", zValidate("json", setupRequest), async (c) => {
      const input = c.req.valid("json");
      const { userId } = await completeSetup(db, input);
      setupState.markCompleted();
      await startSession(c, db, userId, config, requestMeta(c));
      await audit(c, {
        action: "instance.setup",
        targetType: "user",
        targetId: userId,
        actorId: userId,
      });
      const user = { id: userId, name: input.adminName, email: input.adminEmail, isAdmin: true };
      return c.json(await meFor(db, user, config.publicUrl), 201);
    });
}
