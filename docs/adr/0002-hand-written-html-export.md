# 0002 — Hand-written HTML serializer for PDF export

Date: 2026-10-25. Status: accepted.

## Context

SPEC §8 planned TipTap JSON → HTML via `@tiptap/html`. Server-side, that package needs a DOM emulation and the same
extension list the web editor uses, which would have to be kept in sync by hand. Section content is already
restricted to a Zod whitelist (`packages/shared/document`), and `toMarkdown()` serializes exactly that whitelist.

## Decision

Write `toHtml()` in `packages/export` the same way as `toMarkdown()`: a switch over whitelisted nodes and marks that
escapes every text and attribute. No `@tiptap/html` dependency.

## Consequences

- No server DOM and no editor extensions in the worker; unknown nodes can't reach the output (schema rejects them).
- Adding a node type means updating the schema, `toMarkdown`, `toHtml` and `toDocx` together. Tests cover each node.
