import { z } from "zod";
import { docTypeSchema, documentStatus } from "./document";

/** Private markers around matched words in snippets (never valid in document text). */
export const SNIPPET_START = "\u0002";
export const SNIPPET_END = "\u0003";

export const searchQuery = z.object({
  q: z.string().trim().max(200).default(""),
  type: docTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const searchResult = z.object({
  id: z.string(),
  title: z.string(),
  docType: docTypeSchema,
  status: documentStatus,
  collectionId: z.string().nullable(),
  collectionName: z.string(),
  matchedIn: z.enum(["title", "content"]),
  /** Plain text with SNIPPET_START/END around matches; null for title-only matches. */
  snippet: z.string().nullable(),
  sectionTitle: z.string().nullable(),
  updatedAt: z.string(),
});
export type SearchResult = z.infer<typeof searchResult>;
export const searchResponse = z.object({ items: z.array(searchResult) });

/** Snippet → runs of plain and matched text; the renderer escapes text as usual. */
export function snippetParts(snippet: string): { text: string; marked: boolean }[] {
  const parts: { text: string; marked: boolean }[] = [];
  for (const [i, chunk] of snippet.split(SNIPPET_START).entries()) {
    if (i === 0) {
      if (chunk) parts.push({ text: chunk, marked: false });
      continue;
    }
    const end = chunk.indexOf(SNIPPET_END);
    const marked = end === -1 ? chunk : chunk.slice(0, end);
    const rest = end === -1 ? "" : chunk.slice(end + 1);
    if (marked) parts.push({ text: marked, marked: true });
    if (rest) parts.push({ text: rest, marked: false });
  }
  return parts;
}
