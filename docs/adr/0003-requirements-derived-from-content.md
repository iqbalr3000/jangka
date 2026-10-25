# 0003 — Requirements derived from section content; links as upstream codes

Date: 2026-10-25. Status: accepted.

## Context

SPEC §6.2 planned LLM extraction of requirements after drafting, and §3 a `requirement_links` table. Sections are
edited by hand too (autosave), so an LLM-built index goes stale on the first manual edit, and running the LLM per save
is costly and non-deterministic. Stored link rows also go stale when the upstream document changes after the link was made.

## Decision

- Requirement sections hold a table `ID | Requirement | Priority | Upstream`. Every section save parses it
  deterministically (`extractRequirements`) and rewrites the `requirements` index in the same transaction.
- Links are the codes in the Upstream column, stored as `requirements.upstream_codes` and resolved against the
  source document's requirements when read. There is no `requirement_links` table.

## Consequences

- The document is the single source of truth; the index can always be rebuilt from content.
- A requirement exists only if its row follows the table convention; rows without a valid code aren't tracked.
- Resolution happens per read (one query on the source document's requirements); fine for document-sized data.
- `impact-retrieval` finds downstream requirements by code (`upstream_codes @> {code}`) instead of link rows.
