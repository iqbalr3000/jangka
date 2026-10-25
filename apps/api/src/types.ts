import type { Database } from "@jangka/db";
import type { ProviderFactory } from "@jangka/llm";
import type { SessionUser } from "@jangka/shared/auth";
import type { JobQueue } from "@jangka/worker/jobs";
import type { RequestIdVariables } from "hono/request-id";
import type { AuditState } from "./lib/audit";
import type { Logger } from "./logger";
import type { DiagramChecker } from "./services/diagrams";

/** `groupIds` are explicit memberships; the implicit All Users group is added by `loadAccess`. */
export type Auth = { user: SessionUser; sessionId: string; groupIds: string[] };

export type AppConfig = {
  /** No trailing slash; its origin is the only allowed CSRF origin. */
  publicUrl: string;
  sessionTtlDays: number;
  /** Encrypts stored secrets (LLM keys). */
  masterKey: Buffer;
  enableFakeLlm: boolean;
  /** FORCE_PASSWORD_LOGIN: password login works even when disabled in settings. */
  forcePasswordLogin: boolean;
  /** Un-audited successful mutations throw (tests) instead of logging a warning. */
  strictAudit?: boolean;
};

export type AppEnv = {
  Variables: RequestIdVariables & { auth: Auth | null; audit: AuditState };
};

export type RouteDeps = {
  db: Database;
  config: AppConfig;
  logger: Logger;
  /** Injectable so tests can point real adapters at a stub server. */
  llm: ProviderFactory;
  queue: JobQueue;
  diagrams: DiagramChecker;
};
