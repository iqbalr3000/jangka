import type { Database } from "@jangka/db";
import type { ProviderFactory } from "@jangka/llm";
import type { SessionUser } from "@jangka/shared/auth";
import type { JobQueue } from "@jangka/worker/jobs";
import type { RequestIdVariables } from "hono/request-id";
import type { AuditState } from "./lib/audit";
import type { RateLimiter } from "./lib/rate-limit";
import type { Logger } from "./logger";
import type { GenerationLocks } from "./services/assistant";
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
  /** TRUST_PROXY: read the client IP from the proxy's X-Forwarded-For entry. */
  trustProxy?: boolean;
  /** Un-audited successful mutations throw (tests) instead of logging a warning. */
  strictAudit?: boolean;
};

export type AppEnv = {
  Variables: RequestIdVariables & { auth: Auth | null; audit: AuditState; clientIp: string };
};

export type RouteDeps = {
  db: Database;
  config: AppConfig;
  logger: Logger;
  /** Injectable so tests can point real adapters at a stub server. */
  llm: ProviderFactory;
  queue: JobQueue;
  diagrams: DiagramChecker;
  llmLimiter: RateLimiter;
  /** One assistant generation or template upgrade per document at a time. */
  locks: GenerationLocks;
  /** `pg_trgm` is installed: titles match despite typos. */
  searchFuzzy: boolean;
};
