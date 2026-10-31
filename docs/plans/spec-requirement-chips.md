# Spec — requirement-chips

Status: agreed 2026-10-31. Phase 4. Builds on `traceability` (deferred there: "Inline chips — TipTap decorations"),
`impact-retrieval` (needs review). UI reference: DESIGN §6.6.

## Goal

Requirement codes written in a section (`FR-003`, `↑ BR-002` in an Upstream column, a mention in prose) read as
chips: hover shows what they are, click opens the Trace panel on them. Nothing about the stored document changes.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Mechanism | A ProseMirror decoration plugin in the section editors; no new node or mark | Content whitelist, markdown serializer, export and history stay untouched |
| Data | The document's `traceQuery` (already loaded for the Trace panel and refreshed after every section save) | No backend change |
| Which codes | Only known ones: the document's own requirements and the upstream codes they cite (linked, restricted or missing as the trace resolved them). Other text matching the pattern stays plain | No false chips |
| Skipped text | Code blocks, inline code and Mermaid diagrams | Code is code |
| Variants | Own `FR-003` (status-partial marker when it needs review) · upstream `↑ BR-002` · restricted `↑ 🔒` · missing upstream `↑ BR-009` struck through | DESIGN §6.6; a cited code that doesn't exist upstream is worth seeing |
| Hover | Own: text, priority, cited upstream codes. Upstream: text and source document title. Restricted: the code (already in the text) and "Restricted document" — never its text or the source title. Missing: "Not found in the source document" | Restricted content never leaks |
| Click | Opens the Trace tab and scrolls to the requirement (own), or to the first own requirement citing it (upstream), with a brief highlight | DESIGN §6.6 |
| Where | Every section editor, editable or read-only (viewers, approved documents); not in diffs, streaming previews or exports | Exports already have the requirements appendix |
| Freshness | A newly typed code becomes a chip once autosave and the trace refetch land (≈ 1 s) | Index is derived from saved content (ADR 0003) |

## Web

- `lib/requirement-chips.ts`: `chipIndex(trace)` → `Map<code, Chip>` (`own | upstream | restricted | missing`, text,
  priority, document title, needsReview, `focus` = the own code the Trace panel should scroll to); `findCodes(text)`
  with `\b(?:BR|FR|NFR|TR)-\d{3,}\b`.
- `RequirementChips` TipTap extension: decorations from the index, recomputed on doc changes and when the index
  changes (transaction meta). Chips carry `data-req` for the tooltip and click handlers.
- `SectionEditor` receives the index; one tooltip component per document page listens on the editors (event
  delegation), so 13 editors share one popover.
- `TracePanel` takes `focusCode`; the row scrolls into view and flashes `--primary` for ~1.5 s.
- Styles: mono, `--radius-sm`, `--surface-2` background; reduced motion disables the flash.

## Tests

**web unit**: `chipIndex` from a trace response (own, linked, restricted, missing, needs review, focus of upstream
codes); `findCodes` (boundaries, 3+ digits, no partial matches like `XFR-001`). **e2e**: in the sample-free
traceability flow, a PRD's FR table shows chips; hovering an `↑ BR-` chip shows the BRD requirement text; clicking
an `FR-` chip opens the Trace tab on it; a member without BRD access sees `↑ 🔒` with no text.

## Out of scope

Chips in exports; autocomplete for codes while typing; chips linking across documents directly.
