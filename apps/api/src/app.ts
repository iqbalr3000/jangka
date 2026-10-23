import { readFileSync } from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { AppError, type ErrorCode, type ErrorResponse } from "@jangka/shared/errors";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type pg from "pg";
import type { Logger } from "./logger";
import { healthRoutes } from "./routes/health";

export type AppDeps = {
  pool: pg.Pool;
  logger: Logger;
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

export function createApp({ pool, logger, webDistDir }: AppDeps) {
  const app = new Hono();

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

  app.route("/api/v1/health", healthRoutes(pool));

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
