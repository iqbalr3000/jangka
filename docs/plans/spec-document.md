# Spec — document

Status: agreed 2026-10-24. Feature #5 (SPEC §11). Builds on `access`, `llm-providers`. Next: `assistant`.
UI reference: `docs/design/Jangka Mockups.dc.html` — 1a (document workspace), 1c (collection view).
Technical reference: SPEC §3 (content tables), §7 (templates), §8 (mermaidBlock), DESIGN §6.3, §8.

## Goal

Users create a PRD from the built-in template in a collection they can edit, edit each section in a rich-text editor
with Mermaid diagrams, and every change is saved, versioned and protected by optimistic locking. Collection views list
documents. Everything goes through `packages/permissions`; `assistant` later writes into the same sections.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Editor structure | One TipTap editor per section, stacked; section headings come from the template and aren't editable | Matches the data model 1:1 (revision + versions per section); per-section streaming/diff later |
| Saving | Autosave ~1.5 s after the last keystroke, saves serialized per section using the returned `revision` | "Saved · 2m ago" in 1a; no self-inflicted 409s |
| Versions | Session-based: a human save writes a version row only when it starts a new session (latest version is from another user, from `llm`, or older than 10 min). Before writing it, the current (unversioned) state is versioned first, so every session's end state is kept. LLM writes always version | History stays meaningful without a row every few seconds; append-only rule holds |
| Append-only enforcement | DB trigger rejects UPDATE/DELETE on `section_versions` | Hard rule #7 enforced by the database, not convention |
| Completeness (human edit) | Blank → `empty`, otherwise → `complete`; the assistant's check may lower it later | Simple and predictable |
| Content validation | Zod whitelist of TipTap nodes/marks in `packages/shared/document`, max 512 KB per section; the editor, validator and markdown serializer share the node list | Hard rule #2; prevents drift |
| `content_md` | Derived server-side by `toMarkdown()` in new `packages/export` (HTML/DOCX added by `export`) | Needed as LLM context; one converter |
| Conflict UX | Banner on the section: "Updated by Rina 1m ago. [View theirs] [Overwrite]"; merge deferred | DESIGN §8 minus manual merge |
| Deletion | Documents are never deleted, only archived (restore like collections) | Versions are append-only and reference sections |
| Root documents | Allowed (`collection_id = null`) | Same as collections |
| Status | Always `draft` until `review` | Workflow belongs to `review` |
| Counts | Tree, child cards and matrix change summary now include document counts (non-archived) | Promised in `access` |
| Templates | Built-ins seeded on boot, idempotent; rows immutable; documents pin `template_id` | SPEC §7 |

## `packages/templates` (new)

`templateDefinition` (Zod, SPEC §7 shape) and `builtinTemplates` = [PRD v1]. PRD sections (keys stable forever):
`overview`, `problem`, `goals` (Goals & Success Metrics), `personas` (Target Users & Personas), `user_stories`,
`functional_requirements` (requirementKind functional), `non_functional_requirements` (non_functional),
`user_flow` (expectsDiagram flowchart), `out_of_scope`, `assumptions` (Assumptions & Dependencies), `risks`
(Risks & Mitigations), `open_questions`. Each has `required`, `guidance` and `interviewHints` written now (used by
`assistant`). Unit test: definitions parse, keys unique, snake_case.

## Data model (migration `0003_documents`)

- **templates** — `id`, `doc_type` (`brd`|`prd`|`tsd`), `name`, `version int`, `definition jsonb`, `is_builtin bool`,
  `created_at`; unique(`doc_type`, `name`, `version`).
- **documents** — `id`, `collection_id null fk collections`, `doc_type`, `template_id fk`, `title`, `status`
  (`draft`|`in_review`|`approved`, default `draft`), `created_by fk users`, `archived_at null`, `source_document_id null`
  (unused until `traceability`), timestamps. Index on `collection_id`.
- **document_sections** — `id`, `document_id fk cascade`, `section_key`, `position int`, `content jsonb`,
  `content_md text`, `completeness` (`empty`|`partial`|`complete`), `revision int default 0`, `updated_by null fk`,
  timestamps; unique(`document_id`, `section_key`).
- **section_versions** — `id`, `section_id fk`, `revision int`, `content jsonb`, `source` (`llm`|`human`),
  `created_by null fk`, `created_at`; unique(`section_id`, `revision`). Trigger: `BEFORE UPDATE OR DELETE` raises.

## `packages/shared/document` (new subpath)

- TipTap content schema (recursive Zod): `doc` → blocks `paragraph`, `heading` (levels 3–4; section titles are
  level 2 outside the editor), `bulletList`/`orderedList`/`listItem`, `blockquote`, `codeBlock` (language attr),
  `horizontalRule`, `table`/`tableRow`/`tableHeader`/`tableCell`, `mermaidBlock { source }`, inline `text` with marks
  `bold`, `italic`, `code`, `link { href: http(s)/mailto only }`, plus `hardBreak`. Unknown nodes/marks/attrs rejected.
