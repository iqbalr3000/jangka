import { AppError, errorResponseSchema } from "@jangka/shared/errors";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { auditExempt } from "../src/lib/audit";
import { zValidate } from "../src/lib/validate";
import { buildApp, testDatabase, unreachablePool } from "./helpers";

// Health must report the pool it is given, so the app gets an unreachable one.
const { db, pool: realPool } = testDatabase();
const pool = unreachablePool();
afterAll(async () => {
  await pool.end();
  await realPool.end();
});

const { app } = buildApp(db, pool);
app.get("/api/v1/health/__test/app-error", () => {
  throw new AppError("conflict", 409, "Already exists", { field: "name" });
});
app.get("/api/v1/health/__test/crash", () => {
  throw new Error("db password=hunter2 leaked in message");
});
app.post(
  "/api/v1/health/__test/validate",
  zValidate("json", z.object({ name: z.string().min(1) })),
  (c) => {
    auditExempt(c, "test fixture");
    return c.json({ name: c.req.valid("json").name });
  },
);

const origin = { origin: "http://jangka.test" };

async function errorOf(res: Response) {
  return errorResponseSchema.parse(await res.json()).error;
}

describe("error handling", () => {
  it("maps AppError to its status and the standard shape", async () => {
    const res = await app.request("/api/v1/health/__test/app-error");
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({
      code: "conflict",
      message: "Already exists",
      details: { field: "name" },
    });
  });

  it("hides unknown errors behind a generic 500", async () => {
    const res = await app.request("/api/v1/health/__test/crash");
    expect(res.status).toBe(500);
    const text = await res.clone().text();
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("at ");
    expect(await errorOf(res)).toEqual({ code: "internal", message: "Internal error" });
  });

  it("returns 404 not_found for unknown API routes", async () => {
    const res = await app.request("/api/v1/health/does-not-exist");
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("not_found");
  });
});

describe("zValidate", () => {
  it("passes valid input through", async () => {
    const res = await app.request("/api/v1/health/__test/validate", {
      method: "POST",
      headers: { "content-type": "application/json", ...origin },
      body: JSON.stringify({ name: "Jangka" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Jangka" });
  });

  it("rejects invalid input with 400 validation_failed and issue details", async () => {
    const res = await app.request("/api/v1/health/__test/validate", {
      method: "POST",
      headers: { "content-type": "application/json", ...origin },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
    const error = await errorOf(res);
    expect(error.code).toBe("validation_failed");
    expect(error.details).toEqual([{ path: ["name"], message: expect.any(String) }]);
  });

  it("rejects malformed JSON with 400 validation_failed", async () => {
    const res = await app.request("/api/v1/health/__test/validate", {
      method: "POST",
      headers: { "content-type": "application/json", ...origin },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe("validation_failed");
  });
});

describe("GET /api/v1/health", () => {
  it("returns 503 db_unavailable when the database is unreachable", async () => {
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe("db_unavailable");
  });
});
