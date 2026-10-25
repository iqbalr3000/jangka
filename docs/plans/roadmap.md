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
| 6   | assistant        | 1     | [spec](spec-assistant.md)  | done   |
| 7   | export           | 1     | [spec](spec-export.md)     | done   |
| 8   | traceability     | 2     | [spec](spec-traceability.md) | done   |
| 9   | sso              | 2     | [spec](spec-sso.md)        | done   |
| 10  | history-audit    | 2     | [spec](spec-history-audit.md) | done   |
| 11  | custom-templates | 3     | [spec](spec-custom-templates.md) | done   |
| 12  | review           | 3     | [spec](spec-review.md)     | done   |
| 13  | impact-retrieval | 3     | [spec](spec-impact-retrieval.md) | done   |
| 14  | search           | 3     | [spec](spec-search.md)     | building |

## Completed work

Cutoff: 2026-10-25

- **foundation** — monorepo, env validation, crypto util, Drizzle base, error shape, `audit()` no-op, Docker image + compose, SPA shell + design tokens.
- **auth** — setup wizard (token + advisory lock), password login, rolling sessions, CSRF origin check, `/auth/me`, invite + password-reset links, admin users page, Playwright e2e.
- **access** — `packages/permissions` resolver, groups + membership, collection tree with personal collections, archive/restore, grants, permissions matrix + access check, collection-based e2e.
- **llm-providers** — `packages/llm` adapters (Anthropic, OpenAI-compatible, Gemini, fake) with streaming, structured output and normalized errors; encrypted provider keys, test + model listing, default model, admin page, setup wizard LLM step, key-leak check.
- **document** — PRD template, TipTap content whitelist + markdown serializer, documents/sections/append-only versions (DB trigger), session versioning, optimistic locking with conflict UI, per-section editors with autosave, Mermaid blocks, document lists and counts.
- **assistant** — interview chat with coverage checklist, per-section drafting with live streaming, revise with inline diff + undo, SSE with abort, context budget, usage tracking.
- **export** — worker app + pg-boss + `APP_ROLE`, sandboxed Chromium diagram render cache, LLM diagram fix loop in draft/revise, PDF + DOCX with cover page and page numbers, export API with 24h expiry, export dialog + toast, Docker image with Playwright.
- **traceability** — BRD/PRD v2/TSD templates, requirement index derived from section tables, source documents (PRD ← BRD, TSD ← PRD) with source-aware LLM context and Draft from source, trace API + Trace panel with restricted links, requirements appendix in exports.
- **sso** — runtime OIDC providers (Google preset + generic), PKCE flow with encrypted state cookie and single callback URI, SPEC §5 account linking + auto-provision + domain rules, lockout guards + FORCE_PASSWORD_LOGIN, Authentication admin page, SSO login buttons.
- **history-audit** — append-only audit_logs with real audit() writes and a guard that fails un-audited mutations in tests, failed sign-in auditing, section restore as a new marked version, History panel with diff, admin audit log viewer.
- **custom-templates** — template drafts and immutable published versions, custom validation (requirement kinds per type, stable keys), prompt-level requirement table rule, admin lifecycle API + Templates page and editor, per-type default template, Template picker in New document.
- **review** — section comment threads (view-level commenting, one level of replies, soft delete, resolve), status workflow draft → in review → approved with open-thread gate and approval lock on all section writes, status menu, approved banner, Comments panel and section badges.
- **impact-retrieval** — needs-review flags from upstream content changes with Mark reviewed, permission-filtered full-text retrieval for chat with stored references, table-cell save fix, Turbo transit invalidation.
