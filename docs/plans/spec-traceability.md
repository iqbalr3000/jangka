# Spec — traceability

Status: agreed 2026-10-25. Feature #8 (SPEC §11). Builds on `document`, `assistant`, `export`. Next: `sso`.
Technical reference: SPEC §3 (`requirements`), §4 (restricted links, LLM context), §6.2, §7, PRD FR-041, FR-050–053,
DESIGN §6.6, §6.7. ADR 0003.

## Goal

BRD, PRD and TSD documents form a chain: a PRD can be generated from a BRD and a TSD from a PRD, and every
requirement carries a stable ID (`BR-`, `FR-`, `NFR-`, `TR-`) with links to the upstream requirements it comes from.
A trace panel shows those links; documents the viewer can't see appear as "Restricted document". Exports can include
a requirements appendix.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Source of truth | Section **content**. Requirement sections hold a table `ID \| Requirement \| Priority \| Upstream`; every `saveSection` (human or LLM) parses it and rewrites the `requirements` index in the same transaction | Manual edits stay in sync; deterministic, no LLM per save; reuses tables, markdown and export (ADR 0003) |
| Stable IDs | Index keyed by `(document_id, code)`; codes are written in the content (by the LLM or a person) and never reassigned | FR-050 |
| Links | `requirements.upstream_codes text[]` resolved against the source document's requirements at read time; **no `requirement_links` table** | Always consistent, even when the upstream document is edited later (ADR 0003) |
| Kinds | `business` BR, `functional` FR, `non_functional` NFR, new `technical` TR (TSD) | TSD needs requirement-level links to PRD |
| Relation | From document types: PRD → BRD `derives_from`, TSD → PRD `implements`; not stored | One source per document |
| Templates | New BRD v1, TSD v1; **PRD v2** (FR/NFR guidance becomes the table with Upstream). PRD v1 documents keep working | Published template versions are immutable |
| Legacy format | Parser also accepts list items / paragraphs starting with a code (`FR-001: …`, `FR-001 — …`), without upstream | PRD v1 guidance asked for numbered lists |
| Source document | Optional on create for PRD (source BRD) and TSD (source PRD); must be viewable and not archived; fixed afterwards | `documents.source_document_id` already exists |
| LLM context | Source document's markdown + requirement list included only when the requesting user can view it (`resolveDocLevel`) | SPEC §4; FR-075 |
| Draft from source | One SSE action: `assessCoverage` with the source as context, then draft every empty section | The coverage gate would otherwise force a chat the BRD already answers |
| Restricted | Unviewable source → `restricted` (no id/title) in header and trace; unviewable downstream documents are omitted entirely | DESIGN: never show titles or counts of restricted items |
| Trace UI | Right panel tabs `Chat \| Trace`; trace = document chain + requirement list with ↑ upstream / ↓ downstream | 360 px panel; DESIGN §6.6 three columns don't fit |
| Inline chips | Deferred (TipTap decorations) | Trace panel covers FR-052 |
| Appendix | Export option "Requirements appendix": table ID, Requirement, Priority, Upstream codes | FR-041; codes come from the document itself, so the worker needs no permission context |
| Backfill | None: existing documents are indexed when a requirement section is next saved | No production deployments yet |

## Templates (`packages/templates`)

- `requirementKind` gains `technical`. Helpers: `REQUIREMENT_PREFIX = { business: "BR", functional: "FR",
  non_functional: "NFR", technical: "TR" }`, `UPSTREAM_DOC_TYPE = { brd: null, prd: "brd", tsd: "prd" }`.
- **BRD v1** (SPEC §7): Executive Summary, Business Problem, Business Objectives, Stakeholders, Current State (AS-IS),
  Proposed Solution (TO-BE, diagram flowchart), Business Requirements (`business`), Scope / Out of Scope, Constraints,
  Assumptions, Risks, Success Criteria, Cost/Benefit (optional).
- **PRD v2**: PRD v1 with Functional / Non-Functional Requirements guidance = the requirement table (Upstream column:
  BR codes the requirement derives from; empty when there is no source).
- **TSD v1** (SPEC §7) plus **Technical Requirements** (`technical`, after Components): Overview, Architecture
  (flowchart), Components, Technical Requirements, Data Model (erd), API Design, Key Sequences (sequence),
  Non-Functional Design, Infrastructure & Deployment, Observability, Migration/Rollout Plan, Testing Strategy, Risks &
  Open Questions. TR Upstream = FR/NFR codes it implements.
- Requirement-section guidance (all three): "Output a markdown table with columns ID | Requirement | Priority |
  Upstream. IDs <PREFIX>-001 upward, keep existing IDs unchanged. Priority is Must, Should or Could. Upstream lists only
  codes from the source document's requirement list." + NO_INVENTION. BRD omits the Upstream column.

## `packages/export`: `extractRequirements`

```ts
extractRequirements(doc: DocNode, kind: RequirementKind): ExtractedRequirement[]
type ExtractedRequirement = { code: string; text: string; priority: "must" | "should" | "could" | null;
                              upstreamCodes: string[] };
```

- Tables whose header row has a cell `ID` (case-insensitive); other columns matched by header: `Requirement` (also
  `Title`, `Description`), `Priority`, `Upstream` (also `Derives from`, `Implements`). Cell text = plain text of the cell.
- Code must match `^<PREFIX>-\d{3,}$` for the section's kind; others ignored. First occurrence of a code wins.
- Priority: `must`/`should`/`could`, also `M`/`S`/`C`, case-insensitive; else null.
- Upstream: every `\b(BR|FR|NFR)-\d{3,}\b` in the cell, deduplicated, in order.
- Legacy: list items and paragraphs starting with a code followed by `:`, `—`, `-` or whitespace → text = the rest.
- Pure; also used by the worker for the appendix.

