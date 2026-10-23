import { createDb, migrationsFolder, runMigrations } from "./index";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const { pool } = createDb(url);
await runMigrations(pool, migrationsFolder);
await pool.end();
console.log("Migrations applied");
