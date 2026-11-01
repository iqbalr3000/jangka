# Spec — search-stemming

Status: agreed 2026-10-31. Phase 4. Builds on `search` ([spec](spec-search.md); deferred there: "language stemming
/ fuzzy matching") and `impact-retrieval` (same tsvector for chat context).

## Goal

Search finds other forms of a word ("approving" → "approved", "persetujuan" → "disetujui") in English and Indonesian,
and tolerates typos in document titles ("refnd" → "Refund self-service"), without new services.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Stemming | `document_sections.search` becomes `to_tsvector('simple', md) \|\| to_tsvector('english', md) \|\| to_tsvector('indonesian', md)` | Both stemmers ship with Postgres 18; documents can mix languages; no setting to manage |
| Query | Per word: `(simple prefix \| english stem \| indonesian stem)`; words joined with AND (search) or OR (chat retrieval, unchanged semantics) | Typeahead prefixes keep working; every word still has to match |
| Fuzzy | Titles only, with `pg_trgm` `word_similarity(q, title) ≥ 0.4`, ranked after exact title matches and content matches | Typo tolerance where it matters most; content fuzzy is expensive |
| Extension | At boot the app runs `create extension if not exists pg_trgm`; failure is logged once and fuzzy stays off (detected via `pg_extension`). Not in a migration | Managed Postgres may refuse extensions; the app must still start |
| Snippets | `ts_headline` with the `english` config and the combined query | One config per call; Indonesian-only stem matches may not be highlighted (the result is still found) |
| Migration | `0014`: drop and re-add the generated `search` column and its GIN index | A generated expression can't be altered in place |

## API

- `services/search-query.ts`: `searchTerms(q)` (letters/digits, ≥ 2 chars, as today) → `tsquery` SQL for AND / OR.
  Used by `routes/search.ts` and `services/retrieval.ts`.
- `RouteDeps.searchFuzzy: boolean`, set from `pg_extension` after the boot attempt; tests can force it off.
- `/search`: title matches = `ILIKE` or (fuzzy on and `word_similarity ≥ 0.4`); order: exact title, content rank,
  fuzzy title (by similarity). Response shape unchanged; `matchedIn: "title"` for fuzzy title hits.

## Tests

**api**: a stemmed English form and an Indonesian form match content; prefix typeahead still matches; AND still
requires every word; chat retrieval finds a stemmed form; a typo matches a title with fuzzy on and not with it off;
exact title matches rank above fuzzy ones; visibility rules unchanged (existing suite). **perf**: a selective stemmed
search on 5,000 documents stays within budget (p95 ≈ 116 ms); a query matching every section is reported but not
budgeted (endpoint p95 ≈ 1.2 s; its ranking query takes ≈ 0.65 s now and took ≈ 0.8 s with the old vector) and is
tracked in the roadmap backlog.

> **Correction (2026-11-01, [search-ranking](spec-search-ranking.md)):** the "selective" perf query (`approving`)
> matched every section (the English stem `approv` also matches "approved" in the fixture), so ≈ 116 ms measured a
> single-word ranking, not a selective search. Broad queries are now ranked with the OR form and budgeted.

## Out of scope

Fuzzy content matching; "did you mean" suggestions; per-instance language setting; other languages.
