import { meResponse, setupStatusResponse } from "@jangka/shared/auth";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./api";

export const setupStatusQuery = queryOptions({
  queryKey: ["setup-status"],
  queryFn: () => apiFetch("/setup/status", { schema: setupStatusResponse }),
  staleTime: Number.POSITIVE_INFINITY,
});

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: () => apiFetch("/auth/me", { schema: meResponse }),
  retry: false,
});

/** Only same-app paths: blocks `?redirect=https://evil` and protocol-relative `//evil`. */
export function safeRedirect(target: string | undefined): string {
  return target?.startsWith("/") && !target.startsWith("//") ? target : "/";
}
