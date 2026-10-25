# Spec — impact-retrieval

Status: agreed 2026-10-25. Feature #13 (SPEC §11). Builds on `traceability`, `assistant`, `access`. Next: `search`.
Technical reference: SPEC §3 (`requirements`, `document_sections`, `chat_messages`), §4 (LLM context only from
viewable documents), §6.2, PRD FR-054, FR-075, DESIGN §6.6. ADR 0003.

## Goal

When an upstream requirement's content changes, the downstream requirements that cite it show "Needs review" until
someone reviews or edits them. In chat, the assistant can draw on other documents the user can view, found by
full-text search, and shows what it referenced; documents the user can't view never reach the model.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Change signal | `requirements.content_changed_at`, set on insert and when `text` or `priority` changes; reorders, section moves and the row's own upstream codes don't count | Fewer false flags than `updated_at` |
| Needs review | A downstream requirement needs review when any requirement it cites (in its document's source) has `content_changed_at` later than `max(own content_changed_at, upstream_reviewed_at)`; computed on read, no link table | Consistent with ADR 0003 |
| Clearing | "Mark reviewed" (edit access) sets `upstream_reviewed_at = now()`; editing the downstream row's text/priority also clears it (its `content_changed_at` moves) | FR-054; an edit is a review |
| Restricted | Viewers who can't see the source get `restricted` upstream refs with no change info | No information about restricted documents (SPEC §4) |
| Retrieval | Postgres full-text search over `document_sections.content_md` (`tsvector`, config `simple`, GIN index); OR query of the message's significant words; top 3 sections | No new dependency; works for Indonesian and English; groundwork for `search` |
| Permission filter | Viewable collection set computed with `packages/permissions` and applied **in SQL**; root included when viewable; archived documents excluded | Restricted documents are never ranked, read or sent (FR-075) |
| Scope | Chat only (interview turns and Q&A); draft and revise keep using the document and its source | Drafts don't mix in look-alike documents |
| Exclusions | The current document and its source (already in context) | No duplicates |
| Budget | ≤ 3 sections × 1,500 chars; included in `fitBudget` (clipped before the transcript) | Token cost |
| Visibility | SSE `references` event + `chat_messages.references jsonb` (document id, title, type, section key/title); UI "Referenced: PRD Refunds › Goals" | Users see what the answer drew on |

## Data model (migration `0011_impact_retrieval`)

- **requirements** — add `content_changed_at timestamptz not null default now()` (backfilled to `updated_at`),
  `upstream_reviewed_at timestamptz null`.
- **document_sections** — add `search tsvector generated always as (to_tsvector('simple', content_md)) stored`,
  GIN index `document_sections_search_idx`.
- **chat_messages** — add `references jsonb not null default '[]'`.

## Index changes (`services/requirements.ts`)

Upsert sets `content_changed_at = now()` only when `(text, priority)` differs from the stored row; other fields keep
updating as today.

## Retrieval (`services/retrieval.ts`)

```ts
searchTerms(message: string): string[]        // lowercased words ≥ 3 chars, letters/digits only, ≤ 12, deduped
retrieveSections(db, data: AccessData, input: { query: string; excludeDocumentIds: string[]; limit?: 3 })
  → { documentId, title, docType, sectionKey, sectionTitle, markdown }[]
```
SQL: `search @@ to_tsquery('simple', t1 | t2 | …)` (terms escaped by construction), joined with documents
(`archived_at is null`, `collection_id = any(viewable) or (collection_id is null and rootViewable)`), ordered by
`ts_rank`, limit 3. Section titles from each document's template.

## `packages/llm`

`DocumentContext` gains `related?: { title; docType; sectionTitle; markdown }[]`; the interview prompt adds "Related
documents the user can view (use them only if relevant, and name the document)". The coverage assessment does **not**
get them, so other documents never count as coverage for this one. `fitBudget` drops `related` first.

## `packages/shared`

`assistantEvent` gains `references { items: reference[] }`; `chatMessage` gains `references`. `requirementView` gains
`needsReview: boolean` and upstream refs gain `changedAt?: string` (linked only). `traceResponse` gains
`needsReviewCount`.

## API

| Endpoint | Behavior |
|---|---|
| `POST /documents/:id/chat` | Retrieves for the user message (excluding this document and its source), sends `references` before the reply, adds `related` to the context, stores references on the assistant message |
| `GET /documents/:id/trace` | `needsReview` per requirement, `changedAt` on changed linked upstream refs, `needsReviewCount` |
| `POST /documents/:id/requirements/:code/reviewed` | Edit access; sets `upstream_reviewed_at`; `404` for unknown codes; refused while approved (`409 document_approved`); audit `requirement.reviewed` |

## Web

- **Trace tab**: count "n need review" in the chain header; requirement rows with `--status-partial` marker
  "Needs review", the changed upstream chips highlighted (tooltip "Changed <time>"), and "Mark reviewed" for editors.
- **Chat**: assistant messages with references show a small "Referenced:" line with links to the documents.

## Tests

**unit**: `searchTerms` (short words, punctuation, duplicates, cap); needs-review computation.
**api**: changing BR text or priority flags the citing FR; reordering doesn't; Mark reviewed clears; editing the FR
clears; viewer without source access sees `restricted` and no `needsReview`; reviewed refused when approved; audited.
Retrieval: a viewable document's section is referenced and its text is in the prompt (recording provider); **a
document the user can't view is never in the prompt or `references`, even when it matches best** (SPEC §11
acceptance); archived and current/source documents excluded; references stored on the message.
**e2e**: edit a BRD requirement → PRD trace shows "Needs review" → Mark reviewed clears it; a chat message naming
another document's topic shows "Referenced:" with that document.

## Acceptance

1. SPEC §11 baseline: a prompt asking to summarize a document the user can't view returns no content from it.
2. Changed upstream requirements flag downstream ones until reviewed or edited.
3. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## Out of scope

Embeddings / semantic search; retrieval in draft and revise; explicit `#document` mentions; notifications for needs
review; flags on the upstream side.

## Fixed along the way

- **Table edits couldn't be saved.** TipTap's table extension (v3) adds `align` to every cell it touches, which the
  strict content whitelist rejected ("unsupported formatting"). `cellAttrs` now accepts `align` (left/center/right/null);
  regression test in `packages/shared`. Found by the impact e2e, the first test to edit a table in the editor.
- **Stale Turbo builds.** `build` and `typecheck` didn't depend on the source-only workspace packages, so a change only
  in `packages/*` replayed cached `dist` (and typecheck) results — e2e could run an old bundle. `turbo.json` now uses
  the transit-node pattern (`transit` → `^transit`) for both.
