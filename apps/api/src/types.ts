import type { Database } from "@jangka/db";
import type { SessionUser } from "@jangka/shared/auth";
import type { RequestIdVariables } from "hono/request-id";

export type Auth = { user: SessionUser; sessionId: string };

export type AppConfig = {
  /** No trailing slash; its origin is the only allowed CSRF origin. */
  publicUrl: string;
  sessionTtlDays: number;
};

export type AppEnv = {
  Variables: RequestIdVariables & { auth: Auth | null };
};

export type RouteDeps = { db: Database; config: AppConfig };
