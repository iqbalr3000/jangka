import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** Message is always generic: never include payload or key material. */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) throw new CryptoError("Invalid encryption key");
}

function decodePart(part: string, expectedBytes?: number): Buffer {
  if (!BASE64URL.test(part)) throw new CryptoError("Malformed encrypted payload");
  const bytes = Buffer.from(part, "base64url");
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) {
    throw new CryptoError("Malformed encrypted payload");
  }
  return bytes;
}

/** Returns `v1:<iv>:<tag>:<ciphertext>` with base64url parts. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(":");
}

export function decryptSecret(payload: string, key: Buffer): string {
  assertKey(key);
  const parts = payload.split(":");
  if (parts.length !== 4) throw new CryptoError("Malformed encrypted payload");
  const [version, ivPart, tagPart, ciphertextPart] = parts as [string, string, string, string];
  if (version !== VERSION) throw new CryptoError("Unsupported encrypted payload version");

  const iv = decodePart(ivPart, IV_BYTES);
  const tag = decodePart(tagPart, TAG_BYTES);
  const ciphertext = decodePart(ciphertextPart);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new CryptoError("Unable to decrypt secret");
  }
}
