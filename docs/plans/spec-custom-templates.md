# Spec — custom-templates

Status: agreed 2026-10-25. Feature #11 (SPEC §11). Builds on `document`, `traceability`, `history-audit`. Next: `review`.
Technical reference: SPEC §3 (`templates`), §7, PRD FR-072, DESIGN §2 (`/admin/templates`).

## Goal

Admins duplicate a built-in (or custom) template, edit its sections and guidance as a draft, and publish it as an
immutable version. Each document type has an admin-chosen default template; users can pick another published one
when creating a document. Existing documents keep the version they pinned.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Family | A template family = `(doc_type, name)`; versions 1, 2, … within it. Built-ins are families too, read-only (duplicate only) | Matches the existing unique key; SPEC §7 "published versions are immutable" |
| Drafts | A draft is a `templates` row with `published_at null`, edited with Save draft; at most one draft per family (partial unique index) | Work survives a closed tab; any admin can continue it |
| Editing | Only drafts are editable; the family name only while the family has no published version | Names identify families and appear in documents' history |
| Section keys | Generated from the title on creation (slug, numeric suffix on clash), then fixed even if the title changes | Requirements, coverage and versions reference keys |
| Validation | Shared `customTemplateDefinition`: ≥1 section, unique keys, at most one section per requirement kind, kinds allowed per type (BRD `business`, PRD `functional`/`non_functional`, TSD `technical`) | The requirement index and upstream logic assume this; built-ins already comply |
| Table rule | The requirement-table instruction is added by the prompt layer for every section with a `requirementKind` | Editing guidance can't silently break traceability |
| Default | `instance_settings.default_templates jsonb` maps doc type → family name; unset → the latest built-in. New document dialog preselects it | Organizations standardize without relying on users |
| Picker | New document dialog: Template select = latest published version of each non-archived family of the chosen type | FR-030 + FR-072 |
| Archive | Per family; hides it from the picker (and clears it as default); documents keep working | Templates in use can't be deleted (FK) |
| Delete | Drafts only | Published versions may be pinned by documents |
| Access | Admins only | Templates are organization configuration (SPEC §4) |
| Draft saves | `PUT` validates structure only (`templateDefinition`); the custom rules run at publish | A draft can be saved mid-edit |
| Picker visibility | The Template select only shows when a type has more than one published template | No extra field for the common case |

## Data model (migration `0009_custom_templates`)

- **templates** — add `published_at timestamptz null` (backfilled to `created_at` for existing rows **before** the
  one-draft index is created, since PRD v1/v2 would otherwise violate it; built-in seeding sets it), `archived_at timestamptz null` (family-level: set on all its rows), `created_by fk users null`.
  Partial unique index `templates_one_draft` on `(doc_type, name) where published_at is null`.
- **instance_settings** — add `default_templates jsonb not null default '{}'` (`{ prd?: name, brd?: name, tsd?: name }`).

## `packages/templates`

- `customTemplateDefinition` = `templateDefinition` + the validation rules above (refinements with readable messages
  and paths), used for drafts at publish and for built-ins in tests.
- `REQUIREMENT_KINDS_BY_TYPE`, `sectionKeyFor(title, existingKeys)`.

## `packages/llm`

`draftSystem` / `reviseSystem` append `requirementTableRule(section)` (the table convention, upstream codes when the
type has an upstream) for sections with a `requirementKind`.

## `packages/shared` (`templates` subpath)

`templateSummary` gains `isBuiltin` and `isDefault` (it only ever lists published versions, so no `published`). Admin: `templateFamily { docType, name,
isBuiltin, archived, isDefault, versions: { id, version, published, publishedAt, documentCount }[], draftId }`,
`templateDetail { id, docType, name, version, published, isBuiltin, definition }`, `saveTemplateDraftRequest { name?,
sections }` (sections without keys get them server-side), `setDefaultTemplateRequest { docType, name | null }`.
`createDocumentRequest` gains `templateId?`. Error code `invalid_template`.

## API

| Endpoint | Behavior |
|---|---|
| `GET /templates?docType=` | Signed-in users: latest published version per non-archived family (+ `isDefault`), for the picker |
| `GET /admin/templates` | Families with versions, draft, document counts, default flag |
| `GET /admin/templates/:id` | One version's definition |
| `POST /admin/templates/:id/duplicate` `{ name }` | New family (same type) with draft v1 copying the definition; name unique per type |
| `POST /admin/templates/:id/new-version` | Custom family only; draft v(n+1) from the latest published; `409` if a draft exists |
| `PUT /admin/templates/:id` | Draft only (`409` otherwise); validates structure (keys assigned), `name` only if never published |
| `POST /admin/templates/:id/publish` | Draft only; `customTemplateDefinition` must pass (`400 invalid_template` with paths); sets `published_at` |
| `DELETE /admin/templates/:id` | Draft only |
| `POST /admin/templates/:id/archive` / `restore` | Family-wide; archiving clears it as default |
| `PUT /admin/settings/templates` | Set/clear the default family per type (must be published and not archived) |
| `POST /documents` | Optional `templateId`: published, not archived, same type → else `400 invalid_template`; omitted → default family's latest version, else latest built-in |

All mutations audited (`template.duplicate`, `template.new_version`, `template.update_draft`, `template.publish`,
`template.delete_draft`, `template.archive`, `template.restore`, `settings.default_template`).

## Web

- **Admin → Templates** (`/admin/templates`): grouped by type; each family shows versions (published / draft), document
  counts, Built-in / Default / Archived badges; actions Duplicate…, New version, Edit draft, Set as default, Archive/Restore.
- **Template editor** (`/admin/templates/$templateId`): name (when allowed), sections as cards with ↑/↓, remove, add;
  fields title, required, guidance (textarea), interview hints (one per line), diagram (none/flowchart/sequence/erd/
  state), requirement kind (options for the type; note that requirement sections are written as an ID table);
  Save draft, Publish (validation errors shown on the cards), Discard draft. Unsaved-changes guard on navigation.
- **New document dialog**: Template select under Type, preselecting the default.

## Tests

**templates**: custom validation (duplicate kind, kind not allowed for type, duplicate keys, empty), key generation,
all built-ins pass. **llm**: requirement table rule present for requirement sections even with custom guidance.
**api**: duplicate → edit → publish → new version → publish; published version immutable; one draft per family; name
change only before first publish; delete draft only; archive hides from `/templates` and clears default; defaults;
`POST /documents` with templateId (valid, draft, archived, wrong type) and default fallback; admin only.
**e2e**: admin duplicates the PRD, adds a section, publishes, sets it as default; a new PRD shows the added section.

## Acceptance

1. Duplicate a built-in, edit sections/guidance, publish as a new version; new documents use it; existing documents
   are unchanged.
2. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## Out of scope

Upgrading documents to a newer template version; template import/export; per-collection defaults; diff between
template versions; non-admin template authors; localized built-ins (PRD open question 4).
