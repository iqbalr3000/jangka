import pg from "pg";
import pino from "pino";
import { createApp } from "../src/app";

export const silentLogger = pino({ level: "silent" });

/** Pool pointing at a closed port: every query fails fast. */
export function unreachablePool(): pg.Pool {
  return new pg.Pool({
    connectionString: "postgres://x:x@127.0.0.1:1/x",
    connectionTimeoutMillis: 500,
  });
}

export function appWith(pool: pg.Pool) {
  return createApp({ pool, logger: silentLogger });
}
