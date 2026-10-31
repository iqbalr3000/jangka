# Spec — template-transfer

Status: agreed 2026-10-31. Phase 4. Builds on `custom-templates`, `template-create` (out of scope there: import /
export).

## Goal

Admins export a template version as a JSON file and import such a file as a new template, to share templates between
instances or keep them in a repository.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| File | `{ format: "jangka-template", formatVersion: 1, docType, name, sections }`; sections as in the template definition (key, title, required, guidance, interviewHints, requirementKind?, expectsDiagram?) | Self-describing; a version number lets later formats reject or convert old files |
| Privacy | No ids, instance name, users or timestamps in the file | Files leave the instance |
| Export | `GET /admin/templates/:id/export` → attachment `<name-slug>-v<version>.jangka-template.json`; any version, built-ins included. Row menu ⋯ → **Export** exports the latest published version; the editor's **Export** exports the open version | Same download pattern as document exports; editors can export a draft too |
| Import | **Import…** on the Templates page: pick a file → the browser parses it → dialog shows type, section count and an editable name (prefilled from the file) → `POST /admin/templates/import` → new family, **draft v1** → editor opens | Admin reviews before publishing, like New template |
| Validation | Server-side Zod on the whole file: format + version, doc type, name, ≤ 60 sections, key format, unique keys, requirement kinds allowed for the type; guidance may be empty (draft rules). Body limit 256 KB | Files from elsewhere are untrusted |
| Name clash | `409` with `details[name]`, shown on the dialog's name field | Same rule as create / duplicate |
| Keys | Kept as in the file | They're valid and stable; keeps a template recognisable across instances |
| Audit | `template.import` (`{ docType, name, sections }`); export is a read, not audited | Mutations only |

## API

- `packages/shared/templates`: `templateFile` (the file schema) and `importTemplateRequest { name, file: templateFile }`.
- `GET /admin/templates/:id/export` — admins; `Content-Disposition: attachment`, `application/json`.
- `POST /admin/templates/import` — admins; `bodyLimit` 256 KB (`413` beyond); `400 invalid_template` with paths for
  rule violations (`requirementKind` not allowed for the type, duplicate keys…); creates the draft through the same
  path as `POST /admin/templates`; returns `templateDetail` (`201`).

## Web

- Templates page header: **Import…** next to **New template**. A hidden file input (`.json`) opens the import dialog;
  a file that isn't JSON or isn't a Jangka template shows an error in the dialog instead of calling the server.
- Row menu: **Export** (disabled without a published version). Template editor header: **Export** for the open
  version as saved (unsaved edits aren't in the file).

## Tests

**api**: export → import round-trip yields the same sections as a new draft; export of a built-in; import rejects a
wrong `format`, an unknown `formatVersion`, a requirement kind not allowed for the type, duplicate keys and bad keys
(`400`), a taken name (`409`), a body over the limit (`413`); admin only; audit row. **e2e**: export a template from
the row menu (download), import the file under a new name, the editor opens with the same sections.

## Out of scope

Importing as a new version of an existing family; bulk export / import; exporting documents.
