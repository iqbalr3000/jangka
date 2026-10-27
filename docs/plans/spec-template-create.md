# Spec — template-create

Status: agreed 2026-10-27. Phase 4. Builds on `custom-templates` ([spec](spec-custom-templates.md)).

## Goal

Admins create a template from the Templates page with a visible **New template** button, starting either from a
blank draft or from any published template of the chosen type. Today a template can only be made through the
row menu's **Duplicate…**, which is easy to miss and has no blank option.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Scope | New templates for the existing types (BRD / PRD / TSD) only | New document types touch the `doc_type` enum, requirement kinds, traceability, prompts and export: a separate feature |
| Entry point | **New template** button in the page header → dialog: Type, Name, Start from | One discoverable way in; the row menu's Duplicate… stays as a shortcut |
| Start from | `Blank` (default) or the latest published version of any non-archived family of the chosen type, built-ins included | Covers both "from scratch" and "adapt an existing one" in one dialog |
| Blank draft | Zero sections. Drafts may be saved empty; publish requires ≥ 1 section | An auto-added starter section would fix a key like `untitled-section` forever (keys never change) |
| Requirement sections | Not required. Editor shows a one-line note when the type has requirement kinds and no section uses one | Allowed by the current rules; the note explains why the document will have no requirement IDs / trace links |
| Name | Unique per type, same rule and `409` as Duplicate | Families are `(doc_type, name)` |
| Access / audit | Admins only; `template.create` with `{ docType, name, from }` (`from` = source id or `null`) | Same as the other template mutations |

## `packages/templates`

- Split the schema: `templateDraftDefinition` (sections `min(0)`, unique keys) and `templateDefinition` (the same
  with sections `min(1)`, unchanged behaviour). `customTemplateDefinition` keeps extending `templateDefinition`.
- Built-ins, `definitionOf`, documents, search, trace and the worker keep using `templateDefinition`: they only ever
  read published versions.

## `packages/shared` (`templates` subpath)

- `createTemplateRequest { docType, name: templateName, sourceId?: uuid }`.
- `saveTemplateDraftRequest.sections`: drop `min(1)` (keep `max(60)`).

## API

| Endpoint | Behavior |
|---|---|
| `POST /admin/templates` `{ docType, name, sourceId? }` | Creates draft v1 of a new family. `sourceId` omitted → blank (`sections: []`). `sourceId` given → must be a published version of the same `docType`, else `400 invalid_template`; its definition is copied (same as duplicate). Name taken → `409` with `details[name]`. Returns `templateDetail`, `201` |
| `GET /admin/templates/:id` | Drafts parse with `templateDraftDefinition` (an empty draft must load) |
| `PUT /admin/templates/:id` | Validates with `templateDraftDefinition` (empty allowed) |
| `POST /admin/templates/:id/publish` | Zero sections → `400 invalid_template`, message "Add at least one section before publishing", path `["sections"]`; then `customTemplateDefinition` as today |

The insert reuses the existing `insertDraft` path (generalized to take a definition), so duplicate and create share
it. Duplicate's endpoint and behavior are unchanged.

## Web

- **Templates page** (`/admin/templates`): **New template** button (primary, right of the title). Header copy
  updated: "Create a template from scratch or from an existing one…".
- **New template dialog**: Type (select, default PRD), Name, Start from (select: `Blank`, then the latest published
  version of each non-archived family of the chosen type, labelled `Name · vN`; resets to Blank when Type changes).
  Submit → `POST /admin/templates` → open the editor. Errors (e.g. name taken) shown in the dialog's error banner,
  like the Duplicate dialog.
- Also keep the row menu's **Duplicate…** as is.
- **Template editor**: when a draft has no sections, show an empty state ("No sections yet. Add the first section
  to define the document.") with the existing **+ Add section** button. Requirement note under the header when the
  type supports requirement kinds and no section has one: "No section collects requirements, so documents from this
  template won't have requirement IDs or trace links."

## Editor polish (agreed 2026-10-27)

- Section cards collapse to one line (number, title, Required / diagram / requirement-prefix chips, key, issue
  count); one open at a time, **Expand all / Collapse all**; cards with publish errors open automatically.
- **Insert section** appears between cards on hover/focus; a new section opens, scrolls into view and selects its
  title. New sections start with empty guidance (placeholder text instead of filler).
- Guidance may be empty in a draft (`templateDraftSection`); publish requires it ("Write guidance for the
  assistant", path `sections.N.guidance`). Titles are trimmed and required ("Add a title").
- Sticky editor header (Save draft / Publish always visible); ⌘S / Ctrl+S saves the draft. The last section can
  be removed. Diagram labels: Flowchart, Sequence, ERD, State.
- New template dialog: Type as BRD / PRD / TSD buttons (same as New document); Start from options show the section
  count (`templateVersionView.sectionCount`).

## Tests

**templates**: `templateDraftDefinition` accepts zero sections and still rejects duplicate keys;
`templateDefinition` still rejects zero sections; all built-ins pass.
**api** (`apps/api/test/templates.test.ts`): create blank → save empty → add sections → publish; create from a
built-in copies its sections; `sourceId` of a draft, of another type, or unknown → `400`; name taken → `409`;
publish with zero sections → `400` with path `["sections"]`; non-admin → `403`; audit row written.
**e2e** (`e2e/tests/templates.spec.ts`): admin creates a blank TSD template, adds a section, publishes, and a new
TSD created with that template shows the section.

## Acceptance

1. An admin can create a template from blank or from an existing published template via **New template**,
   edit it, and publish it; new documents can use it.
2. An empty draft can be saved and reopened; publishing it is refused with a clear message.
3. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## Out of scope

New document types; template import/export; starting from a draft; reordering or renaming section keys.
