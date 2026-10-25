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
          // Only a content change flags downstream requirements (impact-retrieval).
          contentChangedAt: sql`case when (${requirements.text}, ${requirements.priority})
            is distinct from (excluded.text, excluded.priority)
            then now() else ${requirements.contentChangedAt} end`,
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

/**
 * When a downstream requirement was last brought in line with its upstream: its own last content
 * change or its last "Mark reviewed", whichever is later.
 */
export function reviewBaseline(row: {
  contentChangedAt: Date;
  upstreamReviewedAt: Date | null;
}): Date {
  const reviewed = row.upstreamReviewedAt;
  return reviewed && reviewed > row.contentChangedAt ? reviewed : row.contentChangedAt;
}

/** The upstream change that needs review, if it happened after the baseline (FR-054). */
export function changedSince(upstream: { contentChangedAt: Date }, baseline: Date): Date | null {
  return upstream.contentChangedAt > baseline ? upstream.contentChangedAt : null;
}
