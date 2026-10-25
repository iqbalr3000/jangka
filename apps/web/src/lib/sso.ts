import { groupList } from "@jangka/shared/access";
import {
  authOptions,
  authProviderList,
  instanceSettingsView,
  type SsoError,
} from "@jangka/shared/auth";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./api";

export const authAdminKey = ["admin", "auth"] as const;

/** Public: login methods. */
export const authOptionsQuery = queryOptions({
  queryKey: ["auth", "options"],
  queryFn: () => apiFetch("/auth/oidc/providers", { schema: authOptions }),
});

export const authProvidersQuery = queryOptions({
  queryKey: [...authAdminKey, "providers"],
  queryFn: () => apiFetch("/admin/auth-providers", { schema: authProviderList }),
});

export const instanceSettingsQuery = queryOptions({
  queryKey: [...authAdminKey, "settings"],
  queryFn: () => apiFetch("/admin/settings", { schema: instanceSettingsView }),
});

export const adminGroupsQuery = queryOptions({
  // Same key as the Groups page, so both share the cache.
  queryKey: ["admin", "groups"],
  queryFn: () => apiFetch("/admin/groups", { schema: groupList }),
});

/** Full-page navigation: the callback sets the session and redirects back. */
export function ssoStartUrl(providerId: string, redirect: string): string {
  return `/api/v1/auth/oidc/${providerId}/start?redirect=${encodeURIComponent(redirect)}`;
}

export function ssoErrorMessage(error: SsoError, email: string | undefined): string {
  switch (error) {
    case "domain_not_allowed":
      return `Your account${email ? ` (${email})` : ""} isn't allowed. Ask your admin to add your domain.`;
    case "not_linked":
      return "No Jangka account is linked to this sign-in. Ask your admin for an invite.";
    case "inactive":
      return "Your account is deactivated.";
    default:
      return "Sign-in failed. Try again.";
  }
}
