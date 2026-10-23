import { fileURLToPath } from "node:url";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema";

export * from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createDb(databaseUrl: string): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000 });
  return { db: drizzle({ client: pool, schema }), pool };
}

// Arbitrary constant; shared by every process so concurrent boots run migrations once.
const MIGRATION_LOCK_KEY = 4_826_413_907n;

export async function runMigrations(pool: pg.Pool, migrationsFolder: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await migrate(drizzle({ client }), { migrationsFolder });
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/** Source-tree location; bundled apps resolve their own copy (see apps/api/src/main.ts). */
export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
