# Spec — sample-documents

Status: agreed 2026-10-31. Phase 4. Builds on `auth` (setup wizard), `access`, `document`, `traceability`, `search`
(command palette). Supports the launch / demo goal (PRD §3).

## Goal

A fresh install shows what finished specs look like: a linked BRD → PRD → TSD about one feature, with requirement
IDs, trace links and diagrams, readable by every user. Admins can add the same set later.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Content | One chain about "Refund self-service": BRD (`BR-`), PRD from the BRD (`FR-`/`NFR-` citing `BR-` codes, a flowchart), TSD from the PRD (`TR-` citing `FR-`/`NFR-`, a sequence diagram and an ERD) | Shows trace, requirement IDs, diagrams and export at once |
| Source | Static markdown per section key in a TypeScript module, `packages/templates/src/samples/refund-self-service.ts` (Mermaid via a small helper, no escaping) | Deterministic and reviewable; no heading parser and no `.md` assets to ship with the API and worker builds |
| Language | English | Built-in templates are English (PRD open question 4) |
| Location | New root collection **Examples** with an **All Users → View** grant; documents are drafts, created by the acting admin | Members see the examples without any setup; archiving one collection removes them |
| Templates | Latest built-in BRD, PRD and TSD; every template section gets content | Shows complete documents |
| Writes | Sections stored as the admin's revision-1 human versions, requirements indexed, source links set, all in one transaction; one audit row `samples.create` (collection id, document ids) | Same data as a written document; one action, one row |
| Triggers | Setup wizard: "Add example documents" checkbox on the Organization step, checked by default. Command palette (admins): "Add example documents" | New installs get them; existing ones can too |
| Setup coupling | Seeded after the setup transaction commits; a failure is logged and setup still succeeds | Examples are a nicety; setup must not fail because of them |
| Repeat | Allowed; each run creates a new "Examples" collection (named "Examples 2", … when the name is taken at root) | Simple; the result is obvious and archivable |

## `packages/templates`

- `sampleDocuments: { docType, title, sections: Record<sectionKey, markdown> }[]` (BRD, PRD, TSD in source order) and
  `latestBuiltinTemplate(docType)`. Tests check the keys against the latest built-in templates.

## API

- `services/samples.ts`: `createSampleDocuments(db, { userId })` → `{ collectionId, documentIds }`. In one
  transaction: collection, grant, documents (TSD source = PRD, PRD source = BRD), sections (`fromMarkdown`), then the
  requirements index per requirement section. Test setups pass `examples: false` unless they test samples.
- `POST /setup` request gains `examples?: boolean` (default `true`); after `completeSetup`, the samples are created for
  the new admin (errors logged).
- `POST /admin/samples` (admins) → `201 { collectionId }`.

## Web

- Setup wizard, Organization step: checkbox "Add example documents (a linked BRD, PRD and TSD)".
- Command palette, admins: action "Add example documents" → calls the endpoint, then opens the new collection.

## Tests

**templates**: every sample heading maps to a section of the latest built-in template; every section has content;
requirement tables parse (`extractRequirements`) with the expected prefixes and upstream codes that exist in the
source sample. **api**: setup with examples creates the collection, grant and three linked documents; a member sees
them; trace from the TSD resolves to PRD and BRD requirements; `examples: false` creates none; a seeding failure
doesn't fail setup; `POST /admin/samples` admin only, repeat run names "Examples 2"; audit rows. **worker**: all five sample
diagrams render. **e2e**: onboarding sees the checkbox checked and unchecks it (other specs expect an empty
instance); an admin adds the examples from ⌘K, the collection shows three documents, the TSD's Trace panel lists
linked requirements, then the spec archives the collection so later specs' searches don't match it.

## Out of scope

Sample chat history; localized samples; removing samples automatically.
