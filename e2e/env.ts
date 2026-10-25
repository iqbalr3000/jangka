import { randomBytes } from "node:crypto";
import path from "node:path";

export const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;
export const IDP_PORT = 3101;
export const IDP_ISSUER = `http://127.0.0.1:${IDP_PORT}`;
export const SERVER_LOG = path.resolve(import.meta.dirname, "test-results", "server.log");

/** A dedicated database next to the integration-test one, recreated for every run. */
export function e2eDatabaseUrl(): string {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Start it with `pnpm test:db:up` (see .env.example).",
    );
  }
  const url = new URL(base);
  url.pathname = "/jangka_e2e";
  return url.toString();
}

export function serverEnv(): Record<string, string> {
  return {
    DATABASE_URL: e2eDatabaseUrl(),
    MASTER_KEY: randomBytes(32).toString("base64"),
    PUBLIC_URL: BASE_URL,
    PORT: String(PORT),
    NODE_ENV: "production",
    LOG_LEVEL: "warn",
    ENABLE_FAKE_LLM: "true",
  };
}
