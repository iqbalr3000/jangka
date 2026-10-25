import { createDb, migrationsFolder, runMigrations } from "@jangka/db";
import pg from "pg";
import { workerTestDatabaseUrl } from "./database";

export default async function setup(): Promise<void> {
  const target = new URL(workerTestDatabaseUrl());
  const admin = new URL(target);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`drop database if exists "${target.pathname.slice(1)}" with (force)`);
  await client.query(`create database "${target.pathname.slice(1)}"`);
  await client.end();

  const { pool } = createDb(target.toString());
  await runMigrations(pool, migrationsFolder);
  await pool.end();
}
