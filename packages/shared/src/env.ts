import { z } from "zod";

const KEY_BYTES = 32;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const masterKey = z
  .string({ error: "is required" })
  .refine((value) => BASE64.test(value), { error: "must be base64" })
  .transform((value) => Buffer.from(value, "base64"))
  .refine((key) => key.length === KEY_BYTES, {
    error: `must decode to ${KEY_BYTES} bytes (openssl rand -base64 32)`,
  });

const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: "is required" })
    .refine((value) => /^postgres(ql)?:\/\//.test(value), {
      error: "must be a postgres:// or postgresql:// URL",
    }),
  MASTER_KEY: masterKey,
  PUBLIC_URL: z
    .url({ protocol: /^https?$/, error: "must be an http(s) URL" })
    .transform((value) => value.replace(/\/+$/, "")),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  ENABLE_FAKE_LLM: z.stringbool({ error: "must be true or false" }).default(false),
  APP_ROLE: z
    .enum(["api", "worker", "all"], { error: "must be api, worker or all" })
    .default("all"),
});

export type Env = z.infer<typeof envSchema>;

/** `lines` name the variable and the rule, never the received value. */
export class EnvError extends Error {
  readonly lines: string[];

  constructor(lines: string[]) {
    super(`Invalid environment:\n${lines.join("\n")}`);
    this.name = "EnvError";
    this.lines = lines;
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new EnvError(lines);
}
