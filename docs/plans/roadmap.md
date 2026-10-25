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
| 14  | search           | 3     | [spec](spec-search.md)     | done   |

## Phase 4 backlog

Not specced or ordered yet; each becomes a feature with its own spec when picked.

| Item | Kind | Notes |
| ---- | ---- | ----- |
| Assistant proposes document updates from chat | Feature | When chat adds new information, offer updates to affected sections as diff + Accept |
| Inline requirement chips in the editor | Feature | Deferred in `traceability` (DESIGN §6.6) |
| Text-anchored comments, mentions / notifications, assigned reviewers | Feature | Deferred in `review` |
| Search stemming / fuzzy matching | Feature | Deferred in `search` |
| Upgrade documents to a newer template version | Feature | Deferred in `custom-templates` |

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
- **search** — permission-filtered title + full-text search with snippets, shared visibility scope, ⌘K command palette (documents, collections, admin pages, actions), /search page with type filter.
- **Phase 4: sidebar icons + pointer cursor** — lucide icons for navigation, collections (folder / open folder) and admin pages; global pointer cursor for interactive elements (Tailwind v4 preflight reset).
- **Phase 4: editor toolbar placement** — the formatting toolbar renders in the section heading row beside the section actions instead of covering them.
- **Phase 4: status change errors** — a dialog instead of `window.alert`; a blocked approval lists the sections with open threads and opens them in the Comments tab.
- **Phase 4: no native alert/confirm** — shared `ConfirmDialog` for deleting comments, discarding and leaving template drafts (router blocker with resolver), and section save / export retry errors.
- **Phase 4: read-only empty sections** — the dashed placeholder also shows read-only (viewers, approved documents) as "Not yet specified.", matching the export; the streaming preview has none.
- **Phase 4: smaller Docker image** — 1.49 GB → 965 MB: worker runtime files copied to `dist/assets` (Playwright is the only prod dependency, node_modules 217 → 14 MB); xvfb and the Mesa/LLVM it pulls in, and ffmpeg, removed from the Playwright layer (611 → 399 MB); fonts kept for CJK/emoji diagrams.
- **Phase 4: fixes and ops** — CI installs Chromium before unit tests and builds the Docker image; LLM requests rate-limited per user (60 / 10 min, `429 rate_limited`); "Fix with assistant" on diagrams that fail to render (`POST …/sections/:key/fix-diagram`, worker-verified); responsive document layout (icon outline at 1024–1279 px, one pane with tabs below); shortcuts `N`, `⌘\`, `[` / `]`; offline / server-down banner with save retry on reconnect; loading skeletons; README with deployment, backup and upgrade guide.
