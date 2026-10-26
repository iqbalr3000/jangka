import pino, { type DestinationStream, type Logger } from "pino";

export const SECRET_KEYS = [
  "password",
  "passwordHash",
  "token",
  "apiKey",
  "secret",
  "clientSecret",
  "masterKey",
];

// Safety net only: callers must still never log secrets.
export const redactPaths = [
  ...SECRET_KEYS,
  ...SECRET_KEYS.map((key) => `*.${key}`),
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
];

export type { Logger };

export function createLogger(
  options: { level: string; pretty: boolean },
  destination?: DestinationStream,
): Logger {
  const config = {
    level: options.level,
    redact: { paths: redactPaths, censor: "[Redacted]" },
  };
  if (destination) return pino(config, destination);
  if (options.pretty) return pino({ ...config, transport: { target: "pino-pretty" } });
  return pino(config);
}
