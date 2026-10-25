import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Enter a valid email" }));
export const passwordSchema = z
  .string()
  .min(12, { error: "Use at least 12 characters" })
  .max(256, { error: "Use at most 256 characters" });
const nameSchema = z.string().trim().min(1, { error: "Required" }).max(100);

export const setupStatusResponse = z.object({ completed: z.boolean() });

export const verifySetupTokenRequest = z.object({ token: z.string().trim().min(1) });

export const setupRequest = z.object({
  token: z.string().trim().min(1),
  orgName: nameSchema,
  adminName: nameSchema,
  adminEmail: emailSchema,
  password: passwordSchema,
});
export type SetupRequest = z.infer<typeof setupRequest>;

export const loginRequest = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});

export const sessionUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  isAdmin: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUser>;

export const meResponse = z.object({
  user: sessionUser,
  org: z.object({ name: z.string(), host: z.string() }),
});
export type MeResponse = z.infer<typeof meResponse>;

export const inviteKind = z.enum(["invite", "password_reset"]);
export type InviteKind = z.infer<typeof inviteKind>;

export const inviteInfoResponse = z.object({
  kind: inviteKind,
  email: z.string(),
  orgName: z.string(),
  name: z.string().nullable(),
});
export type InviteInfo = z.infer<typeof inviteInfoResponse>;

/** `name` is required when accepting an `invite` and ignored for `password_reset`. */
export const acceptInviteRequest = z.object({
  name: nameSchema.optional(),
  password: passwordSchema,
});

export const adminUser = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  isAdmin: z.boolean(),
  isActive: z.boolean(),
  lastLoginAt: z.string().nullable(),
  /** Names of the SSO providers linked to this user. */
  identities: z.array(z.string()),
});
export type AdminUser = z.infer<typeof adminUser>;

export const adminUserList = z.object({
  items: z.array(adminUser),
  nextCursor: z.string().nullable(),
});

export const createInviteRequest = z.object({ email: emailSchema });

export const inviteLinkResponse = z.object({ url: z.string(), expiresAt: z.string() });

export const pendingInvite = z.object({
  id: z.string(),
  email: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type PendingInvite = z.infer<typeof pendingInvite>;
export const pendingInviteList = z.object({ items: z.array(pendingInvite) });

export const updateUserRequest = z.object({ isActive: z.boolean() });

export const paginationQuery = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// SSO (feature `sso`)

export const authProviderKind = z.enum(["google", "oidc"]);
export type AuthProviderKind = z.infer<typeof authProviderKind>;
export const GOOGLE_ISSUER = "https://accounts.google.com";

/** Public: what the login page offers. */
export const authOptions = z.object({
  passwordLoginEnabled: z.boolean(),
  providers: z.array(z.object({ id: z.string(), name: z.string(), kind: authProviderKind })),
});
export type AuthOptions = z.infer<typeof authOptions>;

/** `?sso_error=` on /login after a failed SSO callback. */
export const ssoError = z.enum([
  "domain_not_allowed",
  "not_linked",
  "inactive",
  "invalid_state",
  "provider_error",
]);
export type SsoError = z.infer<typeof ssoError>;

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, { error: "Enter domains like example.com" });

const providerFields = {
  name: z.string().trim().min(1, { error: "Required" }).max(100),
  issuer: z.url({ protocol: /^https?$/, error: "Enter the issuer URL" }),
  clientId: z.string().trim().min(1, { error: "Required" }).max(500),
  allowedDomains: z.array(domainSchema).max(50),
  autoProvision: z.boolean(),
  enabled: z.boolean(),
};

export const createAuthProviderRequest = z.object({
  kind: authProviderKind,
  ...providerFields,
  clientSecret: z.string().min(1, { error: "Required" }).max(2000),
});
/** Omitted fields keep their value; an omitted secret keeps the stored one. */
export const updateAuthProviderRequest = z
  .object({ ...providerFields, clientSecret: z.string().min(1).max(2000) })
  .partial();

export const authProviderView = z.object({
  id: z.string(),
  kind: authProviderKind,
  name: z.string(),
  issuer: z.string(),
  clientId: z.string(),
  secretLast4: z.string(),
  allowedDomains: z.array(z.string()),
  autoProvision: z.boolean(),
  enabled: z.boolean(),
  linkedUsers: z.number(),
});
export type AuthProviderView = z.infer<typeof authProviderView>;
export const authProviderList = z.object({
  items: z.array(authProviderView),
  /** The one callback URL to register with every IdP. */
  redirectUri: z.string(),
});

export const instanceSettingsView = z.object({
  passwordLoginEnabled: z.boolean(),
  /** FORCE_PASSWORD_LOGIN is set: password login works whatever the setting says. */
  passwordLoginForced: z.boolean(),
  /** Why password login can't be turned off, or null when it can. */
  disablePasswordLoginBlocker: z.string().nullable(),
  defaultGroupId: z.string().nullable(),
});
export type InstanceSettingsView = z.infer<typeof instanceSettingsView>;

export const updateSettingsRequest = z.object({
  passwordLoginEnabled: z.boolean().optional(),
  defaultGroupId: z.uuid().nullable().optional(),
});
