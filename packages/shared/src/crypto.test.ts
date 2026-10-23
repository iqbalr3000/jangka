import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CryptoError, decryptSecret, encryptSecret } from "./crypto";

const key = randomBytes(32);

function tamper(payload: string, partIndex: number): string {
  const parts = payload.split(":");
  const part = parts[partIndex];
  if (part === undefined) throw new Error("missing part");
  const bytes = Buffer.from(part, "base64url");
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  parts[partIndex] = bytes.toString("base64url");
  return parts.join(":");
}

describe("encryptSecret / decryptSecret", () => {
  it.each(["sk-ant-api03-secret", "", "kunci rahasia 🔑 ünïcødé"])(
    "round-trips %j",
    (plaintext) => {
      expect(decryptSecret(encryptSecret(plaintext, key), key)).toBe(plaintext);
    },
  );

  it("produces a versioned payload", () => {
    expect(encryptSecret("x", key)).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]*$/);
  });

  it("uses a fresh IV for every call", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it.each([
    ["iv", 1],
    ["tag", 2],
    ["ciphertext", 3],
  ])("rejects a tampered %s", (_name, partIndex) => {
    const payload = encryptSecret("secret", key);
    expect(() => decryptSecret(tamper(payload, partIndex), key)).toThrow(CryptoError);
  });

  it("rejects the wrong key", () => {
    const payload = encryptSecret("secret", key);
    expect(() => decryptSecret(payload, randomBytes(32))).toThrow(CryptoError);
  });

  it.each([
    "",
    "v1:abc",
    "v1:a:b:c:d",
    "v1:!!!:###:$$$",
    "v2:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:AAAA",
  ])("rejects malformed payload %j", (payload) => {
    expect(() => decryptSecret(payload, key)).toThrow(CryptoError);
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => encryptSecret("x", randomBytes(16))).toThrow(CryptoError);
    expect(() => decryptSecret(encryptSecret("x", key), randomBytes(31))).toThrow(CryptoError);
  });

  it("never leaks payload or key material in error messages", () => {
    const payload = encryptSecret("secret", key);
    const tampered = tamper(payload, 3);
    try {
      decryptSecret(tampered, key);
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(tampered);
      for (const part of tampered.split(":").slice(1)) expect(message).not.toContain(part);
      expect(message).not.toContain(key.toString("base64"));
      expect(message).not.toContain(key.toString("hex"));
    }
  });
});
