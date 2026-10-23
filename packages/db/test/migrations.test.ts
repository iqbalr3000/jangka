import { afterAll, describe, expect, it } from "vitest";
import { createDb, migrationsFolder, runMigrations } from "../src/index";
import { requireTestDatabaseUrl } from "../src/testing";

const { pool } = createDb(requireTestDatabaseUrl());
afterAll(() => pool.end());

describe("runMigrations", () => {
  it("serializes concurrent callers without error", async () => {
    await expect(
      Promise.all([runMigrations(pool, migrationsFolder), runMigrations(pool, migrationsFolder)]),
    ).resolves.toBeDefined();
  });
});
