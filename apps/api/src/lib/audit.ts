import type { Context } from "hono";

export type AuditEntry = {
  action: string;
  targetType: string;
  targetId: string | null;
  metadata?: Record<string, unknown>;
};

/** No-op until feature `history-audit`; call it from every mutating endpoint now. */
export async function audit(_c: Context, _entry: AuditEntry): Promise<void> {}
