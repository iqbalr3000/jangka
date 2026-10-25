import { type Database, requirements, type Transaction } from "@jangka/db";
import { extractRequirements } from "@jangka/export";
import type { DocNode } from "@jangka/shared/document";
import type { RequirementKind } from "@jangka/templates";
import { and, eq, notInArray, sql } from "drizzle-orm";

type Db = Database | Transaction;

/**
 * Rewrites one section's slice of the requirements index from its content (ADR 0003). Rows whose
 * values didn't change are left alone, so `updated_at` means "this requirement changed".
 */
export async function indexRequirements(
  db: Db,
  input: { documentId: string; sectionKey: string; kind: RequirementKind; content: DocNode },
): Promise<void> {
  const extracted = extractRequirements(input.content, input.kind);
  if (extracted.length > 0) {
    await db
      .insert(requirements)
      .values(
        extracted.map((r, position) => ({
          documentId: input.documentId,
          sectionKey: input.sectionKey,
          code: r.code,
          kind: input.kind,
          text: r.text,
          priority: r.priority,
          upstreamCodes: r.upstreamCodes,
          position,
        })),
      )
      .onConflictDoUpdate({
        target: [requirements.documentId, requirements.code],
        set: {
          sectionKey: sql`excluded.section_key`,
          text: sql`excluded.text`,
          priority: sql`excluded.priority`,
          upstreamCodes: sql`excluded.upstream_codes`,
          position: sql`excluded.position`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`(${requirements.sectionKey}, ${requirements.text}, ${requirements.priority}, ${requirements.upstreamCodes}, ${requirements.position})
          is distinct from (excluded.section_key, excluded.text, excluded.priority, excluded.upstream_codes, excluded.position)`,
      });
  }
  await db.delete(requirements).where(
    and(
      eq(requirements.documentId, input.documentId),
      eq(requirements.sectionKey, input.sectionKey),
      extracted.length > 0
        ? notInArray(
            requirements.code,
            extracted.map((r) => r.code),
          )
        : undefined,
    ),
  );
}
