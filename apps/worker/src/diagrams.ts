import { type Database, diagramRenders } from "@jangka/db";
import { type DiagramResult, diagramHash } from "@jangka/export/render";
import { eq } from "drizzle-orm";
import type { Renderer } from "./renderer";

export async function cachedDiagram(db: Database, hash: string): Promise<DiagramResult | null> {
  const [row] = await db.select().from(diagramRenders).where(eq(diagramRenders.sourceHash, hash));
  if (!row) return null;
  if (row.svg !== null && row.png !== null) return { svg: row.svg, png: row.png };
  return { error: row.error ?? "Unknown render error" };
}

/** Cache hit, or render and store (errors included, so a broken source renders once). */
export async function renderDiagram(
  db: Database,
  renderer: Renderer,
  source: string,
): Promise<DiagramResult> {
  const hash = diagramHash(source);
  const cached = await cachedDiagram(db, hash);
  if (cached) return cached;

  // Mermaid styles are scoped by the SVG id; a hash-derived one is stable and unique per source.
  const result = await renderer.renderDiagram(source, `m${hash.slice(0, 12)}`);
  await db
    .insert(diagramRenders)
    .values(
      "error" in result
        ? { sourceHash: hash, error: result.error }
        : { sourceHash: hash, svg: result.svg, png: result.png },
    )
    .onConflictDoNothing();
  return result;
}
