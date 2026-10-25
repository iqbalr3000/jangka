import {
  auditLogs,
  authProviders,
  collections,
  documents,
  groups,
  llmProviders,
  users,
} from "@jangka/db";
import { type AuditLogEntry, auditLogQuery } from "@jangka/shared/audit";
import { and, desc, eq, gte, inArray, like, lt, or, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { requireAdmin } from "../lib/session";
import { zValidate } from "../lib/validate";
import type { AppEnv, RouteDeps } from "../types";

type Target = { label: string; href: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

export function adminAuditRoutes({ db }: RouteDeps) {
  /** Labels for one page of targets: one query per target type present. */
  async function resolveTargets(rows: { targetType: string; targetId: string | null }[]) {
    const ids = (type: string) => [
      ...new Set(
        rows.flatMap((r) =>
          r.targetType === type && r.targetId && UUID.test(r.targetId) ? [r.targetId] : [],
        ),
      ),
    ];
    const lookups: Record<string, (list: string[]) => Promise<[string, Target][]>> = {
      document: async (list) =>
        (
          await db
            .select({ id: documents.id, label: documents.title })
            .from(documents)
            .where(inArray(documents.id, list))
        ).map((r) => [r.id, { label: r.label, href: `/d/${r.id}` }]),
      collection: async (list) =>
        (
          await db
            .select({ id: collections.id, label: collections.name })
            .from(collections)
            .where(inArray(collections.id, list))
        ).map((r) => [r.id, { label: r.label, href: `/c/${r.id}` }]),
      user: async (list) =>
        (
          await db
            .select({ id: users.id, label: users.name })
            .from(users)
            .where(inArray(users.id, list))
        ).map((r) => [r.id, { label: r.label, href: "/admin/users" }]),
      group: async (list) =>
        (
          await db
            .select({ id: groups.id, label: groups.name })
            .from(groups)
            .where(inArray(groups.id, list))
        ).map((r) => [r.id, { label: r.label, href: `/admin/groups/${r.id}` }]),
      auth_provider: async (list) =>
        (
          await db
            .select({ id: authProviders.id, label: authProviders.name })
            .from(authProviders)
            .where(inArray(authProviders.id, list))
        ).map((r) => [r.id, { label: r.label, href: "/admin/auth" }]),
      llm_provider: async (list) =>
        (
          await db
            .select({ id: llmProviders.id, label: llmProviders.label })
            .from(llmProviders)
            .where(inArray(llmProviders.id, list))
        ).map((r) => [r.id, { label: r.label, href: "/admin/llm" }]),
    };
    const targets = new Map<string, Target>();
    for (const [type, lookup] of Object.entries(lookups)) {
      const list = ids(type);
      if (list.length === 0) continue;
      for (const [id, target] of await lookup(list)) targets.set(`${type}:${id}`, target);
    }
    return targets;
  }

  return new Hono<AppEnv>().get("/audit-logs", zValidate("query", auditLogQuery), async (c) => {
    requireAdmin(c);
    const { cursor, limit, action, actorId, from, to } = c.req.valid("query");
    const filters: (SQL | undefined)[] = [
      // UUIDv7 ids are time-ordered: id order is newest-first order.
      cursor ? lt(auditLogs.id, cursor) : undefined,
      action
        ? or(
            eq(auditLogs.action, action),
            like(auditLogs.action, `${action.replaceAll("_", "\\_")}.%`),
          )
        : undefined,
      actorId ? eq(auditLogs.actorId, actorId) : undefined,
      from ? gte(auditLogs.createdAt, new Date(`${from}T00:00:00Z`)) : undefined,
      to
        ? lt(auditLogs.createdAt, new Date(new Date(`${to}T00:00:00Z`).getTime() + DAY_MS))
        : undefined,
    ];
    const rows = await db
      .select({ log: auditLogs, actorName: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(and(...filters))
      .orderBy(desc(auditLogs.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const targets = await resolveTargets(page.map((r) => r.log));
    const items: AuditLogEntry[] = page.map(({ log, actorName }) => ({
      id: log.id,
      action: log.action,
      actor: log.actorId && actorName ? { id: log.actorId, name: actorName } : null,
      targetType: log.targetType,
      targetId: log.targetId,
      target: targets.get(`${log.targetType}:${log.targetId}`) ?? null,
      metadata:
        typeof log.metadata === "object" && log.metadata !== null && !Array.isArray(log.metadata)
          ? Object.fromEntries(Object.entries(log.metadata))
          : {},
      ip: log.ip,
      createdAt: log.createdAt.toISOString(),
    }));
    return c.json({
      items,
      nextCursor: rows.length > limit ? (page.at(-1)?.log.id ?? null) : null,
    });
  });
}
