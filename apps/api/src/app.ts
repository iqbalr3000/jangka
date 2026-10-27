import { readFileSync } from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Database } from "@jangka/db";
import { createProvider, type ProviderFactory } from "@jangka/llm";
import { AppError, type ErrorCode, type ErrorResponse } from "@jangka/shared/errors";
import type { JobQueue } from "@jangka/worker/jobs";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type pg from "pg";
import { auditMiddleware } from "./lib/audit";
import { csrfOriginCheck } from "./lib/csrf";
import { RateLimiter } from "./lib/rate-limit";
import { sessionMiddleware } from "./lib/session";
import { setupGate } from "./lib/setup-gate";
import type { Logger } from "./logger";
import { adminAuditRoutes } from "./routes/admin-audit";
import { adminAuthRoutes } from "./routes/admin-auth";
import { adminGroupRoutes } from "./routes/admin-groups";
import { adminLlmRoutes } from "./routes/admin-llm";
import { adminPermissionRoutes } from "./routes/admin-permissions";
import { adminTemplateRoutes } from "./routes/admin-templates";
import { adminUserRoutes } from "./routes/admin-users";
import { assistantRoutes } from "./routes/assistant";
import { authRoutes } from "./routes/auth";
import { collectionRoutes } from "./routes/collections";
import { commentRoutes } from "./routes/comments";
import { documentRoutes, templateRoutes } from "./routes/documents";
import { exportRoutes } from "./routes/exports";
import { healthRoutes } from "./routes/health";
import { inviteRoutes } from "./routes/invites";
import { llmRoutes } from "./routes/llm";
import { oidcRoutes } from "./routes/oidc";
import { searchRoutes } from "./routes/search";
import { setupRoutes } from "./routes/setup";
import { traceRoutes } from "./routes/trace";
import { GenerationLocks } from "./services/assistant";
import { type DiagramChecker, queuedDiagramChecker } from "./services/diagrams";
import type { SetupState } from "./services/setup";
import type { AppConfig, AppEnv } from "./types";

export type AppDeps = {
  db: Database;
  pool: pg.Pool;
  logger: Logger;
  config: AppConfig;
  setupState: SetupState;
  loginLimiter: RateLimiter;
  /** Per-user cap on LLM requests (chat, draft, revise, diagram fixes). */
  llmLimiter?: RateLimiter;
  /** Defaults to the real adapters. */
  llm?: ProviderFactory;
  queue: JobQueue;
  /** Defaults to rendering through the worker. */
  diagrams?: DiagramChecker;
  /** Built SPA directory; set in production only (dev uses the Vite server). */
  webDistDir?: string;
};

// Generous for interactive use; stops a script or a stuck client from burning the org's API key.
const LLM_REQUESTS_PER_WINDOW = 60;
const LLM_WINDOW_MS = 10 * 60_000;

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
  const llm = deps.llm ?? createProvider;
  const { queue } = deps;
  const llmLimiter = deps.llmLimiter ?? new RateLimiter(LLM_REQUESTS_PER_WINDOW, LLM_WINDOW_MS);
  const diagrams = deps.diagrams ?? queuedDiagramChecker(db, queue);
  const app = new Hono<AppEnv>();

  app.use(requestId());
  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // React style props and Mermaid's <style> inside rendered SVGs.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
      xFrameOptions: "DENY",
      referrerPolicy: "strict-origin-when-cross-origin",
      // The app runs over plain http on localhost too; HSTS belongs to the TLS proxy.
      strictTransportSecurity: false,
    }),
  );
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

  app.use("/api/*", auditMiddleware(db, logger, config.strictAudit ?? false));
  app.use("/api/*", csrfOriginCheck(config.publicUrl));
  app.use("/api/*", setupGate(setupState));
  app.use("/api/*", sessionMiddleware(db, config));

  const locks = new GenerationLocks();
  const routeDeps = { db, config, logger, llm, queue, diagrams, llmLimiter, locks };
  app.route("/api/v1/health", healthRoutes(pool));
  app.route("/api/v1/setup", setupRoutes(routeDeps, setupState));
  app.route("/api/v1/auth/oidc", oidcRoutes(routeDeps));
  app.route("/api/v1/auth", authRoutes(routeDeps, loginLimiter));
  app.route("/api/v1/invites", inviteRoutes(routeDeps));
  app.route("/api/v1/admin", adminUserRoutes(routeDeps));
  app.route("/api/v1/admin/groups", adminGroupRoutes(routeDeps));
  app.route("/api/v1/admin/permissions", adminPermissionRoutes(routeDeps));
  app.route("/api/v1/admin", adminLlmRoutes(routeDeps));
  app.route("/api/v1/admin", adminAuthRoutes(routeDeps));
  app.route("/api/v1/admin", adminAuditRoutes(routeDeps));
  app.route("/api/v1/admin", adminTemplateRoutes(routeDeps));
  app.route("/api/v1/llm", llmRoutes(routeDeps));
  app.route("/api/v1/collections", collectionRoutes(routeDeps));
  app.route("/api/v1/documents", documentRoutes(routeDeps));
  app.route("/api/v1/documents", assistantRoutes(routeDeps));
  app.route("/api/v1/documents", traceRoutes(routeDeps));
  app.route("/api/v1/templates", templateRoutes(routeDeps));
  app.route("/api/v1/search", searchRoutes(routeDeps));
  app.route("/api/v1", exportRoutes(routeDeps));
  app.route("/api/v1", commentRoutes(routeDeps));

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
