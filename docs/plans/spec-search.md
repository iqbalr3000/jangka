# Spec — search

Status: agreed 2026-10-25. Feature #14 (SPEC §11). Builds on `impact-retrieval` (tsvector, visibility filter), `access`.
Technical reference: SPEC §4 (`filterViewable`), §11, DESIGN §2 (`/search`), §3 (`⌘K` palette), §9.

## Goal

Users find documents they can view by title or content from a `⌘K` command palette (which also jumps to collections,
admin pages and actions) or a full `/search` page. Results never include documents the user can't view.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Matching | Title: `ILIKE %q%`. Content: full-text, **AND** of prefix terms (`refund:* & window:*`) over `document_sections.search` | Typeahead finds partial words; searchers expect every word to match (retrieval uses OR on purpose) |
| Ranking | Title matches first, then best section `ts_rank`; one row per document | The title is the strongest signal |
| Snippet | `ts_headline` of the best section with private start/stop markers (`\u0002` / `\u0003`), max ~30 words; the client escapes text and wraps marked parts in `<mark>` | No HTML from the server, so no injection |
| Visibility | Shared `viewableScope` (moved from `retrieval.ts` to `services/visibility.ts`): collections resolved with `packages/permissions`, applied in SQL; archived documents and documents in archived collections excluded | Unviewable documents are never ranked, counted or snippeted |
| Minimum | Queries shorter than 2 characters return nothing; terms are letters/digits only | Cost; tsquery safety |
| Palette | `⌘K` / `Ctrl K` and the top-bar button; groups: Documents (server, top 8), Collections (from the loaded tree), Go to (admin pages, admins only), Actions (New document); ↑/↓/Enter; "See all results" → `/search?q=` | DESIGN §3, §9 |
| Search page | `/search?q=&type=`: up to 50 results, type filter chips, snippets, collection path | DESIGN §2 |
| Components | Built on the existing `Dialog`; no `cmdk` dependency | Engineering defaults |

## API

`GET /api/v1/search?q=&type=&limit=` (signed in; `limit` default 20, max 50):
`{ items: { id, title, docType, status, collectionId, collectionName, matchedIn: "title" | "content", snippet: string | null, sectionTitle: string | null, updatedAt }[] }`.
Collection names come from the access data already loaded for the visibility filter (root → "Our documents",
personal → "Personal").

## `packages/shared` (`search` subpath)

`searchQuery`, `searchResult`, `searchResponse`, `SNIPPET_START`, `SNIPPET_END`, `snippetParts(snippet)` →
`{ text, marked }[]` (pure; used by the web to render).

## Web

- **Command palette** (`CommandPalette`, mounted in the app shell): input with debounce (200 ms), grouped results,
  keyboard navigation, empty and loading states; top-bar button enabled.
- **Search page** (`/_app/search`): query input bound to the URL, type chips (All / BRD / PRD / TSD), result rows
  (type badge, title, collection, status, snippet with `<mark>`), "No documents match".

## Tests

**unit**: prefix AND query building; `snippetParts` (markers, escaping is the renderer's job, unmatched text).
**api**: title match ranks above content-only match; content match with snippet and section title; type filter;
archived document and archived collection excluded; short query → empty; **a matching document in a collection the
user can't view (incl. someone's personal collection) is never returned, and the result count doesn't reveal it**.
**e2e**: `⌘K` → type → Enter opens the document; the member doesn't see a restricted document; `/search` shows a
highlighted snippet and the type filter narrows results.

## Acceptance

1. SPEC §11 baseline: results never include documents the user can't view.
2. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## Out of scope

Language stemming / fuzzy matching; searching comments or chat; saved searches; recent documents in the palette.
