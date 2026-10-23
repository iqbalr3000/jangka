import { readFileSync } from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Database } from "@jangka/db";
import { AppError, type ErrorCode, type ErrorResponse } from "@jangka/shared/errors";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type pg from "pg";
import { csrfOriginCheck } from "./lib/csrf";
import type { RateLimiter } from "./lib/rate-limit";
import { sessionMiddleware } from "./lib/session";
import { setupGate } from "./lib/setup-gate";
import type { Logger } from "./logger";
import { adminUserRoutes } from "./routes/admin-users";
import { authRoutes } from "./routes/auth";
import { healthRoutes } from "./routes/health";
import { inviteRoutes } from "./routes/invites";
import { setupRoutes } from "./routes/setup";
import type { SetupState } from "./services/setup";
import type { AppConfig, AppEnv } from "./types";

export type AppDeps = {
  db: Database;
  pool: pg.Pool;
  logger: Logger;
  config: AppConfig;
  setupState: SetupState;
  loginLimiter: RateLimiter;
  /** Built SPA directory; set in production only (dev uses the Vite server). */
  webDistDir?: string;
};

const codeByStatus: Record<number, ErrorCode> = {
  400: "validation_failed",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
};

function errorBody(code: string, message: string, details?: unknown): ErrorResponse {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export function createApp(deps: AppDeps) {
  const { db, pool, logger, config, setupState, loginLimiter, webDistDir } = deps;
  const app = new Hono<AppEnv>();

  app.use(requestId());
  app.use(async (c, next) => {
    const start = performance.now();
    await next();
    logger.info(
      {
        requestId: c.get("requestId"),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - start),
      },
      "request",
    );
  });

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        errorBody(err.code, err.message, err.details),
        err.status as ContentfulStatusCode,
      );
    }
    if (err instanceof HTTPException && err.status < 500) {
      return c.json(
        errorBody(codeByStatus[err.status] ?? "validation_failed", err.message),
        err.status,
      );
    }
    logger.error({ err, requestId: c.get("requestId") }, "unhandled error");
    return c.json(errorBody("internal", "Internal error"), 500);
  });

  app.notFound((c) => c.json(errorBody("not_found", "Not found"), 404));

  app.use("/api/*", csrfOriginCheck(config.publicUrl));
  app.use("/api/*", setupGate(setupState));
  app.use("/api/*", sessionMiddleware(db, config));

  const routeDeps = { db, config };
  app.route("/api/v1/health", healthRoutes(pool));
  app.route("/api/v1/setup", setupRoutes(routeDeps, setupState));
  app.route("/api/v1/auth", authRoutes(routeDeps, loginLimiter));
  app.route("/api/v1/invites", inviteRoutes(routeDeps));
  app.route("/api/v1/admin", adminUserRoutes(routeDeps));

  if (webDistDir) {
    const indexHtml = readFileSync(path.join(webDistDir, "index.html"), "utf8");
    app.use("*", async (c, next) => {
      if (c.req.path.startsWith("/api/")) return next();
      return serveStatic({ root: webDistDir })(c, next);
    });
    app.get("*", (c, next) => (c.req.path.startsWith("/api/") ? next() : c.html(indexHtml)));
  }

  return app;
}
