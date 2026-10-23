import type pg from "pg";

/** Empties every table in `public` between integration tests. Migration bookkeeping lives in `drizzle`. */
export async function truncateAll(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  if (rows.length === 0) return;
  const tables = rows.map((row) => `"public"."${row.tablename}"`).join(", ");
  await pool.query(`truncate ${tables} restart identity cascade`);
}

export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Start the test database with `pnpm test:db:up` and set it (see .env.example).",
    );
  }
  return url;
}