- DTOs: `templateSummary`, `documentSummary { id, title, docType, status, collectionId, completeness: string[], updatedAt, createdBy }`,
  `documentDetail { document, collection breadcrumbs, access level, sections: section[] }`,
  `section { key, title, required, expectsDiagram, position, content, completeness, revision, updatedAt, updatedBy }`,
  `createDocumentRequest { title, collectionId, docType: "prd" }`, `updateDocumentRequest { title }`,
  `moveDocumentRequest { collectionId }`, `saveSectionRequest { content, revision }`,
  `revisionConflictDetails { current: section }`, `sectionVersion`.
- Error code `revision_conflict` (409).

## `packages/export` (new)

`toMarkdown(doc): string` for every whitelisted node (tables as GFM, mermaid as ```mermaid fences). Unit test: round of
every node type; blank doc → "".

## API

All access via `loadAccess` + `packages/permissions` (document level = its collection's level).

| Endpoint | Auth | Behavior |
|---|---|---|
| `GET /templates` | user | Built-in templates (summary) |
| `POST /documents` | edit on target collection | Creates document + all sections (empty, revision 0, no versions). 201 summary |
| `GET /documents/:id` | view | Detail incl. sections in template order; 404 if not viewable |
| `PATCH /documents/:id` | edit | Title |
| `POST /documents/:id/move` | edit on source + destination | `can(move_document)`; destination not archived |
| `POST /documents/:id/archive` · `/restore` | edit | Restore when the collection is archived → 409 |
| `GET /documents/:id/sections/:key/versions` | view | Newest first, paginated (no UI until `history-audit`) |
| `PUT /documents/:id/sections/:key` | edit | Validates content; `UPDATE … WHERE revision = :revision` → else `409 revision_conflict` with current section. Updates `content_md`, `completeness`, `revision + 1`, `updated_by`; versions per the session rule; bumps `documents.updated_at`. Returns section |

Collection endpoints: `GET /collections/:id/items` adds `documents` (non-archived, viewable); tree items and child
summaries add `documentCount`; `/collections/archived` also returns archived documents; permission graph collections
add `documentCount`.

Every mutating endpoint calls `audit()`.

## Web

- Deps: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-table` (+ row/header/cell), `@tiptap/extension-link`,
  `mermaid` (dynamic import on first diagram render).
- **+ New** (top bar, enabled) → New document dialog: type (PRD only now), title, collection picker (editable
  collections incl. Personal; defaults to the current collection, else Personal) → opens `/d/:id`.
- **Collection view**: documents table per 1c — TYPE (mono outlined badge), TITLE, STATUS, COMPLETE (one dot per
  section: ○ ◐ ●), UPDATED; empty state "No documents yet" + `[+ New PRD]` when editable. Tree and child cards show counts.
- **`/d/:documentId`**: header (← collection, `PRD` badge, inline-editable title, `Draft`, "Saved · 2m ago" / "Saving…",
  `⋯` Rename / Move / Archive), outline (220 px: status icon + title, ◇ for diagram sections, click scrolls,
  "n of 12 complete"), center column (max 72ch): per section `## Title` + status label + `SectionEditor`.
  Empty sections show the editor with placeholder "Not enough information yet." (the "Ask me about this" link arrives
  with `assistant`). Right panel absent until `assistant`.
- **`SectionEditor`**: TipTap with the whitelisted extensions + small toolbar (bold, italic, code, link, lists, table,
  code block, diagram); autosave queue; conflict banner (View theirs / Overwrite); read-only when level is `view`.
- **`MermaidBlock`** node view: Source / Preview toggle, live render (debounced), error badge with the parse message.
- View access: banner "You have view access", editors read-only, no ⋯ actions.
- `/archived` lists archived documents too.

## Tests

**templates / export / shared** (unit): template definitions valid; content schema accepts every node and rejects
unknown nodes, `javascript:` links, oversize content; `toMarkdown` per node.

**api**: create needs edit on the collection (404 invisible, 403 view-only); creating builds all 12 sections; detail
404 for others' personal docs; save → revision + 1, `content_md`, completeness; stale revision → 409 with current;
session versioning (same user < 10 min → no new row; other user / > 10 min → previous state versioned, then new);
DB rejects UPDATE/DELETE on `section_versions`; move needs edit on both sides; archive/restore (+ archived collection → 409);
items/tree include documents and counts; view-only user can read but not save.

**e2e**: extend `access.spec.ts` — admin creates a PRD in Platform before granting; Rina can't open it; after the grant
she sees it read-only. New `document.spec.ts` — create a PRD from + New, type in Overview, reload → content persisted,
outline shows Overview complete; add a Mermaid diagram and see the preview; a second context edits the same section →
first context's next save shows the conflict banner and Overwrite succeeds.

## Acceptance

1. SPEC §11 baseline: create a PRD, edit sections manually, stale revision → `409 revision_conflict`.
2. SPEC §11 `access` e2e (documents part): user B can't see user A's document without a grant; sees it after.
3. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## Out of scope

Chat, drafting, revise, coverage, "Ask me about this" (→ `assistant`); version history UI and restore (→ `history-audit`);
export (→ `export`); BRD/TSD templates and source documents (→ `traceability`); manual merge on conflict; recent
documents on Home; drag-and-drop move; server-authoritative Mermaid render (→ `export`).
