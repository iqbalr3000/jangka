import { type SQL, sql } from "drizzle-orm";
import type pg from "pg";
import type { Logger } from "../logger";

/**
 * Each word matches as itself (a prefix when typing ahead) or its English or Indonesian stem.
 * Words must be letters and digits only, so they can't carry tsquery operators.
 */
export function stemmedQuery(
  words: readonly string[],
  { join, prefix }: { join: "and" | "or"; prefix: boolean },
): SQL | null {
  if (words.length === 0) return null;
  const parts = words.map(
    (word) =>
      sql`(to_tsquery('simple', ${prefix ? `${word}:*` : word}) || to_tsquery('english', ${word}) || to_tsquery('indonesian', ${word}))`,
  );
  // Parenthesized: `search @@ a && b` would parse as `(search @@ a) && b`.
  return sql`(${sql.join(parts, sql.raw(join === "and" ? " && " : " || "))})`;
}

/** `pg_trgm` is created at boot, not in a migration: managed Postgres may refuse it, and search works without. */
export async function enableFuzzySearch(pool: pg.Pool, logger: Logger): Promise<boolean> {
  try {
    await pool.query("create extension if not exists pg_trgm");
  } catch (err) {
    logger.warn({ err }, "pg_trgm unavailable: title search won't tolerate typos");
  }
  const { rowCount } = await pool.query("select 1 from pg_extension where extname = 'pg_trgm'");
  return (rowCount ?? 0) > 0;
}

/** `q` as a literal inside a LIKE pattern. */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, "\\$&");
}