## Data model (migration `0006_traceability`)

- **requirements** — `id`, `document_id fk cascade`, `section_key text`, `code text`, `kind text`
  (`business`|`functional`|`non_functional`|`technical`), `text text`, `priority text null` (`must`|`should`|`could`),
  `upstream_codes text[] not null default '{}'`, `position int`, `created_at`, `updated_at`;
  unique(document_id, code); index(document_id).
- **documents.source_document_id** — exists; add index.
- Indexing: inside `saveSection`'s transaction, for sections whose template `requirementKind` is set: upsert extracted
  rows (update text/priority/upstream/position when changed), delete this section's codes no longer present. A code
  moving between sections of the same kind is an update, not delete + insert.

## `packages/llm` (pipelines)

- `DocumentContext` gains `source?: { docType; title; markdown; requirements: { code; text }[] }`.
- `base()` prompt adds "Source <TYPE> \"<title>\"" with its markdown and an explicit requirement list
  ("Cite only these codes in the Upstream column").
- No new pipeline; draft-from-source reuses `assessCoverage` + `draftSection`.
- `fitBudget` counts the source markdown and clips it last; its requirement list is never clipped.
- Fake provider: drafting a requirement section returns a two-row table in the indexed format citing the first code
  of the source's requirement list (`fakeRequirementTable`), so e2e and keyless dev exercise traceability end to end.

## `packages/shared`

- `document`: `createDocumentRequest` gains `sourceDocumentId?: uuid`; `documentDetail` gains
  `source: { id, title, docType } | { restricted: true } | null`. docTypes BRD/TSD enabled.
- New `trace` subpath: `requirementView { code, kind, text, priority, sectionKey, upstream: UpstreamRef[],
  downstream: { documentId, code, text }[] }`, `UpstreamRef = { code, status: "linked", text, documentId } |
  { code, status: "restricted" } | { code, status: "missing" }`, `traceResponse { upstream: DocRef | { restricted: true }
  | null, downstream: DocRef[], requirements: requirementView[] }`.
- `createExportRequest` / `exportJob` gain `includeAppendix: boolean` (default true).
- `draftRequest` gains `fromSource?: boolean`. Error code `invalid_source`.

## API

| Endpoint | Behavior |
|---|---|
| `GET /documents?docType=&q=&limit=` | Source picker: viewable, non-archived documents (not in archived collections), newest first; `q` = title contains; limit default 50, max 200 (no cursor: filtered in memory after permissions) |
| `POST /documents` | `docType` brd/prd/tsd → latest built-in template of that type. `sourceDocumentId`: allowed for prd/tsd only, must be the upstream type, viewable and not archived → else `400 invalid_source` (unviewable → also `invalid_source`, not 404, same message) |
| `GET /documents/:id` | `source` as above (`restricted` when not viewable) |
| `GET /documents/:id/trace` | View access. Upstream refs resolved against the source document's requirements when viewable (`linked`/`missing`), else `restricted`; downstream = requirements of viewable documents whose source is this one, whose `upstream_codes` contain the code |
| `POST /documents/:id/draft` (`fromSource: true`) | Requires a viewable source (`409 invalid_source`); assesses coverage with the source as context (event `coverage`), then drafts every empty section; same events as Draft all |
| Chat / draft / revise | `documentContext` adds the source when the requester can view it |
| `POST /documents/:id/exports` | `includeAppendix` stored; worker appends "Requirements" (H2) with the table when the document has requirements |

## Web

- **New document dialog**: type BRD / PRD / TSD (radio cards); for PRD/TSD an optional "Source document" native
  select (up to 200 viewable non-archived documents of the upstream type; search deferred). The collection page's
  empty-state button reads "+ New document".
- **Header**: upstream chip `↑ BRD · Title` (link) or `↑ 🔒 Restricted document`.
- **Right panel**: tabs `Chat | Trace` (persisted). Trace: chain row (upstream · this · downstream documents as links),
  then requirements grouped by kind: mono code chip, text, priority; `↑` refs (code + text tooltip, restricted lock,
  missing in `--status-partial` "not in source"); `↓` refs. Empty state explains the table format.
- **Draft from source** button in the header (edit level, source viewable, empty sections present) next to Draft all.
- **Export dialog**: `[✓] Requirements appendix` (shown when the document has requirements).

## Tests

**export** (unit): `extractRequirements` table/legacy/wrong prefix/duplicates/priority aliases/multi upstream/header
aliases. **templates**: BRD/PRD v2/TSD valid, requirement sections have kinds and table guidance.
**llm**: source context includes the requirement list; absent when not given.
**api**: save indexes requirements (insert, update, delete, move between sections); LLM draft indexes too; create with
source: wrong type / unviewable / archived → `invalid_source`; detail `source` restricted for a user without access;
trace linked / missing / restricted; downstream hides unviewable documents; prompt for a user without source access
contains no source text (recording provider); draft `fromSource` assesses then drafts.
**worker**: appendix in PDF and DOCX; omitted when unchecked or no requirements.
**e2e** (fake provider queues requirement tables): BRD drafted → PRD from BRD via Draft from source → TSD from PRD →
trace shows FR ↑ BR and TR ↑ FR; a member without BRD access sees "Restricted document" on the PRD.

## Acceptance

1. SPEC §11 baseline: BRD → PRD → TSD chain where each FR links to a BR; user without BRD access sees "Restricted document".
2. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## Out of scope

Inline requirement chips in the editor; changing a document's source; "needs review" flags (→ `impact-retrieval`);
LLM-based extraction; custom templates (→ `custom-templates`); backfill of existing documents.
