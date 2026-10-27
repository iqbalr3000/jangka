# Spec — template-upgrade

Status: agreed 2026-10-27. Phase 4. Builds on `custom-templates` ([spec](spec-custom-templates.md)),
`traceability` (requirements index, ADR 0003), `assistant` (interview state), `review` (approval lock).

## Goal

A document pinned to an older version of its template can move to the newest published version of the same
template family. An editor sees what changes first, then upgrades in one step. Section content is never changed or
dropped.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Scope | Newest published version of the **same family** (same doc type and name), only if the family isn't archived | Keys are stable within a family; across families the same key may mean something else |
| Trigger | Per document, by an editor, from a banner on the document; no bulk upgrade | Each document gets its own preview; bulk would skip it |
| Content | Existing sections keep their content, revision and history; new template sections are added empty | Upgrading changes structure, never text |
| Removed sections | A section whose key isn't in the new template is **retired**: kept, shown after the template's sections with a "Removed from template" badge while it has content, hidden once empty. No deletion | `section_versions` is append-only and references sections without cascade; no migration needed |
| Retired title | Humanized key (`open_questions` → "Open questions") | The old template isn't consulted after the upgrade |
| Retired behaviour | Editable (to move or clear content), included in export and search; excluded from completeness counts, drafting, coverage, suggestions and the requirements index | They hold the user's text, not the template's structure |
| Requirements | The index is rebuilt for the new template's requirement sections; rows of sections that lost their kind (or were retired) are deleted, so downstream citations show as unresolved / needing review as today | ADR 0003: the index is derived from content + template |
| Interview state | Kept per key for the new template's sections; new keys start `missing`; suggestions for keys that are no longer content sections of the template are dropped | Coverage stays meaningful without an LLM call |
| Guard | Edit access; not approved (`409 document_approved`); not while the assistant works on the document (`409 generation_in_progress`); the target must still be the newest version (`409 conflict` "The template changed; review the upgrade again") | Approval lock; a draft writes sections by key; preview must match what's applied |
| Downgrade | Not supported | Content is untouched and the upgrade is audited |

## `packages/shared` (`document`)

- `section` gains `retired: boolean`.
- `documentDetail` gains `templateUpgrade: { templateId, version } | null` (newest published, non-archived version of
  the family when newer than the document's; `null` otherwise or for viewers).
- `templateUpgradePreview { from: { templateId, name, version }, to: { templateId, name, version },
  added: { key, title }[], retired: { key, title, hasContent }[], renamed: { key, from, to }[],
  requirementChanges: { key, title, from: RequirementKind | null, to: RequirementKind | null, requirementCount }[] }`.
- `upgradeTemplateRequest { templateId }`.

## API

| Endpoint | Behavior |
|---|---|
| `GET /documents/:id` | Adds `templateUpgrade`; sections include retired ones (`retired: true`) after the template's, empty retired ones omitted |
| `GET /documents/:id/template-upgrade` | Edit access. The preview against the newest version; `409 conflict` when there is none |
| `POST /documents/:id/template-upgrade` `{ templateId }` | Guards above. One transaction: set `template_id`; insert empty sections for added keys; positions = new template order, then retired sections in their previous order; rebuild the requirements index (`indexRequirements` for requirement sections, delete rows for the rest); normalize the interview state. Audit `document.template_upgrade` `{ from, to }`. Returns `documentDetail` |

The generation lock moves from the assistant routes into `RouteDeps` (`locks: GenerationLocks`) so the upgrade can
take it for the duration of the transaction.

Retired sections are skipped by: completeness counts (document lists, outline "N of M complete"), Draft all and
section drafting (`404` for a retired key), coverage / suggestions, `propose-updates`, and `indexRequirements`.
Export renders them after the template's sections under their humanized titles.

## Web

- **Banner** as a strip under the document header, like the approved / view-only notices (editors, not approved):
  "A newer version of this template is available (v3). · Review upgrade". Upgrade is disabled while the assistant
  runs in this tab.
- **Upgrade dialog**: from → to; lists added sections, retired sections (with "keeps its content" when it has some),
  renamed sections, and requirement changes with a warning ("FR-001…FR-012 leave the requirements index; documents
  citing them will show them as missing"). **Upgrade** / Cancel. After success the document reloads.
- **Retired sections**: "Removed from template" badge in the section heading and the outline; no Draft / Revise
  actions; left out of the outline's "N of M complete", the coverage checklist and `@` mentions; an emptied retired
  section disappears on reload.

## Tests

**api**: preview lists added / retired / renamed / requirement changes; upgrade keeps content and revisions, adds
empty sections, orders by the new template with retired ones last, rebuilds the index (a section losing its kind
drops its requirements); interview state keeps coverage per key and adds new keys as missing; retired sections are
excluded from completeness and drafting, kept in export; empty retired sections are hidden; guards (viewer `403`,
approved `409`, running generation `409`, stale target `409`, no newer version `409`); audit row; built-in PRD v1 →
v2 upgrade.
**e2e**: admin publishes v2 of a custom PRD with one section added and one removed; on a v1 document the banner
appears, the dialog lists both changes, Upgrade adds the empty section and shows the removed one with its badge.

## Acceptance

1. A document on an older version shows the banner; the preview matches what the upgrade does; after upgrading,
   no section content changed and nothing was deleted.
2. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## Out of scope

Bulk upgrade; switching to another template family; downgrade; carrying retired content into a chosen section
automatically.
