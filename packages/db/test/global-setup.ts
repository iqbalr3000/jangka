import { createDb, migrationsFolder, runMigrations } from "../src/index";
import { requireTestDatabaseUrl } from "../src/testing";

export default async function setup(): Promise<void> {
  const { pool } = createDb(requireTestDatabaseUrl());
  await runMigrations(pool, migrationsFolder);
  await pool.end();
}
