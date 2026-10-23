# Spec — auth

Status: agreed 2026-10-23. Feature #2 (SPEC §11). Builds on `foundation`. Next: `access`.
UI reference: `docs/design/Jangka Mockups.dc.html` — 1d (setup), 1h (login, password part only), 1e (admin layout).

## Goal

A fresh instance can be set up from the browser with the token from the logs, the admin lands logged in,
users sign in with email + password, and admins onboard users with single-use links. Every later feature
gets `c.var.auth` (current user + admin flag) and the shell shows real user/org data.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Password hashing | Node built-in `crypto.argon2` (argon2id, m=19456 KiB, t=2, p=1), PHC string `$argon2id$v=19$m=…,t=…,p=…$salt$hash` | No native dep, api bundle stays self-contained; PHC format allows switching implementation without migration. API is experimental in Node 24 — isolated in `packages/shared/crypto` and covered by tests |
| User onboarding | Single-use links only (7 days), copied by the admin. Same mechanism resets passwords. No temporary passwords | No SMTP in Jangka; one mechanism covers invite + forgotten password; avoids a forced-password-change flow |
| Setup token | Regenerated on every boot while setup is incomplete; written straight to stdout, not via the logger | Lost logs never lock the admin out. Printing it is the only sanctioned exception to hard rule #3 |
| Setup end | `POST /setup` sets the session cookie | Admin lands logged in |
| Setup gate cache | "completed" cached in memory once true; "not completed" re-checked in DB | Completion is irreversible, so caching it is safe across replicas |
| Session expiry | Rolling; extended only when last extension > 1 day ago | No DB write per request |
| Rate limit key | `ip|email`, IP from the socket | Behind a proxy it degrades to per-email, which still protects accounts. `TRUST_PROXY` only if needed later |
| Admin users page scope | List users, invite, pending invites (revoke), deactivate/reactivate, reset link | Group membership UI belongs to `access` |
| E2E | Playwright set up here | First real user flow |

## Data model (migration `0000`)

Only columns needed now; later features add theirs. All ids UUIDv7 (`.$defaultFn(uuidv7)`), timestamps `timestamptz`.

- **instance_settings** — `id int pk default 1, check (id = 1)`, `org_name text null`, `setup_completed_at null`,
  `setup_token_hash text null`, `created_at`, `updated_at`.
- **users** — `email text unique not null` with `check (email = lower(email))`, `name text not null`,
  `password_hash text null`, `is_active bool default true`, `last_login_at null`, timestamps.
- **sessions** — `token_hash text unique`, `user_id fk users on delete cascade`, `expires_at`, `ip text null`,
  `user_agent text null`, timestamps (`updated_at` = last rolling extension).
- **groups** — `name text unique`, `system_key text unique null` (`admins` | `all_users`), timestamps.
- **group_members** — `group_id fk cascade`, `user_id fk cascade`, pk(group_id, user_id), `created_at`.
  Membership in `all_users` is implicit (no rows).
- **invites** — `kind text` (`invite` | `password_reset`), `email text not null` (lowercased),
  `user_id fk null` (set for `password_reset`), `token_hash text unique`, `created_by fk users`,
  `expires_at` (7 days), `used_at null`, `created_at`.

## `packages/shared`

