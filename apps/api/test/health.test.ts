import { createDb } from "@jangka/db";
import { requireTestDatabaseUrl } from "@jangka/db/testing";
import { afterAll, describe, expect, it } from "vitest";
import { appWith } from "./helpers";

const { pool } = createDb(requireTestDatabaseUrl());
afterAll(() => pool.end());

describe("GET /api/v1/health (database up)", () => {
  it("returns 200 ok", async () => {
    const res = await appWith(pool).request("/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
