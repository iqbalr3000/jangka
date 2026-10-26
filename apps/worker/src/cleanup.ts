import { type Database, diagramRenders, documentExports } from "@jangka/db";
import { lt } from "drizzle-orm";

const RENDER_CACHE_DAYS = 30;

/** Expired exports and stale cache entries; re-rendering a diagram is cheap. */
export async function cleanup(
  db: Database,
  now = new Date(),
): Promise<{ exports: number; renders: number }> {
  const expired = await db
    .delete(documentExports)
    .where(lt(documentExports.expiresAt, now))
    .returning({ id: documentExports.id });
  const staleBefore = new Date(now.getTime() - RENDER_CACHE_DAYS * 24 * 60 * 60 * 1000);
  const stale = await db
    .delete(diagramRenders)
    .where(lt(diagramRenders.createdAt, staleBefore))
    .returning({ hash: diagramRenders.sourceHash });
  return { exports: expired.length, renders: stale.length };
}
