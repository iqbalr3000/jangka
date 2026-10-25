import { z } from "zod";

export const auditLogEntry = z.object({
  id: z.string(),
  action: z.string(),
  actor: z.object({ id: z.string(), name: z.string() }).nullable(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  /** Resolved for documents, collections, users, groups and providers; null when unknown. */
  target: z.object({ label: z.string(), href: z.string().nullable() }).nullable(),
  metadata: z.record(z.string(), z.unknown()),
  ip: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditLogEntry = z.infer<typeof auditLogEntry>;

export const auditLogList = z.object({
  items: z.array(auditLogEntry),
  nextCursor: z.string().nullable(),
});

export const auditLogQuery = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Exact action, or a prefix: `document` matches `document.*`. */
  action: z
    .string()
    .regex(/^[a-z_]+(\.[a-z_]+)*$/)
    .optional(),
  actorId: z.uuid().optional(),
  /** ISO dates (inclusive day range in UTC). */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuery>;
