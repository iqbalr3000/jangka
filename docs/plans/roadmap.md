# Jangka — Roadmap

Built per feature, in order. Scope and baseline acceptance per feature: `docs/SPEC.md` §11.
Status: `todo` → `spec` (spec written) → `building` → `done` (confirmed by Iqbal).

| #   | Feature          | Phase | Spec                       | Status |
| --- | ---------------- | ----- | -------------------------- | ------ |
| 1   | foundation       | 1     | [spec](spec-foundation.md) | done   |
| 2   | auth             | 1     | [spec](spec-auth.md)       | done   |
| 3   | access           | 1     | [spec](spec-access.md)     | done   |
| 4   | llm-providers    | 1     | [spec](spec-llm-providers.md) | done   |
| 5   | document         | 1     | [spec](spec-document.md)   | done   |
| 6   | assistant        | 1     | [spec](spec-assistant.md)  | building |
| 7   | export           | 1     | —                          | todo   |
| 8   | traceability     | 2     | —                          | todo   |
| 9   | sso              | 2     | —                          | todo   |
| 10  | history-audit    | 2     | —                          | todo   |
| 11  | custom-templates | 3     | —                          | todo   |
| 12  | review           | 3     | —                          | todo   |
| 13  | impact-retrieval | 3     | —                          | todo   |
| 14  | search           | 3     | —                          | todo   |

## Completed work

Cutoff: 2026-10-24

- **foundation** — monorepo, env validation, crypto util, Drizzle base, error shape, `audit()` no-op, Docker image + compose, SPA shell + design tokens.
- **auth** — setup wizard (token + advisory lock), password login, rolling sessions, CSRF origin check, `/auth/me`, invite + password-reset links, admin users page, Playwright e2e.
- **access** — `packages/permissions` resolver, groups + membership, collection tree with personal collections, archive/restore, grants, permissions matrix + access check, collection-based e2e.
- **llm-providers** — `packages/llm` adapters (Anthropic, OpenAI-compatible, Gemini, fake) with streaming, structured output and normalized errors; encrypted provider keys, test + model listing, default model, admin page, setup wizard LLM step, key-leak check.
- **document** — PRD template, TipTap content whitelist + markdown serializer, documents/sections/append-only versions (DB trigger), session versioning, optimistic locking with conflict UI, per-section editors with autosave, Mermaid blocks, document lists and counts.
