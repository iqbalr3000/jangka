import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

export function clientIp(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // No socket (e.g. app.request in tests).
    return "unknown";
  }
}

export function requestMeta(c: Context): { ip: string; userAgent: string | null } {
  return { ip: clientIp(c), userAgent: c.req.header("user-agent") ?? null };
}
