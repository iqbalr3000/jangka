import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { AppEnv } from "../types";

function socketIp(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // No socket (e.g. app.request in tests).
    return "unknown";
  }
}

/**
 * The caller's IP. Behind one trusted proxy it's the last X-Forwarded-For entry (the one the proxy
 * appended); earlier entries come from the client and can be forged.
 */
export function resolveClientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  return socketIp(c);
}

export function clientIp(c: Context<AppEnv>): string {
  return c.get("clientIp") ?? socketIp(c);
}

export function requestMeta(c: Context<AppEnv>): { ip: string; userAgent: string | null } {
  return { ip: clientIp(c), userAgent: c.req.header("user-agent") ?? null };
}
