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
