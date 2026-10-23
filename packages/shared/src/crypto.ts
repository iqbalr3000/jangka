import {
  argon2,
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

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

// OWASP argon2id baseline. Stored per hash (PHC string), so raising them later needs no migration.
const ARGON2 = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32, saltBytes: 16 };
const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function deriveArgon2(
  password: string,
  salt: Buffer,
  params: { memory: number; passes: number; parallelism: number; tagLength: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2("argon2id", { message: password, nonce: salt, ...params }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

function b64(bytes: Buffer): string {
  return bytes.toString("base64").replace(/=+$/, "");
}

/** Returns a PHC string: `$argon2id$v=19$m=…,t=…,p=…$<salt>$<hash>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(ARGON2.saltBytes);
  const hash = await deriveArgon2(password, salt, ARGON2);
  const { memory, passes, parallelism } = ARGON2;
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${b64(salt)}$${b64(hash)}`;
}

/** False on mismatch and on any malformed stored hash — never throws for bad input. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = PHC.exec(stored);
  if (!match) return false;
  const [, memory, passes, parallelism, saltPart, hashPart] = match;
  const salt = Buffer.from(saltPart ?? "", "base64");
  const expected = Buffer.from(hashPart ?? "", "base64");
  if (salt.length < 8 || expected.length < 16) return false;

  try {
    const actual = await deriveArgon2(password, salt, {
      memory: Number(memory),
      passes: Number(passes),
      parallelism: Number(parallelism),
      tagLength: expected.length,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** 32 random bytes, base64url — for sessions, invites, and the setup token. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored only as their sha256 (they are high-entropy, so no salt is needed). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison of a presented token against a stored `hashToken` value. */
export function matchesTokenHash(token: string, storedHash: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(storedHash)) return false;
  return timingSafeEqual(Buffer.from(hashToken(token), "hex"), Buffer.from(storedHash, "hex"));
}
