# Spec — llm-usage

Status: agreed 2026-10-31. Phase 4. Builds on `llm-providers`, `assistant`, `chat-updates`, `history-audit`.
Technical reference: PRD NFR-009 (token usage recorded), SPEC §6.

## Goal

Admins see how many LLM tokens the instance uses — by provider and model, user, operation and document — for a
chosen period. Every provider call is counted, including the structured calls (coverage, completeness check,
diagram fixes) that aren't recorded today.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Source | New `llm_usage` table, one row per pipeline run (structured retries summed into it) | `chat_messages` misses every `generateObject` call (coverage runs every chat turn) |
| Unit | Tokens only (input, output) and request count; no prices | Prices differ per model and change; OpenRouter alone lists hundreds |
| Audience | Admins only (`/admin/usage`) | Organization-level cost control |
| History | The migration backfills assistant `chat_messages` with tokens; user = the thread's latest user message before it; operation from `kind` | The page isn't empty on day one; coverage/check history can't be recovered |
| Periods | Last 7 days, last 30 days (default), this month, last month — in UTC | Covers billing and trend questions without a date picker |
| Retention | Kept; rows are small | No requirement to purge |

## Data model (migration `0012_llm_usage`)

**llm_usage** — `id` (uuidv7), `created_at`, `user_id fk users null` (null for backfilled rows without a user),
`document_id fk documents null on delete set null`, `provider_kind text`, `model text`, `operation text` check in
(`chat`, `coverage`, `draft`, `check`, `revise`, `propose`, `diagram_fix`), `input_tokens int`, `output_tokens int`.
Index on `created_at`.

## `packages/llm`

- `ChatRequest` gains `onUsage?: (usage: Usage) => void`. Adapters call it once per `generateObject` attempt
  (from the SDK's usage fields), so retries are counted. Streams keep reporting usage in their `done` event, which
  the API records. The fake reports deterministic counts.
- Pipelines pass `onUsage` through from `Common`; `generateWithRetry` needs no change (each attempt reports).

## API

- `services/usage.ts`: `usageMeter()` → `{ onUsage, total }` accumulating one run; `recordUsage(db, { userId,
  documentId, operation, resolved, usage })` inserts a row when tokens > 0 (or always for a completed call).
- Recorded at: chat reply (`chat`), post-reply assessment and draft-from-source assessment (`coverage`), each drafted
  section (`draft`) and its completeness check (`check`), revise (`revise`), propose-updates (`propose`), every
  diagram fix inside draft/revise/propose and the fix-diagram endpoint (`diagram_fix`). Aborted and failed calls
  record what the provider reported.
- `chat_messages` token columns stay as they are (per-message history).
- `GET /admin/usage?period=7d|30d|month|last_month` (admins): `{ from, to, totals: { requests, inputTokens,
  outputTokens }, daily: { date, inputTokens, outputTokens }[], byModel: { providerKind, model, … }[], byUser:
  { user: { id, name } | null, … }[], byOperation: { operation, … }[], topDocuments: { document: DocumentRef |
  null, … }[] }` (top 10 documents; `document: null` when it's in another user's personal collection — admins reach those by URL only, never in a list). Read-only, so not audited.

## Web

**Admin → Usage** (`/admin/usage`, sidebar entry after LLM providers): period select; stat row (requests, input
tokens, output tokens); daily bars (input + output, stacked); tables by model, user, operation, top documents,
each sorted by total tokens with a proportional bar. Numbers formatted in the browser locale (`12.4k`, `1.2M`).
Empty state when the period has no rows.

## Tests

**llm**: each adapter reports usage for `generateObject` (stubbed SDK responses), retries report every attempt; the
fake reports usage. **api**: a chat turn records `chat` + `coverage`; draft records `draft` + `check` per section;
revise / propose / fix-diagram record their operation; user and document are set; the aggregate endpoint groups
and filters by period; admin only. **db**: the backfill attributes an assistant message to the preceding user
message's author. **e2e**: after a chat turn, Admin → Usage shows requests and the fake model.

## Acceptance

1. Every LLM call made by the app appears in `llm_usage` with its operation, user and document.
2. The Usage page shows the period's totals and breakdowns; existing chat history is included.
3. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## Out of scope

Prices and cost estimates; per-user quotas or budgets (the request rate limit stays); users viewing their own
usage; CSV export.
