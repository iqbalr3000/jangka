import { AppError } from "@jangka/shared/errors";
import { createMiddleware } from "hono/factory";
import type { SetupState } from "../services/setup";
import type { AppEnv } from "../types";

const OPEN_PREFIXES = ["/api/v1/health", "/api/v1/setup"];

function isOpen(path: string): boolean {
  return OPEN_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function setupGate(setupState: SetupState) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!isOpen(c.req.path) && !(await setupState.isCompleted())) {
      throw new AppError("setup_required", 409, "Jangka is not set up yet");
    }
    await next();
  });
}
