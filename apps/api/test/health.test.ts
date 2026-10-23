import { afterAll, describe, expect, it } from "vitest";
import { buildApp, call, testDatabase } from "./helpers";

const { db, pool } = testDatabase();
afterAll(() => pool.end());

describe("GET /api/v1/health (database up)", () => {
  it("returns 200 ok", async () => {
    const res = await call(buildApp(db, pool).app, "GET", "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
