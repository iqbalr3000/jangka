import path from "node:path";
import { serve } from "@hono/node-server";
import { createDb, runMigrations } from "@jangka/db";
import { type Env, EnvError, parseEnv } from "@jangka/shared/env";
import { createApp } from "./app";
import { createLogger } from "./logger";

function loadEnv(): Env {
  try {
    return parseEnv(process.env);
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL, pretty: env.NODE_ENV === "development" });

// Same relative layout from apps/api/src (dev) and apps/api/dist (bundle, Docker image).
const here = import.meta.dirname;
const migrationsFolder = path.resolve(here, "../../../packages/db/migrations");
const webDistDir = path.resolve(here, "../../web/dist");

const { pool } = createDb(env.DATABASE_URL);

try {
  await runMigrations(pool, migrationsFolder);
} catch (err) {
  logger.fatal({ err }, "migrations failed");
  await pool.end();
  process.exit(1);
}

const app = createApp({
  pool,
  logger,
  webDistDir: env.NODE_ENV === "production" ? webDistDir : undefined,
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port }, "jangka api listening");
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
