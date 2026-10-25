# Spec — history-audit

Status: agreed 2026-10-25. Feature #10 (SPEC §11). Builds on `document`, `auth`, `sso`. Next: `custom-templates`.
Technical reference: SPEC §3 (`section_versions`, `audit_logs`), hard rules #7 and #8, PRD FR-070/071,
DESIGN §6 (right panel `Chat | History | Trace`, section action `History`), §2 (`/admin/audit`).

## Goal

Every section's versions can be browsed, compared with the current text and restored (a restore is a new version).
Every mutating endpoint writes an audit log row that admins can browse and filter.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| History UI | Right panel tab `History` (between Chat and Trace); the section header action `History` opens it on that section | DESIGN §6 |
| Diff | Line diff of markdown (existing LCS util) between the selected version and the section's **current** content | Human edits are versioned per session, so the latest version row can lag the current text |
| Restore | `POST /documents/:id/sections/:key/restore { versionId, revision }` → `saveSection` with the version's content, always a new version, `restored_from_revision` set; optimistic lock applies | FR-070; restore = new version (hard rule #7) |
| Restore marker | New column `section_versions.restored_from_revision int null`; UI "Restored from r3" | Origin visible in history; table stays append-only |
| Audit table | `audit_logs` with actor, action, target, metadata, ip, user agent; **trigger rejects UPDATE and DELETE** | Tamper resistance from the app; retention is a future, explicit migration |
| Actor | Session user, or an explicit `actorId` where there's no session yet (login, setup, invite accept, SSO) | Login rows must name who signed in |
| Secrets | `audit()` rejects metadata containing a secret-like key (same list as the logger's redaction): throws in tests, drops the key + logs a warning in production | Hard rule #3 |
| Failed sign-ins | `auth.login_failed` (email, no actor) and `auth.sso_denied` (provider, reason, email) | Investigations; volume bounded by the rate limit |
| Enforcement | `auditGuard` middleware: a 2xx response to POST/PUT/PATCH/DELETE without an `audit()` call (or `auditExempt(c, reason)`) throws in tests and logs a warning in production | Proves "every mutating endpoint" with the whole existing suite; new endpoints are covered automatically |
| Exempt | `POST /setup/verify-token` (read-only check before setup); everything else, including the "test" endpoints, is audited | Admin actions are worth recording |
| Write timing | After the mutation, outside its transaction | Rare failure mode (same DB) vs rewriting every route; documented |
| Retention | None | Out of scope |
| Coverage | The guard checks every mutating endpoint the test suite exercises; a static check (every POST/PUT/PATCH/DELETE handler calls `audit` or `auditExempt`) was done once by hand | The suite already drives nearly every endpoint |

## Data model (migration `0008_history_audit`)

- **section_versions** — add `restored_from_revision int null`.
- **audit_logs** — `id` (UUIDv7), `actor_id fk users` (no ON DELETE action: SET NULL is an UPDATE, which the
  trigger rejects; users are deactivated, never deleted), `action text`, `target_type text`,
  `target_id text null`, `metadata jsonb not null default '{}'`, `ip text null`, `user_agent text null`, `created_at`.
  Indexes: `created_at desc` (via id order), `(target_type, target_id)`, `actor_id`. Trigger `audit_logs_append_only`
  raising on UPDATE and DELETE (same pattern as `section_versions`). `truncateAll` (tests) still works (TRUNCATE
  doesn't fire row triggers).

## API

`lib/audit.ts`:
```ts
audit(c, { action, targetType, targetId, metadata?, actorId? }): Promise<void>   // inserts the row, marks c
auditExempt(c, reason: string): void
auditGuard(mode: "strict" | "warn"): MiddlewareHandler   // after next(): checks the mark
```
`AppConfig.strictAudit` (true in tests via `buildApp`, false in `main.ts`).

| Endpoint | Behavior |
|---|---|
| `GET /documents/:id/sections/:key/versions` | Existing; items gain `restoredFromRevision` |
| `POST /documents/:id/sections/:key/restore` | Edit access; `versionId` must belong to this section (else 404); stale `revision` → `409 revision_conflict` (same details as PUT); returns the section; audit `document.restore_section` { section, versionId, fromRevision } |
| `GET /admin/audit-logs?cursor&limit&action&actorId&from&to` | Admin only; newest first; `action` matches exact or prefix with `.` (e.g. `document`); items `{ id, action, actor: { id, name } \| null, targetType, targetId, target: { label, href } \| null, metadata, ip, createdAt }`; `nextCursor` |

Target labels resolve documents, collections, users, groups and providers in one batch per page (missing → id only).

Added/changed audit calls: `auth.login` / `auth.sso_*` / `instance.setup` / `invite.accept` with `actorId`;
`auth.login_failed`; `auth.sso_denied`; `llm_provider.test` (both test endpoints); `auth_provider.test`;
`document.restore_section`.

## `packages/shared`

`sectionVersion` gains `restoredFromRevision: number | null`. New `audit` subpath: `auditLogEntry`, `auditLogList`,
`auditLogQuery`, `restoreSectionRequest { versionId, revision }`.

## Web

- **History tab**: section select (defaults to the section opened from its header action); version list (revision,
  source badge AI / Edited / Restored from rN, author, relative time; "Current" row first); selecting a version shows
  the diff vs current (`--diff-add` / `--diff-del`) and, for editors, "Restore this version" (confirm) → section
  editor remounts with the restored content; conflict → message with reload.
- **Section header** action `History` (next to Revise).
- **Admin → Audit log** (`/admin/audit`, admin nav): filters (action prefix select built from known actions, actor
  select, date range), table (time, actor, action mono, target link, IP), row expands to pretty-printed metadata,
  "Load more".

## Tests

**api**: `audit()` writes actor/ip/metadata and uses `actorId` when given; secret-like metadata key → throws (strict);
append-only trigger rejects UPDATE and DELETE; **the whole suite runs with `strictAudit`**, so any un-audited 2xx
mutation fails; failed login and SSO denial rows; restore creates a new version with `restored_from_revision`, stale
revision → 409, version of another section → 404, viewer → 403; audit list admin-only, filters (action prefix,
actor, date range), cursor pagination, target labels.
**e2e**: edit a section twice in separate sessions, open History, diff shows the change, restore the first version,
section shows it; admin audit page lists `document.restore_section` and filters by `document`.

## Acceptance

1. SPEC §11 baseline: every mutating endpoint writes an `audit_logs` row (enforced by `auditGuard` in tests).
2. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## Out of scope

Retention / export of audit logs; document-level version numbers; diff between two arbitrary versions; side-by-side
diff; auditing GET requests or worker jobs.
