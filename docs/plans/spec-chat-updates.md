# Spec — chat-updates

Status: agreed 2026-10-27. Phase 4. Builds on `assistant` ([spec](spec-assistant.md)), `editor-chat-polish`
([spec](spec-editor-chat-polish.md)), `review` (approval lock).

## Goal

When the conversation adds or contradicts facts that sections already contain, the assistant says which sections
are affected and, on request, proposes updates to them as the existing inline diffs. The user accepts, edits or
discards each one. Nothing changes without an Accept.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Detection | The existing post-reply `assessCoverage` call also returns `suggestions: { key, reason }[]` | No extra LLM call per turn; it already reads the transcript and the sections |
| Trigger | A chip under the latest reply ("This may change 2 sections: Goals, NFR · Review updates · Dismiss"); proposals are generated only on **Review updates** | User in control; tokens spent only when asked |
| Eligible sections | Sections with content only (empty ones are Draft's job); at most 3 per assessment | Less noise; Draft already covers empty sections |
| Facts only | A suggestion needs a concrete fact stated in the conversation that the section lacks or contradicts; the update changes only what that fact requires | "Never invent" (FR-034) |
| Accept | Per section, via the existing proposal UI (Accept / Edit before accepting / Discard); no Accept all | "The assistant proposes, the human decides" (DESIGN §1) |
| Persistence | Suggestions live in the interview state (survive reload). Each section leaves the list once its proposal is ready (a stop or failure keeps the rest); Dismiss clears all. The next assessment produces a fresh list. Proposals stay client-side, as for revise | Reuses the stale-assessment guard; no new table |
| Draft-time assessment | The draft route's assessment (`fromSource`) saves no suggestions | Content was just written from the same transcript |
| Who | Edit access; not on approved documents (`409`); viewers see no chip | Same as revise |

## `packages/shared` (`assistant`)

- `interviewState` gains `suggestions: { key: string, reason: string }[]`, `.default([])` (states saved before this
  feature parse unchanged).
- `proposeUpdatesRequest { sections: string[] }` (1–3 keys, unique).
- `assistantEvent` gains `proposal_ready { sectionKey, markdown }`: the final proposal of one section (after diagram
  checks). Streaming text keeps using `text { delta, sectionKey }`.

## `packages/llm`

- `coverageSchema(template, contentKeys)`: adds `suggestions: z.array({ key: z.enum(contentKeys), reason:
  z.string().max(200) }).max(3)` only when `contentKeys` is non-empty (an enum can't be empty).
- `normalizeCoverage` keeps suggestions whose key has content, de-duplicated, at most 3.
- `assessCoverage(common, { doc, transcript, suggest })`: `suggest: false` omits the field and returns `[]`.
- `coverageSystem` adds, when suggesting: "List sections that already have content and that the conversation
  contradicts or adds a concrete fact to. Reason: one line naming that fact. Only facts the user stated; empty list
  if none."
- `reviseSection` input gains optional `transcript`; when given it is fitted with `fitBudget` and sent before the
  instruction. `reviseSystem` adds, with a transcript: "Change only what the new facts require; keep all other
  content as is."

## API

| Endpoint | Behavior |
|---|---|
| `POST /documents/:id/chat` | Unchanged flow; the post-reply assessment saves `suggestions` (stale guard as today) |
| `POST /documents/:id/propose-updates` `{ sections }` | Edit access, not approved (`409 document_approved`), LLM configured, quota, generation lock. Every key must be in the saved suggestions (else `400 validation_failed`). Logs a user message (`kind: "revise"`, "Update from chat: Goals, NFR"), then per section in template order: `reviseSection` with the transcript and instruction `Update this section with the new information from the conversation: <reason>` → `text { sectionKey }` deltas → diagram check/fix → `proposal_ready` → that key leaves the suggestions. Then one assistant message ("Proposed updates to Goals, NFR. Review them in the document.", summed usage) and `done`. A provider error stops the run with `error`; finished proposals stay |
| `DELETE /documents/:id/chat/suggestions` | Edit access; clears the suggestions; `204` |

Audited: `assistant.propose_updates` (`{ sections }`), `assistant.dismiss_suggestions`.

## Web

- **Assistant panel**: when the state has suggestions, the user can edit, the document isn't approved and nothing
  is running, a chip under the latest message: "This may change N section(s):" listing each title with its reason
  underneath (readable on touch screens), with **Review updates** and **Dismiss**.
- **Store** (`use-assistant`): `proposeUpdates(keys, reasons)` runs `/propose-updates`; a section's proposal is
  created on its first `text` (instruction `From chat: <reason>`, `streaming`) and set `ready` with the final
  markdown on `proposal_ready`. Stop keeps ready proposals only (existing rule). After the run the chat query is
  refetched, so the chip reflects the saved state.
- The first proposal's section scrolls into view. Accept / Edit / Discard are the existing revise actions.

## Tests

**llm**: suggestions field present only with content keys and limited to them; normalize drops unknown/empty keys,
duplicates, more than 3; `suggest: false` returns `[]`; `reviseSection` sends the transcript and the facts-only
rule when given one.
**api**: a chat turn saves suggestions (queued fake response); propose-updates streams `text` + `proposal_ready` per
section in template order, removes those suggestions, writes both messages, audits; keys not suggested → `400`;
approved → `409`; viewer → `403`; dismiss clears and audits; draft-from-source assessment saves none; a stored
state without `suggestions` still loads. (Draft-from-source saving no suggestions is covered by the llm test:
`assessCoverage` without `suggest` returns `[]`.)
**web**: store creates one proposal per section and marks each ready on `proposal_ready`; stop keeps only ready
ones.
**e2e**: draft a section, chat a new fact → chip → Review updates → diff in that section → Accept → content updated;
Dismiss hides the chip after reload.

## Acceptance

1. After a chat reply that adds facts to a drafted section, the chip names it; Review updates shows a diff there,
   and Accept saves it as an LLM version.
2. No proposal is generated without Review updates; Dismiss and reload keep the chip hidden.
3. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## Out of scope

Accept all; suggestions for empty sections; persisting proposals server-side; suggestions across documents
(upstream/downstream — `impact-retrieval` flags those).