**`crypto.ts`** (tests first) — stays the only crypto module (hard rule #4):
```ts
hashPassword(password: string): Promise<string>                    // PHC argon2id, 16-byte random salt
verifyPassword(password: string, stored: string): Promise<boolean> // false on mismatch or malformed hash
generateToken(): string        // 32 random bytes, base64url
hashToken(token: string): string  // sha256 hex — for session / invite / setup tokens
```
**`env.ts`** — add `SESSION_TTL_DAYS` (int, default 30).
**`errors.ts`** — add codes: `setup_required` (409), `setup_completed` (409), `invalid_setup_token` (403),
`invalid_credentials` (401), `rate_limited` (429), `invite_invalid` (410).
**`auth.ts`** (new subpath, used by api + web) — Zod schemas:
- `passwordSchema`: string 12–256 chars. `emailSchema`: trimmed, lowercased email.
- `setupStatusResponse { completed: boolean }`, `verifySetupTokenRequest { token }`,
  `setupRequest { token, orgName (1–100), adminName (1–100), adminEmail, password }`
- `loginRequest { email, password }`
- `meResponse { user: { id, name, email, isAdmin }, org: { name, host } }`
- `inviteInfoResponse { kind, email, orgName, name: string | null }`,
  `acceptInviteRequest { name?, password }` (name required for `invite`, ignored for reset)
- admin: `adminUser { id, name, email, isAdmin, isActive, lastLoginAt }`, `adminUserList { items, nextCursor }`,
  `createInviteRequest { email }`, `inviteLinkResponse { url, expiresAt }`,
  `pendingInvite { id, email, createdAt, expiresAt }`, `updateUserRequest { isActive }`

## API

Hono app gets typed variables: `auth: { user: { id, name, email, isAdmin }, sessionId } | null`.

**Middleware order** (all `/api/v1`): requestId → request log → CSRF → setup gate → session.
- **CSRF**: `POST/PUT/PATCH/DELETE` require `Origin` equal to `PUBLIC_URL`'s origin, else `403 forbidden`.
- **Setup gate**: until completed, everything except `/health` and `/setup/*` → `409 setup_required`.
- **Session**: reads cookie `jangka_session`, looks up `sha256(token)` joined with an active user and `expires_at > now`.
  Expired rows are deleted on sight. If `updated_at` is older than 1 day: extend `expires_at = now + TTL`, re-set cookie.
  Cookie: `HttpOnly; SameSite=Lax; Path=/; Max-Age=TTL`, `Secure` when `PUBLIC_URL` is https.
- Helpers: `requireAuth` (401 `unauthorized`), `requireAdmin` (403 `forbidden`).

**Boot** (`main.ts`, after migrations): `ensureSetupToken` — if setup incomplete, generate `jk_setup_<43 chars>`,
store hash, write `SETUP TOKEN: <token>` to stdout in a framed block. Runs on every boot until setup completes.

| Endpoint | Auth | Behavior |
|---|---|---|
| `GET /setup/status` | — | `{ completed }` |
| `POST /setup/verify-token` | — | 204 if the token matches, else `403 invalid_setup_token`; `409 setup_completed` after setup |
| `POST /setup` | — | Tx + `pg_advisory_xact_lock`: verify token, verify not completed, seed system groups (`Administrators`, `All Users`), create user, add to admins, set org name + `setup_completed_at`, clear token hash. Creates session + cookie. `201 meResponse`. Concurrent second call → `409 setup_completed` |
| `POST /auth/login` | — | Rate limit 10 / 15 min per `ip|email` → `429 rate_limited`. Unknown email, wrong password, inactive user, or null password hash → `401 invalid_credentials` "Email or password is incorrect"; unknown email still runs a verify against a dummy hash. Success: reset counter, update `last_login_at`, create session, `200 meResponse` |
| `POST /auth/logout` | user | Delete session, clear cookie, 204 |
| `GET /auth/me` | user | `meResponse`; `org.host` from `PUBLIC_URL` |
| `GET /invites/:token` | — | Valid (unused, unexpired, user still active for reset) → `inviteInfoResponse`; else `410 invite_invalid` |
| `POST /invites/:token/accept` | — | Tx: lock invite row, re-validate. `invite`: create user (409 `conflict` if email now taken). `password_reset`: set password hash, delete the user's sessions. Mark used, create session + cookie, `200 meResponse` |
| `GET /admin/users?cursor=&limit=` | admin | Cursor by id (UUIDv7 order), default 50, max 200 |
| `POST /admin/invites` | admin | Email already a user → `409 conflict`. Returns `inviteLinkResponse` (`${PUBLIC_URL}/invite/<token>`) — the raw token is never stored or shown again |
| `GET /admin/invites` | admin | Pending (`kind = invite`, unused, unexpired) |
| `DELETE /admin/invites/:id` | admin | Revoke, 204 |
| `POST /admin/users/:id/reset-link` | admin | Expires the user's previous unused reset links, returns `inviteLinkResponse` |
| `PATCH /admin/users/:id` | admin | `{ isActive }`. Deactivating deletes all sessions. Cannot deactivate yourself → `409 conflict` (this also guarantees an active admin always remains) |

Every mutating endpoint calls `audit()`.

**Rate limiter**: in-memory fixed window `Map<key, { count, resetAt }>`, max 10 000 keys (oldest evicted).

## Web

Routes (TanStack file-based):
- `__root.tsx` — router context `{ queryClient }`, renders `<Outlet />` only.
- `setup.tsx` — redirects to `/` if completed. Wizard per 1d: wordmark 28 px, stepper (Token → Organization → Admin;
  LLM step added by `llm-providers`), 480 px card. Token step: mono input, `docker logs jangka | grep "SETUP TOKEN"`
  with Copy, validates via `verify-token` before advancing. Admin step: name, email, password + confirm (client-side match).
- `login.tsx` — per 1h without SSO buttons: wordmark 24 px, tagline, error banner (`--diff-del` bg, `--danger` text),
  email, password, Sign in. Honors `?redirect=`.
- `invite.$token.tsx` — loads invite info. `invite`: "Join {org}", email (read-only), name, password + confirm →
  "Create account". `password_reset`: "Set a new password". Invalid → message + link to login.
- `_app.tsx` — pathless layout. `beforeLoad`: setup status (→ `/setup`), `me` (401 → `/login?redirect=`).
  Renders `AppShell` with user + org; sidebar is the admin nav under `/admin`.
- `_app/index.tsx` — home (moved).
- `_app/admin.tsx` — non-admin → redirect `/`. `_app/admin/users.tsx` — header per 1e ("Admin" / "Users & invites"),
  users table (name, email, role, status, last login, row menu: Copy reset link, Deactivate/Reactivate),
  "Invite user" dialog → shows the link once with Copy, pending invites list with Revoke.
- Account menu: Admin panel → `/admin/users`; Sign out → logout, clear query cache, `/login`.
- Public pages use the blueprint grid (8 px minor + 40 px major lines, as in the mockups).

shadcn components added: `button`, `input`, `label`, `dialog`.

## Tests

**crypto** (first): hash/verify round-trip; wrong password false; malformed stored hash false; PHC format and params;
salts differ; `hashToken` deterministic; `generateToken` unique, 43 chars base64url.

**setup** (first): boot prints token and stores only its hash; token regenerated on each boot while incomplete; nothing
printed after setup; gate returns `409 setup_required` for `/auth/me` before setup, health still 200; verify-token
right/wrong; `POST /setup` creates admin in `admins`, sets cookie, `/auth/me` works with it, gate opens; second call
`409 setup_completed`; two concurrent calls → exactly one 201.

**session / login** (first): login sets cookie, `/me` works; wrong password and unknown email → same 401 body;
inactive user 401; email case-insensitive; 11th failed attempt → 429; success resets counter; expired session → 401
and row deleted; session older than 1 day → `expires_at` extended + cookie re-set; logout deletes row.

**csrf**: mutating request without / with wrong `Origin` → 403; GET without `Origin` OK.

**invites / admin**: non-admin → 403 on admin routes; invite → accept creates user (not admin) and logs in; reuse → 410;
expired → 410; invite for existing email → 409; reset link → accept sets new password, old sessions gone, old password
fails; new reset link expires the previous one; deactivate removes sessions and blocks login; cannot deactivate self; revoke invite → 410; users list paginates with cursor.

**e2e** (Playwright, root `e2e/`): fresh database → start built app → read token from server output → setup wizard →
lands on home with org name → sign out → sign in. Admin invites a user → open link in new context → create account → home.

## Acceptance

1. Baseline from SPEC §11: fresh machine → token in logs → setup → login → empty home; concurrent setup fails one request.
2. All tests above green; `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass; CI runs e2e.
3. No password, hash, session token, invite token, or setup token appears in API responses (other than the one-time
   invite URL) or request logs.

## Out of scope

SSO and disabling password login (→ `sso`); groups CRUD and membership UI (→ `access`); LLM setup step (→ `llm-providers`);
audit persistence (→ `history-audit`); profile & preferences page.
