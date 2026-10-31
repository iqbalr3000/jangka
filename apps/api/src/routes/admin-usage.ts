import { documents, llmUsage, users } from "@jangka/db";
import { personalOwnerOf } from "@jangka/permissions";
import { providerKind, type UsagePeriod, type UsageReport, usageQuery } from "@jangka/shared/llm";
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { requireAdmin } from "../lib/session";
import { zValidate } from "../lib/validate";
import { loadAccess, resolveDocLevel } from "../services/access";
import type { AppEnv, RouteDeps } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** `[from, to)` in UTC; rolling periods end now, calendar months at their boundary. */
export function periodRange(period: UsagePeriod, now: Date): { from: Date; to: Date } {
  const monthStart = (offset: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  switch (period) {
    case "7d":
      return { from: new Date(now.getTime() - 7 * DAY_MS), to: now };
    case "30d":
      return { from: new Date(now.getTime() - 30 * DAY_MS), to: now };
    case "month":
      return { from: monthStart(0), to: now };
    case "last_month":
      return { from: monthStart(-1), to: monthStart(0) };
  }
}

const utcDay = (date: Date) => date.toISOString().slice(0, 10);

export function adminUsageRoutes({ db }: RouteDeps) {
  return new Hono<AppEnv>().get("/usage", zValidate("query", usageQuery), async (c) => {
    const auth = requireAdmin(c);
    const { from, to } = periodRange(c.req.valid("query").period, new Date());
    const inPeriod = and(gte(llmUsage.createdAt, from), lt(llmUsage.createdAt, to));
    // bigint sums come back as strings: map them to numbers.
    const sums = {
      requests: sql`count(*)`.mapWith(Number),
      inputTokens: sql`coalesce(sum(${llmUsage.inputTokens}), 0)`.mapWith(Number),
      outputTokens: sql`coalesce(sum(${llmUsage.outputTokens}), 0)`.mapWith(Number),
    };
    const byTotal = desc(sql`sum(${llmUsage.inputTokens} + ${llmUsage.outputTokens})`);

    const [totals] = await db.select(sums).from(llmUsage).where(inPeriod);

    const day = sql`to_char(${llmUsage.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
    const dayRows = await db
      .select({ date: day.mapWith(String), ...sums })
      .from(llmUsage)
      .where(inPeriod)
      .groupBy(day);
    const perDay = new Map(dayRows.map((r) => [r.date, r]));
    const daily: UsageReport["daily"] = [];
    for (let t = Date.parse(utcDay(from)); t < to.getTime(); t += DAY_MS) {
      const date = utcDay(new Date(t));
      const row = perDay.get(date);
      daily.push({
        date,
        inputTokens: row?.inputTokens ?? 0,
        outputTokens: row?.outputTokens ?? 0,
      });
    }

    const byModel = await db
      .select({ providerKind: llmUsage.providerKind, model: llmUsage.model, ...sums })
      .from(llmUsage)
      .where(inPeriod)
      .groupBy(llmUsage.providerKind, llmUsage.model)
      .orderBy(byTotal);

    const userRows = await db
      .select({ userId: llmUsage.userId, name: users.name, ...sums })
      .from(llmUsage)
      .leftJoin(users, eq(users.id, llmUsage.userId))
      .where(inPeriod)
      .groupBy(llmUsage.userId, users.name)
      .orderBy(byTotal);

    const byOperation = await db
      .select({ operation: llmUsage.operation, ...sums })
      .from(llmUsage)
      .where(inPeriod)
      .groupBy(llmUsage.operation)
      .orderBy(byTotal);

    const documentRows = await db
      .select({ documentId: llmUsage.documentId, ...sums })
      .from(llmUsage)
      .where(and(inPeriod, isNotNull(llmUsage.documentId)))
      .groupBy(llmUsage.documentId)
      .orderBy(byTotal)
      .limit(10);
    const ids = documentRows.flatMap((r) => (r.documentId ? [r.documentId] : []));
    const docs = ids.length
      ? await db.select().from(documents).where(inArray(documents.id, ids))
      : [];
    // Admins see usage everywhere, but not the titles of other users' personal documents:
    // those are reachable by URL only, never listed (spec-access).
    const access = await loadAccess(db, {
      userId: auth.user.id,
      isAdmin: auth.user.isAdmin,
      groupIds: auth.groupIds,
    });
    const viewable = new Map(
      docs
        .filter((d) => {
          const owner = personalOwnerOf(access.ctx, d.collectionId);
          return (
            resolveDocLevel(access, d) !== "none" && (owner === null || owner === auth.user.id)
          );
        })
        .map((d) => [d.id, { id: d.id, title: d.title, docType: d.docType }]),
    );

    const report: UsageReport = {
      from: from.toISOString(),
      to: to.toISOString(),
      totals: totals ?? { requests: 0, inputTokens: 0, outputTokens: 0 },
      daily,
      // Stored kinds come from the provider row; parsed to the known set.
      byModel: byModel.map((r) => ({ ...r, providerKind: providerKind.parse(r.providerKind) })),
      byUser: userRows.map(({ userId, name, ...rest }) => ({
        ...rest,
        user: userId && name ? { id: userId, name } : null,
      })),
      byOperation,
      topDocuments: documentRows.map(({ documentId, ...rest }) => ({
        ...rest,
        document: (documentId && viewable.get(documentId)) || null,
      })),
    };
    return c.json(report);
  });
}
