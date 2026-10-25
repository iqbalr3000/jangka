import { auditLogs, type Database } from "@jangka/db";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { type Logger, SECRET_KEYS } from "../logger";
import type { AppEnv } from "../types";
import { clientIp } from "./request-meta";

export type AuditEntry = {
  action: string;
  targetType: string;
  targetId: string | null;
  metadata?: Record<string, unknown>;
  /** Who acted when there's no session yet (login, setup, invite accept, SSO). */
  actorId?: string;
};

/** Per-request audit state, set by `auditMiddleware`. */
export type AuditState = {
  db: Database;
  logger: Logger;
  strict: boolean;
  written: boolean;
  exemptReason: string | null;
};

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SECRET_NAMES = new Set(SECRET_KEYS.map((key) => key.toLowerCase()));

/** Paths of secret-like keys anywhere in the metadata (`provider.apiKey`). */
function secretPaths(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => secretPaths(item, `${path}[${i}]`));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const here = path ? `${path}.${key}` : key;
    return SECRET_NAMES.has(key.toLowerCase()) ? [here] : secretPaths(child, here);
  });
}

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  return typeof value === "object" && value !== null
    ? withoutKeys(value as Record<string, unknown>)
    : value;
}

function withoutKeys(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !SECRET_NAMES.has(key.toLowerCase()))
      .map(([key, child]) => [key, scrub(child)]),
  );
}

/** Writes the audit row for this request (hard rule #8). Never put secrets in `metadata`. */
export async function audit(c: Context<AppEnv>, entry: AuditEntry): Promise<void> {
  const state = c.get("audit");
  let metadata = entry.metadata ?? {};
  const secrets = secretPaths(metadata);
  if (secrets.length > 0) {
    // Hard rule #3: a bug in the caller, so loud in tests; in production the keys are dropped.
    if (state.strict) throw new Error(`audit metadata contains secret keys: ${secrets.join(", ")}`);
    state.logger.warn({ action: entry.action, keys: secrets }, "secret keys dropped from audit");
    metadata = withoutKeys(metadata);
  }
  await state.db.insert(auditLogs).values({
    actorId: entry.actorId ?? c.get("auth")?.user.id ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    metadata,
    ip: clientIp(c),
    userAgent: c.req.header("user-agent") ?? null,
  });
  state.written = true;
}

/** For the rare mutating endpoint that changes nothing worth recording. */
export function auditExempt(c: Context<AppEnv>, reason: string): void {
  c.get("audit").exemptReason = reason;
}

/**
 * Provides `audit()` its state and checks afterwards that every successful mutating request
 * wrote an audit row (or was exempted): an error in tests (`strict`), a warning in production.
 */
export function auditMiddleware(db: Database, logger: Logger, strict: boolean) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const state: AuditState = { db, logger, strict, written: false, exemptReason: null };
    c.set("audit", state);
    await next();
    const ok = c.res.status >= 200 && c.res.status < 300;
    if (!MUTATING.has(c.req.method) || !ok || state.written || state.exemptReason) return;
    const message = `${c.req.method} ${c.req.routePath} succeeded without an audit() call`;
    if (strict) throw new Error(message);
    logger.warn({ method: c.req.method, path: c.req.routePath }, message);
  });
}
