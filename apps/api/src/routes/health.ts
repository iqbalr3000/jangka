import { AppError } from "@jangka/shared/errors";
import { Hono } from "hono";
import type pg from "pg";

export function healthRoutes(pool: pg.Pool) {
  return new Hono().get("/", async (c) => {
    try {
      await pool.query("select 1");
    } catch {
      throw new AppError("db_unavailable", 503, "Database unavailable");
    }
    return c.json({ status: "ok" });
  });
}
