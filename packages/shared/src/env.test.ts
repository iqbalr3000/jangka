import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env";

const masterKey = randomBytes(32).toString("base64");
const valid = {
  DATABASE_URL: "postgres://jangka:jangka@localhost:5432/jangka",
  MASTER_KEY: masterKey,
  PUBLIC_URL: "https://docs.example.com/",
};

function errorOf(source: Record<string, string | undefined>): EnvError {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error;
    throw error;
  }
  throw new Error("expected parseEnv to throw");
}

describe("parseEnv", () => {
  it("parses a valid env and applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.MASTER_KEY).toBeInstanceOf(Buffer);
    expect(env.MASTER_KEY).toHaveLength(32);
    expect(env.PUBLIC_URL).toBe("https://docs.example.com");
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.NODE_ENV).toBe("production");
    expect(env.SESSION_TTL_DAYS).toBe(30);
  });

  it("accepts the postgresql:// scheme", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "postgresql://u:p@db:5432/x" })).not.toThrow();
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(errorOf({ ...valid, DATABASE_URL: "mysql://u:p@db/x" }).lines[0]).toMatch(
      /^DATABASE_URL:/,
    );
  });

  it("reports every invalid var", () => {
    const error = errorOf({});
    expect(error.lines.map((line) => line.split(":")[0])).toEqual(
      expect.arrayContaining(["DATABASE_URL", "MASTER_KEY", "PUBLIC_URL"]),
    );
  });

  it.each([
    ["missing", undefined],
    ["not base64", "not-base64-%%%-value"],
    ["31 bytes", randomBytes(31).toString("base64")],
    ["33 bytes", randomBytes(33).toString("base64")],
  ])("rejects MASTER_KEY that is %s without echoing it", (_case, value) => {
    const error = errorOf({ ...valid, MASTER_KEY: value });
    expect(error.lines).toHaveLength(1);
    expect(error.lines[0]).toMatch(/^MASTER_KEY:/);
    if (value) expect(error.message).not.toContain(value);
  });
});
