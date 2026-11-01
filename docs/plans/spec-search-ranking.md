# Spec — search-ranking

Status: agreed 2026-11-01. Phase 4 enhancement from the backlog, found by `test:perf` in `search-stemming`
([spec](spec-search-stemming.md)).

## Goal

Search stays fast when a query matches most sections, without changing which documents are found.

## Findings (5,000 documents, 63,333 sections, all matching)

| Content query | Time |
|---|---|
| Match only (`@@`), no ranking | 41 ms |
| Match AND, `ts_rank` with the AND query — 2 words / 3 words | ≈ 590 ms / ≈ 2,100 ms |
| Match AND, `ts_rank` with the OR form of the query — 2 words / 3 words | ≈ 75 ms / ≈ 73 ms |
| Match AND, rank only the newest 1,000 matching sections | 41 ms |

`ts_rank` on an AND query scores word proximity, which grows quadratically with word positions (the perf fixture
repeats its paragraph 20 times) and worsens with every word; on an OR query it sums per-word weights, linearly.

The perf "selective" search (`q=approving`) matched every section too: the English stem `approv` also matches
"approved" in the fixture paragraph. Its ≈ 116 ms measured a cheap single-word ranking, not a selective query.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Ranking | Match with the AND query (every word required, unchanged); rank with the OR form of the same words | Same results, 8–30× faster on broad queries; frequency and weights still rank |
| Cap | None | Ranking every match fits the NFR-007 budget; a cap would never rank older matches |
| Perf | Selective search becomes `q=finance` (~1% of documents); the every-section query (2 and 3 words) is budgeted (< 500 ms p95) instead of info-only | Measures what it claims; broad queries are now guarded |
| Old numbers | A correction note in `spec-search-stemming.md` and the roadmap entry, content otherwise left as recorded | Specs are records; the wrong figure mustn't mislead |

## API

`routes/search.ts`: the content query filters with `stemmedQuery(words, { join: "and", prefix: true })` and orders
by `ts_rank(search, stemmedQuery(words, { join: "or", prefix: true }))`. Headlines keep the AND query. Response
unchanged. Chat retrieval already uses OR for both and is unchanged.

## Tests

**api**: existing search suite unchanged (results and visibility); a document mentioning the words more often ranks
first among content matches. **perf**: selective (`finance`) and every-section searches (`refunding business`,
`refunding business days`) under the 500 ms p95 budget.

## Out of scope

Proximity-aware ranking (`ts_rank_cd`); per-instance ranking settings; caching search results.
