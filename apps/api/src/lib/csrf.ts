import { AppError } from "@jangka/shared/errors";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Mutating requests must come from the app's own origin (browsers always send Origin on them). */
export function csrfOriginCheck(publicUrl: string) {
  const allowed = new URL(publicUrl).origin;
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && c.req.header("origin") !== allowed) {
      throw new AppError("forbidden", 403, "Cross-origin request rejected");
    }
    await next();
  });
}
