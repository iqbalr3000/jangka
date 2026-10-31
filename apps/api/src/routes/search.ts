import { documentSections, documents, templates } from "@jangka/db";
import { type SearchResult, SNIPPET_END, SNIPPET_START, searchQuery } from "@jangka/shared/search";
import { retiredSectionTitle } from "@jangka/templates";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { requireAuth } from "../lib/session";
import { zValidate } from "../lib/validate";
import { loadAccess, ROOT_NAME } from "../services/access";
import { stemmedQuery } from "../services/search-query";
import { definitionOf } from "../services/templates";
import { viewableScope } from "../services/visibility";
import type { AppEnv, RouteDeps } from "../types";

const MIN_QUERY = 2;
/** `pg_trgm` word similarity a title needs to count as a typo match. */
const FUZZY_THRESHOLD = 0.4;
const HEADLINE_OPTIONS = `StartSel=${SNIPPET_START}, StopSel=${SNIPPET_END}, MaxWords=30, MinWords=12, ShortWord=2, MaxFragments=1`;

/** Words of a search box query: letters and digits only, at least 2 characters, at most 12. */
export function searchWords(q: string): string[] {
  return [...new Set(q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((t) => t.length >= MIN_QUERY)
    .slice(0, 12);
}

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, "\\$&");
}

export function searchRoutes({ db, searchFuzzy }: RouteDeps) {
  return new Hono<AppEnv>().get("/", zValidate("query", searchQuery), async (c) => {
    const auth = requireAuth(c);
    const { q, type, limit } = c.req.valid("query");
    const data = await loadAccess(db, {
      userId: auth.user.id,
      isAdmin: auth.user.isAdmin,
      groupIds: auth.groupIds,
    });
    const scope = viewableScope(data);
    if (q.length < MIN_QUERY || !scope) return c.json({ items: [] });

    const visible = and(
      scope,
      isNull(documents.archivedAt),
      type ? eq(documents.docType, type) : undefined,
    );
    const fields = {
      id: documents.id,
      title: documents.title,
      docType: documents.docType,
      status: documents.status,
      collectionId: documents.collectionId,
      templateId: documents.templateId,
      updatedAt: documents.updatedAt,
    };

    const titleRows = await db
      .select(fields)
      .from(documents)
      .where(and(visible, ilike(documents.title, `%${escapeLike(q)}%`)))
      .orderBy(desc(documents.updatedAt))
      .limit(limit);

    // Every word must match, as a prefix (typeahead) or another form of the word.
    const tsquery = stemmedQuery(searchWords(q), { join: "and", prefix: true });
    const contentRows = tsquery
      ? await db
          .selectDistinctOn([documentSections.documentId], {
            ...fields,
            sectionKey: documentSections.sectionKey,
            rank: sql<number>`ts_rank(${documentSections.search}, ${tsquery})`,
          })
          .from(documentSections)
          .innerJoin(documents, eq(documents.id, documentSections.documentId))
          .where(and(visible, sql`${documentSections.search} @@ ${tsquery}`))
          .orderBy(
            documentSections.documentId,
            desc(sql`ts_rank(${documentSections.search}, ${tsquery})`),
          )
      : [];

    // Titles close to the query despite typos ("refnd" → "Refund policy"), most similar first.
    const similarity = sql<number>`word_similarity(${q.toLowerCase()}, lower(${documents.title}))`;
    const fuzzyRows = searchFuzzy
      ? await db
          .select(fields)
          .from(documents)
          .where(and(visible, sql`${similarity} >= ${FUZZY_THRESHOLD}`))
          .orderBy(desc(similarity))
          .limit(limit)
      : [];

    // Exact title matches first (newest first), then content matches by rank, then fuzzy titles.
    const bestSection = new Map(contentRows.map((r) => [r.id, r]));
    const titleIds = new Set(titleRows.map((r) => r.id));
    const contentIds = new Set(contentRows.map((r) => r.id));
    const ordered = [
      ...titleRows,
      ...contentRows.filter((r) => !titleIds.has(r.id)).sort((a, b) => b.rank - a.rank),
      ...fuzzyRows.filter((r) => !titleIds.has(r.id) && !contentIds.has(r.id)),
    ].slice(0, limit);
    const fuzzyIds = new Set(fuzzyRows.map((r) => r.id));

    // Headlines only for the rows returned: ts_headline is the expensive part.
    const withSection = ordered.flatMap((r) => {
      const section = bestSection.get(r.id);
      return section ? [{ documentId: r.id, sectionKey: section.sectionKey }] : [];
    });
    const headlines =
      tsquery && withSection.length > 0
        ? await db
            .select({
              documentId: documentSections.documentId,
              // One config per headline: English marks English stems; Indonesian-only matches show unmarked.
              snippet: sql<string>`ts_headline('english', ${documentSections.contentMd}, ${tsquery}, ${HEADLINE_OPTIONS})`,
            })
            .from(documentSections)
            .where(
              or(
                ...withSection.map((s) =>
                  and(
                    eq(documentSections.documentId, s.documentId),
                    eq(documentSections.sectionKey, s.sectionKey),
                  ),
                ),
              ),
            )
        : [];
    const snippets = new Map(headlines.map((h) => [h.documentId, h.snippet]));

    const templateIds = [...new Set(ordered.map((r) => r.templateId))];
    const templateRows = templateIds.length
      ? await db.select().from(templates).where(inArray(templates.id, templateIds))
      : [];
    const sectionTitles = new Map(
      templateRows.flatMap((t) =>
        definitionOf(t).sections.map((s) => [`${t.id}:${s.key}`, s.title] as const),
      ),
    );

    const items: SearchResult[] = ordered.map((row) => {
      const section = bestSection.get(row.id);
      const collection = row.collectionId ? data.rows.get(row.collectionId) : undefined;
      return {
        id: row.id,
        title: row.title,
        docType: row.docType,
        status: row.status,
        collectionId: row.collectionId,
        collectionName: !collection
          ? ROOT_NAME
          : collection.personalOwnerId === auth.user.id
            ? "Personal"
            : collection.name,
        matchedIn: titleIds.has(row.id) || (fuzzyIds.has(row.id) && !section) ? "title" : "content",
        snippet: snippets.get(row.id) ?? null,
        sectionTitle: section
          ? (sectionTitles.get(`${row.templateId}:${section.sectionKey}`) ??
            retiredSectionTitle(section.sectionKey))
          : null,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
    return c.json({ items });
  });
}
