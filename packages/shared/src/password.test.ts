import { describe, expect, it } from "vitest";
import { generateToken, hashPassword, hashToken, matchesTokenHash, verifyPassword } from "./crypto";

describe("hashPassword / verifyPassword", () => {
  it("verifies the original password", async () => {
    const stored = await hashPassword("correct horse battery");
    await expect(verifyPassword("correct horse battery", stored)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse battery");
    await expect(verifyPassword("correct horse batterY", stored)).resolves.toBe(false);
  });

  it("produces a PHC argon2id string with the configured params", async () => {
    expect(await hashPassword("x".repeat(12))).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
  });

  it("uses a fresh salt for every hash", async () => {
    expect(await hashPassword("same password")).not.toBe(await hashPassword("same password"));
  });

  it.each([
    "",
    "plain-text",
    "$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2E$aGFzaA",
    "$argon2id$v=19$m=abc,t=2,p=1$c2FsdA$aGFzaA",
    "$argon2id$v=19$m=19456,t=2,p=1$$",
    "$scrypt$whatever",
  ])("returns false for malformed stored hash %j", async (stored) => {
    await expect(verifyPassword("anything", stored)).resolves.toBe(false);
  });

  it("verifies hashes produced with different params (PHC carries them)", async () => {
    const stored = await hashPassword("portable password");
    const weaker = stored.replace("m=19456,t=2,p=1", "m=19456,t=3,p=1");
    await expect(verifyPassword("portable password", weaker)).resolves.toBe(false);
  });
});

describe("generateToken / hashToken", () => {
  it("generates 32-byte base64url tokens that differ", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(token);
  });

  it("hashes deterministically to sha256 hex without echoing the token", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
  });
});

describe("matchesTokenHash", () => {
  it("matches only the token that produced the hash", () => {
    const token = generateToken();
    expect(matchesTokenHash(token, hashToken(token))).toBe(true);
    expect(matchesTokenHash(generateToken(), hashToken(token))).toBe(false);
  });

  it("returns false for a malformed stored hash", () => {
    expect(matchesTokenHash("x", "not-hex")).toBe(false);
    expect(matchesTokenHash("x", "")).toBe(false);
  });
});
