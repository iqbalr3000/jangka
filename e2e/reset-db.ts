import pg from "pg";
import { e2eDatabaseUrl } from "./env";

// Runs before the server starts (from the webServer command), so every run begins un-set-up.
const target = new URL(e2eDatabaseUrl());
const database = target.pathname.slice(1);
const admin = new URL(target);
admin.pathname = "/postgres";

const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
await client.query(`drop database if exists "${database}" with (force)`);
await client.query(`create database "${database}"`);
await client.end();
