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

## Releases

Notes per version in `docs/releases/`; how to cut one: `docs/releases/_release.md` (local only, gitignored).

| Version | Date | Kind | Notes |
| ------- | ---- | ---- | ----- |
| 1.0.0-rc.1 | 2026-11-03 | pre-release | [notes](../releases/v1.0.0-rc.1.md) — first public build: features 1–14 and the Phase 4 work below |

## Phase 4 backlog

Not specced or ordered yet; each becomes a feature with its own spec when picked.

| Item | Kind | Notes |
| ---- | ---- | ----- |
| Document page bundle size | Enhancement | Deferred. Chunk is 652 KB (200 KB gzip, 2026-11-03); Mermaid, elk, cytoscape and KaTeX are already lazy. ~75% is TipTap/ProseMirror core the page needs; the only real split (render read-only first, load the editor lazily) touches autosave and locking, not worth it yet. Cheap trims: autolink (`linkifyjs`), `marked` |

## Completed work

Cutoff: 2026-11-03

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
- **Phase 4: template-create** ([spec](spec-template-create.md)) — New template dialog (type buttons, blank or start from any published template with its section count), `POST /admin/templates`, drafts with no sections or empty guidance (required at publish); editor polish: collapsible section cards with chips and issue counts, insert between cards, sticky header with ⌘S, requirement-section note; default border colour fix for dialogs/dropdowns and bounded dialog grid for long model names.
- **Phase 4: editor & chat polish** ([spec](spec-editor-chat-polish.md)) — composer free at `reply_done` (coverage runs unlocked, stale coverage dropped), smooth typing reveal and thinking state, Notion-like block gutter (`+`, `⋮⋮` menu), bubble formatting menu, `/` slash commands, no forced trailing paragraph.
- **Phase 4: brand** — SVG mark and app icons (light / dark / alt), PNG logo lockups, favicon (SVG following the OS scheme, ICO, apple-touch-icon), wordmark Λ as inline SVG, README rewrite with logo, features, layout and docs index.
- **Phase 4: chat-updates** ([spec](spec-chat-updates.md)) — the post-reply assessment suggests up to 3 sections with content that the chat adds facts to or contradicts; "This may change N sections" chip with Review updates / Dismiss; `POST /documents/:id/propose-updates` streams conversation-aware revisions as per-section diffs (`proposal_ready`), each suggestion cleared once its proposal is ready; facts-only revise prompt with the transcript.
- **Phase 4: template-upgrade** ([spec](spec-template-upgrade.md)) — documents move to the newest published version of their template family from a banner with a preview (added / retired / renamed sections, requirement changes); content never changes, dropped sections stay as retired rows ("Removed from template", hidden once empty) outside completeness, drafting, LLM context and the requirements index; generation lock shared via `RouteDeps`.
- **Phase 4: llm-usage** ([spec](spec-llm-usage.md)) — `llm_usage` records every LLM pipeline run (structured calls and retries included, via `ChatRequest.onUsage`) with user, document, model and operation, backfilled from chat messages; Admin → Usage with period totals, stacked daily input/output bars and breakdowns by model, user, operation and top documents.
- **Phase 4: collection-pagination** ([spec](spec-collection-pagination.md)) — `GET /collections/:id/documents` with a keyset cursor on `(updated_at, id)` and a partial index; `/items` no longer carries documents; Load more with the total in the list heading; 5,000 documents in one collection: p95 144 → 9.8 ms.
- **Phase 4: sample-documents** ([spec](spec-sample-documents.md)) — a linked "Refund self-service" BRD → PRD → TSD (requirement tables citing upstream codes, five Mermaid diagrams) seeded into an Examples collection everyone can view; setup checkbox (on by default, failures don't block setup) and an admin ⌘K action (`POST /admin/samples`).
- **Phase 4: template-transfer** ([spec](spec-template-transfer.md)) — export any template version as a `jangka-template` JSON file (no ids or instance data); import validates it server-side (256 KB limit, requirement-kind rules) and creates a draft v1 of a new family; Import… dialog with an editable name, Export in the row menu and the editor.
- **Phase 4: requirement-chips** ([spec](spec-requirement-chips.md)) — requirement codes in section text render as chips (own, `↑` upstream, restricted, missing) via a TipTap decoration plugin fed by the trace data; one shared tooltip that follows the chip; click opens the Trace tab on the requirement with a highlight; no change to content, export or backend.
- **Phase 4: search-stemming** ([spec](spec-search-stemming.md)) — `document_sections.search` combines simple, English and Indonesian lexemes (migration 0014); search and chat retrieval match each word as a prefix or either stem via a shared `stemmedQuery`; typo-tolerant titles with `pg_trgm`, enabled at boot when allowed; perf check budgets a selective search (p95 ≈ 116 ms on 5,000 documents). *Correction: that query matched every section; see search-ranking.*
- **Phase 4: notifications** ([spec](spec-notifications.md)) — in-app notifications (migration 0015) for @mentions, replies, resolved threads and status changes, filtered by view access at creation and on read, ids only with excerpts read fresh, 90-day purge on list load; top-bar bell with polled unread count and a panel that lands on the thread; `@` suggestions in the comment composer limited to people who can view the document, mentions rendered as chips.
- **Phase 4: assigned-reviewers** ([spec](spec-assigned-reviewers.md)) — editors assign reviewers who can view the document (migration 0016); reviewers approve or request changes while in review, and approval waits for every active reviewer with access (`409 pending_reviews`); back to draft clears verdicts; `review_requested` / `review_verdict` notifications; header avatars with a manage popover and verdict buttons; sidebar Reviews page with a count.
- **Phase 4: text-anchored-comments** ([spec](spec-text-anchored-comments.md)) — root comments can point at selected words via a quote with prefix/suffix context (migration 0017), no change to section content; Comment in the formatting menu and a read-only bubble; open threads highlight their words, clicking opens the thread; detached quotes show "Original text changed".
- **Phase 4: search-ranking** ([spec](spec-search-ranking.md)) — content matches still require every word (AND) but are ranked with the OR form of the query, avoiding `ts_rank`'s quadratic AND scoring; queries matching all 60k+ sections drop from p95 ≈ 1.2 s to ≈ 140 ms (2 words) / ≈ 170 ms (3 words); perf now budgets a truly selective query and the broad ones.
- **Phase 4: fixes** — Usage chart day tooltips align to the chart edge near the first and last bars instead of being cut off; before any chat, the coverage checklist reads section completeness, so example documents no longer show "COVERAGE 0/12" (display only; the draft gate still reads the stored assessment — revised after the 2026-11-01 review).
- **Phase 4: release pipeline** — tag-triggered `release.yml`: CI, semver + notes-file checks, amd64 smoke test (health, web app, Chromium), multi-arch (`linux/amd64`, `linux/arm64`) images on Docker Hub `iqbalr3000/jangka` and GHCR, draft GitHub Release (pre-release for `-rc`); compose file uses the published image via `JANGKA_VERSION`; release guide and notes template in `docs/releases/`. First release: **v1.0.0-rc.1** (2026-11-03).
