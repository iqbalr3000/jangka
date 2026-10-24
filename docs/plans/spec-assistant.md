# Spec — assistant

Status: agreed 2026-10-24. Feature #6 (SPEC §11). Builds on `document`, `llm-providers`. Next: `export`.
UI reference: `docs/design/Jangka Mockups.dc.html` — 1a (interview), 1b (drafting + inline revise diff).
Technical reference: SPEC §6.2 (pipelines), PRD FR-031–035, NFR-006/009, DESIGN §6.3–6.5, §8.

## Goal

A PM describes the problem in chat; the assistant interviews (max 3 focused questions per turn), tracks coverage per
template section, drafts sections one by one with live streaming, and revises a single section with a reviewable
diff. Stop cancels the provider request. Nothing is invented: sections without information stay `empty`.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Pipelines | Prompts + flows in `packages/llm/src/pipelines` (no DB); API owns persistence and SSE | SPEC §6; pipelines testable with the fake provider |
| Coverage schema | Built per template: `coverage: { <sectionKey>: "missing"\|"partial"\|"covered" }`, `notes: { <key>?: string }`, `openQuestions`, `readyToDraft` | Model can't invent keys; precise Zod validation |
| Markdown → TipTap | `fromMarkdown()` in `packages/export` using the `marked` lexer, mapped to whitelisted nodes, validated by `docContent` | Robust parsing; LLM output untrusted (hard rule #5); same function renders streaming text in the browser |
| Thread | One shared thread per document; user messages record `created_by`; viewers can read it | Interview state is per document; SPEC: view includes chat history |
| Draft all | Drafts only empty sections; non-empty sections are drafted only via the per-section action | Manual writing is never silently overwritten |
| Missing coverage | Sections with coverage `missing` are skipped and stay `empty` (event `section_skipped`) | "Never invented" (FR-034) |
| Gate | Draft all is enabled when every required section is ≥ `partial`; otherwise "Draft anyway" (force) drafts the rest and skips missing ones | SPEC §6.2 |
| LLM writes | Saved as version `source = llm` (always versioned), revision-checked against the revision seen when the section started; changed meanwhile → `section_conflict`, nothing overwritten | Optimistic locking applies to the assistant too |
| Stop | Client aborts the fetch → `stream.onAbort` aborts the provider call; the section in progress is discarded, finished ones stay; partial chat text is kept with an "(interrupted)" marker | Hard rule #9; NFR-009 |
| Concurrency | In-memory per-document generation lock → `409 generation_in_progress` | Single-instance app (like the rate limiter) |
| Revise accept / undo | Accept = existing `PUT` with `source: "llm"`; Undo = `PUT` of the previous content (session rule versions it) | No new endpoints; history stays append-only |
| Diff | Inline, line-based LCS over markdown, no dependency; side-by-side deferred | Boring and enough for section-sized text |
| Context budget | chars/4 estimate; over 70% of the model's context (from `listModels`, default 128k): drop oldest chat turns (first user message kept) and clip distant sections' markdown | Budget without an extra summarization call; LLM summaries deferred |
| Usage | Every assistant message (chat, draft, revise) records provider, model, input/output tokens | NFR-009 |
| During drafting | Queued/drafting sections are read-only in the UI | Replaces DESIGN §6.4 pause/resume prompt for now |
| Fake provider | `generateObject` without queued responses returns a deterministic schema-valid sample (enums take the last value); a message containing `[slow]` streams slowly | e2e without scripting; Stop testable |

## `packages/export`

`fromMarkdown(md): DocNode` — `marked.lexer` tokens → paragraph, heading (h1–h2 demoted to h3, h5+ to h4), lists
(nested, ordered start), blockquote, code (```mermaid → `mermaidBlock`), hr, table (header row → `tableHeader`),
inline strong/em/codespan/link (non-http(s)/mailto links become text)/br; unknown tokens → their text as paragraphs.
Output always passes `docContent`. Round-trip test: `fromMarkdown(toMarkdown(doc))` equals `doc` for the whitelist.

## `packages/llm/src/pipelines`

```ts
coverageSchema(template): ZodType<CoverageResult>
interview(provider, { template, sections, transcript, model }, signal): AsyncIterable<StreamEvent>  // assistant reply
assessCoverage(provider, { template, sections, transcript, model }, signal): Promise<CoverageResult>
draftSection(provider, { template, section, sections, transcript, coverage, model }, signal): AsyncIterable<StreamEvent>
checkSection(provider, { section, markdown, model }, signal): Promise<{ completeness: "partial"|"complete"; note: string }>
reviseSection(provider, { section, markdown, instruction, sections, model }, signal): AsyncIterable<StreamEvent>
fitBudget(parts, contextWindow): parts   // pure; tested
```

Prompts (system): role, document type + title, template section list with guidance, current sections' markdown,
"never invent facts — write only what the interview supports; omit what is unknown", output format (markdown only, no
section heading, Mermaid in ```mermaid fences when `expectsDiagram`), interview: "ask at most 3 focused questions,
do not draft". Fake provider additions: schema-derived sample objects; `[slow]` → 150 ms per word.

## Data model (migration `0004_assistant`)

- **chat_threads** — `id`, `document_id fk unique`, `created_by fk`, timestamps.
- **chat_messages** — `id`, `thread_id fk`, `role` (`user`|`assistant`), `kind` (`chat`|`draft`|`revise`), `content text`,
  `created_by null fk`, `provider_kind null`, `model null`, `input_tokens null`, `output_tokens null`, `created_at`.
- **interview_states** — `document_id pk fk`, `state jsonb` (CoverageResult, normalized to all template keys), `updated_at`.

## `packages/shared/assistant` (new subpath)

`coverageLevel`, `interviewState { sections: { key, coverage, note }[], openQuestions, readyToDraft }`,
`chatMessage { id, role, kind, content, author, createdAt, interrupted }`, `chatThread { messages, state }`,
`chatRequest { message }`, `draftRequest { sections?: string[], force?: boolean }`, `reviseRequest { instruction }`,
`assistantEvent` (discriminated union): `message_start { messageId }`, `text { delta, sectionKey? }`,
`section_start { key }`, `section_done { section }`, `section_skipped { key, reason: "missing_coverage" }`,
`section_conflict { key }`, `coverage { state }`, `done { usage }`, `error { code, message }`.
`saveSectionRequest` gains optional `source: "llm"`. Error codes `llm_not_configured`, `generation_in_progress`.

## API

All require view (GET) or edit (POST) on the document via `packages/permissions`; generation requires a configured
default provider + model (`409 llm_not_configured`) and the document lock (`409 generation_in_progress`).

| Endpoint | Behavior |
|---|---|
| `GET /documents/:id/chat` | Thread messages (oldest first) + interview state |
| `POST /documents/:id/chat` (SSE) | Saves the user message; streams the reply (`message_start`, `text`…); saves it with usage; then `assessCoverage` → saves state → `coverage`; `done` |
| `POST /documents/:id/draft` (SSE) | Sections = requested keys, or all empty sections. Unless `force`, required sections with `missing` coverage → `409 coverage_incomplete` before streaming. Per section: `section_start`, `text { sectionKey }`…, convert + revision-checked save (llm version) + `checkSection` → `section_done`; missing coverage → `section_skipped`. Finishes with an assistant `draft` message summarizing what was drafted/skipped (+ usage) and `done` |
| `POST /documents/:id/sections/:key/revise` (SSE) | Streams a proposal (`text { sectionKey }`), saves a `revise` assistant message (instruction + "Proposed changes to X"), `done`. Nothing written to the section |
| `PUT /documents/:id/sections/:key` | Accepts `source: "llm"` (accepting a revision): always versioned as `llm` |

Provider failures → `error` event with the normalized `LLMError` message (logged as kind + reason only). Abort →
provider request cancelled, nothing further saved.

## Web

- **Assistant panel** (right, 360 px, toggle `⌘.`): Coverage checklist (`n/12`, collapsible; collapses after the first
  draft), messages (assistant/user, author names, "(interrupted)"), composer with `@` section mention autocomplete
  (message `@Section …` → revise that section), `⌘↵` send, `Esc` / ■ Stop while generating. Error message inline with
  Retry. View-only users see history without composer.
- **Header**: `Draft all` (disabled with tooltip when no LLM; admins get a link to `/admin/llm`; confirm dialog when
  coverage is incomplete: "N required sections lack information and will stay empty. [Draft anyway]"),
  "Drafting 1 of 3 sections…" + ■ Stop while running.
- **Outline**: `Queued` / `Drafting` labels.
- **Section**: streaming preview (read-only TipTap fed by `fromMarkdown`, caret, left border `--primary`); section
  actions `⟳ Revise` (inline instruction input) and `Draft this section` (for non-empty: confirm overwrite).
  Revise proposal inline: diff (`--diff-add` / `--diff-del`), `n changes · Esc discard · ⌘↵ accept`, Discard /
  Edit before accepting / Accept; after Accept "Accepted · Undo". Empty sections: "Ask me about this" pre-fills chat.
- Client SSE: `fetch` + small parser, each event validated with `assistantEvent`.

## Tests

**export**: `fromMarkdown` per construct, demotion, unsafe links, mermaid fences, round-trip with `toMarkdown`.
**llm pipelines** (fake + stub): coverage schema built from keys and normalized; draft prompt includes guidance and
"never invent"; `fitBudget` keeps the first message and drops oldest turns; fake sampling is schema-valid.
**api**: chat saves both messages with usage and updates state; viewers can read but not post; `llm_not_configured`;
`generation_in_progress` while one runs; draft writes llm versions only for empty sections, skips `missing`,
`coverage_incomplete` without force; LLM write conflicting with a human edit → `section_conflict`, human content
kept; revise streams and writes nothing; accept with `source: "llm"` versions as llm; **abort mid-stream closes the
provider request** (stub `closedEarly`) and saves nothing for that section; provider error → `error` event, no key leak.
**e2e** (fake provider): chat → coverage fills → Draft all → all sections drafted → revise one via `@mention` →
accept → undo; a `[slow]` chat message → Stop → stream ends, message marked interrupted.

## Acceptance

1. SPEC §11 baseline: PRD from chat → all sections drafted → revise one via chat → stop mid-stream cancels the provider call.
2. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## Out of scope

LLM-based summarization of old turns; side-by-side diff; pause/resume when typing into a drafting section;
requirements extraction (→ `traceability`); diagram render + fix loop in the worker (→ `export`); per-document model
choice; cross-document context (→ `impact-retrieval`).
