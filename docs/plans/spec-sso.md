# Spec — sso

Status: agreed 2026-10-25. Feature #9 (SPEC §11). Builds on `auth`, `access`. Next: `history-audit`.
Technical reference: SPEC §3 (`auth_providers`, `user_identities`, `instance_settings`), §5 (OIDC SSO), §9,
PRD FR-060–063, NFR-002/003, DESIGN §6.10. CLAUDE.md: tests first for OIDC account linking.

## Goal

Admins add Google or any OIDC provider at runtime. Users sign in with "Continue with …"; identities link to existing
accounts by subject, or by verified email, or are auto-provisioned when the provider allows it. Domains can be
restricted per provider. Password login can be turned off once SSO works for an admin, with an env escape hatch.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Library | `openid-client` v6; discovery from `issuer`, cached in memory per provider (keyed by `id` + `updated_at`, 1 h TTL) | SPEC §5; no restart when providers change |
| Callback URI | One URI for every provider: `${PUBLIC_URL}/api/v1/auth/oidc/callback`; the provider comes from the flow cookie | Admins must register the redirect URI with the IdP before they have client credentials, i.e. before the provider exists in Jangka (SPEC §5 had a per-provider URI) |
| Flow state | `state`, `nonce`, PKCE verifier, provider id, redirect and expiry (10 min) in cookie `jangka_oidc`, encrypted with `encryptSecret` (AES-256-GCM, `MASTER_KEY`); `HttpOnly`, `SameSite=Lax`, path `/api/v1/auth/oidc`, `Secure` on https | GCM gives integrity too: no new crypto (hard rule #4), no table |
| Callback CSRF | GET callback is exempt from the Origin check by method; protected by `state` + the flow cookie | Top-level redirect from the IdP |
| Domains | Email domain, and Google `hd`, must be in `allowed_domains` when it isn't empty (a Google account without `hd` is refused then); checked before linking, also for linked identities | SPEC §5; removing a domain revokes future logins |
| Linking | (1) `(provider, subject)` → login. (2) existing user with that email **and** `email_verified === true` → link + login. (3) `auto_provision` → create user (+ personal collection, + `default_group_id`). (4) deny. Inactive users denied everywhere | SPEC §5; a missing `email_verified` counts as false |
| Issuers | https required; http allowed only for `localhost` / `127.0.0.1` | openid-client rejects http by default; local Keycloak/Dex for dev and tests |
| Redirect after login | `redirect` query on start, kept in the flow cookie, accepted only as a relative path (`/…`, not `//`) | Same rule as the web's `safeRedirect`; no open redirect |
| Errors | Callback failures redirect to `/login?sso_error=<code>` (+ `email` for `domain_not_allowed`); details only in logs | DESIGN §6.10; the request log records the path without the query |
| Secrets | `client_secret_enc` via `encryptSecret`; API returns `secretLast4` only | Hard rule #3 |
| Password login | `instance_settings.password_login_enabled`; can be turned off only with ≥1 enabled provider and an admin with a linked identity; while off, the last enabled provider can't be disabled or deleted (`409 lockout_risk`) | SPEC §5 plus the reverse guard |
| Escape hatch | Env `FORCE_PASSWORD_LOGIN=true` enables password login regardless of the setting (warning logged at boot) | Server access = admin access, like the setup token |
| Sessions | Disabling a provider doesn't end existing sessions; deactivating a user does | Sessions belong to the app |
| Identity UI | Users page shows linked provider badges; no unlink | Deactivation covers revocation |
| Default group | Must be a group admins created (not `admins` / `all_users`) | Auto-provisioned users must never become admins |
| Discovery on save | Create, and changes to issuer / client ID / secret, run discovery first (`400 invalid_provider`) | Same rule as LLM keys: only working config is saved |
| Profile sync | Name/email are not updated from later logins | YAGNI |

## Data model (migration `0007_sso`)

- **auth_providers** — `id`, `kind` (`google` | `oidc`), `name`, `issuer`, `client_id`, `client_secret_enc`,
  `secret_last4`, `allowed_domains text[] default '{}'` (lowercased), `auto_provision bool default false`,
  `enabled bool default true`, timestamps.
- **user_identities** — `id`, `user_id fk cascade`, `provider_id fk cascade`, `subject`, `email` (as linked),
  `created_at`, `last_login_at`; unique(provider_id, subject); index(user_id).
- **instance_settings** — `password_login_enabled bool default true`, `default_group_id fk groups on delete set null`.

## `packages/shared`

- `env`: `FORCE_PASSWORD_LOGIN` (stringbool, default false).
- `auth`: `authOptions { passwordLoginEnabled, providers: { id, name, kind }[] }`;
  `ssoError` enum `domain_not_allowed | not_linked | inactive | invalid_state | provider_error`.
- `admin` (or `auth`): `authProviderInput { kind, name, issuer, clientId, clientSecret?, allowedDomains, autoProvision,
  enabled }` (secret required on create, optional on update = keep), `authProviderView` (+ `secretLast4`,
  `linkedUsers`; the list carries the one `redirectUri`), `instanceSettingsView { passwordLoginEnabled, passwordLoginForced,
  defaultGroupId, disablePasswordLoginBlocker: string | null }` (the reason shown next to the toggle),
  `updateSettingsRequest { passwordLoginEnabled?, defaultGroupId? }`. `adminUser` gains `identities: { providerName }[]`.
- Error codes: `password_login_disabled` (403), `lockout_risk` (409), `invalid_provider` (400, discovery failed).

## API

`services/sso.ts`:
```ts
resolveSsoLogin(db, provider, claims: { sub; email?; email_verified?; name?; hd? })
  → { kind: "login"; userId } | { kind: "denied"; reason: SsoError; email? }
domainAllowed(provider, claims): boolean
```
`services/oidc.ts`: discovery cache, `startFlow`, `readFlow`, `finishFlow`, `testDiscovery` — the only module importing
`openid-client`. Not injected: tests run it against a stub IdP on `127.0.0.1` (`apps/api/test/oidc-stub.ts`, also
served for e2e by `e2e/oidc-idp.ts`).

| Endpoint | Behavior |
|---|---|
| `GET /auth/oidc/providers` | Public: `authOptions` (enabled providers; `passwordLoginEnabled` = setting OR forced) |
| `GET /auth/oidc/:id/start?redirect=` | Enabled provider → set flow cookie, `302` to the IdP; else `302 /login?sso_error=provider_error` |
| `GET /auth/oidc/callback` | Validate cookie (provider id, expiry), exchange code (state, PKCE, nonce, ID token), domain check, `resolveSsoLogin`; success → session + `last_login_at` + `302 redirect`; failure → `302 /login?sso_error=…`. Flow cookie always cleared. `audit` on login / link / provision |
| `POST /auth/login` | `403 password_login_disabled` when disabled and not forced |
| `GET/POST /admin/auth-providers`, `PATCH/DELETE /admin/auth-providers/:id` | Admin only; issuer validated (https or localhost http); `google` forces issuer `https://accounts.google.com`; lockout guard on disable/delete |
| `POST /admin/auth-providers/:id/test` | Runs discovery; `{ ok: true }` or `400 invalid_provider` with a normalized message |
| `GET/PUT /admin/settings` | `instanceSettingsView`; disabling password login enforces the guard (`409 lockout_risk`) |

## Web

- **Login** (DESIGN §6.10): SSO buttons ("Continue with Google" / "Continue with <name>") linking to `start` with
  the current `redirect`; password form only when enabled; `sso_error` messages: domain → "Your account (<email>)
  isn't allowed. Ask your admin to add your domain.", not linked → "No Jangka account is linked to this sign-in. Ask
  your admin for an invite.", inactive → "Your account is deactivated.", others → "Sign-in failed. Try again."
- **Admin → Authentication** (`/admin/auth`): providers list (name, kind, domains, enabled, linked users count);
  add/edit dialog (Google preset or generic; client secret write-only showing `••••last4`; allowed domains as
  comma list; auto-provision with a warning that verified emails link to existing accounts; redirect URI with copy;
  Test discovery); settings card: password login toggle (disabled with the reason when not allowed; "Forced on by
  FORCE_PASSWORD_LOGIN" note), default group select.
- **Users page**: provider badges per user.

## Tests

**sso linking (unit against Postgres, written first)**: subject match; verified email links; unverified and missing
`email_verified` denied; auto-provision creates user + personal collection + default group (and without default group);
denied without auto-provision; inactive denied (subject and email paths); domain allowed/denied incl. case; Google
`hd` mismatch denied; a second provider links to the same user.
**oidc flow (stub IdP: discovery, JWKS, token endpoint signing ID tokens with `jose`)**: success sets the session
and redirects to a relative `redirect`; absolute/`//` redirect falls back to `/`; missing/expired/tampered cookie,
wrong state, wrong nonce → `invalid_state`; disabled provider → `provider_error`.
**admin**: secret never in responses or logs (grep like `llm-providers`); google issuer forced; http issuer rejected
unless localhost; lockout guards; settings view; `FORCE_PASSWORD_LOGIN` re-enables login; `password_login_disabled`.
**e2e**: admin adds a provider pointing at a stub IdP served next to the e2e server, signs out, "Continue with …"
signs in (identity linked by verified email).

## Acceptance

1. SPEC §11 baseline: tests for each linking branch, including unverified-email rejection.
2. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## Out of scope

Unlinking identities; profile sync from claims; SAML; SCIM; per-provider group mapping; ending sessions when a
provider is disabled; hiding invite/reset flows when password login is off.
