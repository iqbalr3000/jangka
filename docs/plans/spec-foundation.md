# Spec — foundation

Status: agreed 2026-10-23. Feature #1 (SPEC §11). Next: `auth`.

## Goal

A working monorepo skeleton that `auth` can build on without any open tooling decisions:
api boots against Postgres, runs migrations, serves a health check and the SPA shell; secrets have
an encryption util and never reach logs.

## Decisions

| Topic                         | Decision                                                               | Why                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Runtime                       | Node 24 LTS                                                            | Node 22 EOL April 2027 — see `docs/adr/0001-node-24.md`                                                               |
| Worker / pg-boss / Playwright | Deferred to `export`                                                   | No jobs until then; avoids ~300 MB image cost now. `APP_ROLE` also lands with `export`                                |
| API ↔ web types               | Zod schemas in `packages/shared` + thin fetch wrapper                  | Matches SPEC; no coupling of web to api internals (no Hono RPC)                                                       |
| Server build                  | `tsx watch` (dev), `tsup` bundle (prod)                                | Workspace packages bundled into one file; no per-package build step                                                   |
| Web routing                   | TanStack Router, file-based (Vite plugin)                              | Recommended path, generated type-safe routes                                                                          |
| DB driver                     | `pg` (node-postgres)                                                   | Same driver pg-boss uses later                                                                                        |
| Postgres                      | 18 in compose/CI; no PG18-only features (e.g. native `uuidv7()`)       | Longest support window; users may bring their own older Postgres via `DATABASE_URL`. Docs say "tested on Postgres 18" |
| Migrations                    | Auto-run on boot under an advisory lock                                | Metabase-style self-hosted UX; safe with multiple replicas                                                            |
| Logger                        | `pino` with `redact` (+ `pino-pretty` dev only)                        | Hard rule #3 needs built-in redaction                                                                                 |
| Fonts                         | Bundled via `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono` | NFR-005: no outbound calls (no Google Fonts)                                                                          |
| CI                            | GitHub Actions: lint, typecheck, test                                  | Public repo; cheap                                                                                                    |

## Scope

### Workspace (root)

- `package.json`: `"packageManager": "pnpm@11.1.3"`, `"engines": { "node": ">=24" }`, `"type": "module"`.
  Scripts: `dev`, `build`, `test`, `typecheck`, `lint` (`biome check .`), `db:generate`, `db:migrate`.
- `pnpm-workspace.yaml`: `apps/*`, `packages/*`.
- `turbo.json` tasks: `build`, `typecheck`, `dev` (persistent, `passThroughEnv` for app env vars — turbo runs in strict env mode). Vitest and Biome run once at root, not via turbo.
- pnpm 11 blocks dependency build scripts by default: `allowBuilds: { esbuild: true }` in `pnpm-workspace.yaml`.
- Dev scripts load `../../.env` via `--env-file-if-exists`, so shell env works without the file.
- `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`,
  `module: "ESNext"`, `moduleResolution: "Bundler"`, `target: "ES2023"`, `skipLibCheck`. Each package extends it.
- `biome.json`: recommended rules, `noExplicitAny: error`, 2-space indent, line width 100, organize imports.
- `vitest.config.ts` at root using `projects` (one per package).
- `.nvmrc` (`24`), `.gitignore`, `.env.example`.

Packages created now: `apps/api`, `apps/web`, `packages/db`, `packages/shared`. Others are created by the feature that needs them.

Internal packages ship TS source, no build: `"exports": { ".": "./src/index.ts", "./crypto": "./src/crypto.ts", … }`.
Consumed by `tsx`, `tsup`, Vite, and Vitest directly.

### `packages/shared`

**`env.ts`** — `parseEnv(source: Record<string, string | undefined>): Env`

| Var            | Rule                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL` | required, `postgres://` / `postgresql://` URL                          |
| `MASTER_KEY`   | required, base64 that decodes to exactly 32 bytes; exposed as `Buffer` |
| `PUBLIC_URL`   | required, http(s) URL, trailing slash stripped                         |
| `PORT`         | default `3000`                                                         |
| `LOG_LEVEL`    | `fatal                                                                 | error      | warn                        | info | debug | trace`, default `info` |
| `NODE_ENV`     | `development                                                           | production | test`, default `production` |

On failure, the process prints one line per invalid var (`MASTER_KEY: must decode to 32 bytes`) and exits 1.
**Never print the received value.** `SESSION_TTL_DAYS` is added by `auth`; `APP_ROLE` by `export`.

**`crypto.ts`** — the only crypto code in the repo (hard rule #4). Tests written first.

```ts
encryptSecret(plaintext: string, key: Buffer): string   // "v1:<iv>:<tag>:<ciphertext>", base64url parts
decryptSecret(payload: string, key: Buffer): string
```

- AES-256-GCM, 12-byte random IV per call, 16-byte tag, `node:crypto`.
- `v1` prefix reserves room for key rotation without a data migration.
- Any failure (malformed payload, unknown version, wrong key, tampered data) throws a `CryptoError`
  with a generic message — never includes payload or key material.

**`errors.ts`**
```ts
type ErrorCode = "validation_failed" | "unauthorized" | "forbidden" | "not_found"
               | "conflict" | "db_unavailable" | "internal";
class AppError extends Error { code; status; details?: unknown }
const errorResponseSchema  // { error: { code, message, details? } } — used by web to parse failures
```
Features add codes here (e.g. `setup_required`, `revision_conflict`).

### `packages/db`

- Drizzle + `pg`. `createDb(databaseUrl)` → `{ db, pool }`.
- `drizzle.config.ts`, migrations in `packages/db/migrations/`. No tables yet — first table comes from `auth`.
- `runMigrations(pool, migrationsFolder)`: takes `pg_advisory_lock(<fixed bigint>)` on a dedicated connection,
  runs the Drizzle migrator, releases the lock. Two concurrent callers both succeed; migrations run once.
- `uuidv7` package added here; tables use `.$defaultFn(uuidv7)` for ids from `auth` onward.

### `apps/api`

Boot order (`src/main.ts`): `parseEnv` → logger → `createDb` → `runMigrations` → `serve` (`@hono/node-server`).
Graceful shutdown on `SIGTERM`/`SIGINT`: stop accepting, close server, `pool.end()`.
- `createApp(deps)` builds the Hono app (separate from `main.ts` so tests call `app.request()` without a port).
- **Logger**: pino, JSON in production, `pino-pretty` when `NODE_ENV=development`. Redact paths include
  `*.password`, `*.passwordHash`, `*.token`, `*.apiKey`, `*.secret`, `*.clientSecret`, `*.masterKey`,
  `req.headers.cookie`, `req.headers.authorization`, `res.headers["set-cookie"]`.
- **Request log middleware**: method, path, status, duration, request id. Never bodies.
- **Error handling**: `app.onError` maps `AppError` → its status + standard shape; anything else → logged with
  stack, responds `500 { error: { code: "internal", message: "Internal error" } }` (no stack, no message leak).
  Unknown `/api/*` routes → `404 not_found` in the standard shape.
- **Validation helper**: small wrapper over Hono's built-in `validator` + Zod `safeParse` that throws
  `AppError("validation_failed", 400, …, details: issues)`. No `@hono/zod-validator`.
- **`audit(ctx, entry)`**: exported no-op with the final signature (`action`, `targetType`, `targetId`, `metadata`),
  implemented in `history-audit`.
- **`GET /api/v1/health`**: `select 1` → `200 { status: "ok" }`; on failure `503 db_unavailable`.
- **Static SPA** (production only): serve `apps/web/dist`; any non-`/api` GET falls back to `index.html`.
- Build: `tsup src/main.ts` → one self-contained `dist/main.js` (all deps bundled; native modules like `pg-native` external).

### `apps/web`

- Vite + React + TanStack Router (file-based) + TanStack Query + Tailwind v4 + shadcn/ui (initialized, no components beyond what the shell uses).
- **Design tokens**: all color/typography/radius/shadow tokens from DESIGN.md §3 as CSS vars on `:root`,
  overridden under `[data-theme="dark"]` and `@media (prefers-color-scheme: dark)` when no explicit theme; mapped into Tailwind `@theme`.
- Fonts from `@fontsource` packages (no network).
- Routes: `__root.tsx` (QueryClientProvider, placeholder shell: top bar with wordmark + empty sidebar), `index.tsx` (empty home placeholder).
  Real shell UI comes from the Claude Design work, not this feature.
- **`apiFetch(path, { schema, ...init })`**: prefixes `/api/v1`, sends `credentials: "include"`, parses success with the
  given Zod schema, parses failures with `errorResponseSchema` and throws `ApiError { code, status, message, details }`.
- Dev: Vite proxies `/api` → `http://localhost:3000`.

### Docker

- `docker/Dockerfile`, multi-stage on `node:24-slim` (Debian, so Playwright fits later): install with `pnpm fetch` + offline install,
  build web + api, runtime stage copies only `apps/api/dist`, `apps/web/dist`, `packages/db/migrations` (no `node_modules`). Runs as non-root.
- `docker/docker-compose.yml`: `postgres:18` (named volume mounted at `/var/lib/postgresql` — the PG18 image moved PGDATA; mounting `/var/lib/postgresql/data` silently loses data — healthcheck) + `app` (`depends_on: service_healthy`,
  `MASTER_KEY: ${MASTER_KEY:?set MASTER_KEY}`, port 3000).
- `docker/docker-compose.test.yml`: `postgres:18` on port `54329`, `tmpfs` data dir, for integration tests locally and in CI.

### Testing harness

- Unit tests: plain Vitest.
- Integration tests: `TEST_DATABASE_URL` → Vitest `globalSetup` runs migrations once. Helper to truncate all tables between
  tests (no tables yet; used from `auth` on).
- E2E (Playwright) set up in `auth`, the first real user flow.

### CI

`.github/workflows/ci.yml` on push + PR: Node 24, pnpm cache, `postgres:18` service, then `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## Tests (by scenario)

**crypto** (written first)
- round-trip returns the plaintext (incl. empty string and unicode)
- two encryptions of the same plaintext differ (random IV)
- tampered ciphertext / tag / IV → `CryptoError`
- wrong key → `CryptoError`
- malformed payload (wrong part count, bad base64) and unknown version (`v2:…`) → `CryptoError`
- error messages contain neither the payload nor key bytes

**env**
- valid env parses; defaults applied; `PUBLIC_URL` trailing slash stripped
- missing `MASTER_KEY`, non-base64, 31/33-byte key → error naming `MASTER_KEY`, output does not contain the given value

**api**
- `/health` 200 with DB up; 503 `db_unavailable` with an unreachable DB
- thrown `AppError` → its status + standard shape; thrown plain `Error` → 500 `internal`, body has no stack/message
- unknown `/api/v1/x` → 404 `not_found` shape
- validation helper → 400 `validation_failed` with `details`
- logger: logging `{ apiKey, password, token }` and a request with `Cookie` header outputs `[Redacted]` for each

**db**
- `runMigrations` called twice concurrently: both resolve, no error

## Acceptance

1. `pnpm install && pnpm typecheck && pnpm lint && pnpm test` green locally and in CI.
2. `MASTER_KEY=$(openssl rand -base64 32) docker compose -f docker/docker-compose.yml up --build` →
   `GET /api/v1/health` returns 200 and `/` serves the shell.
3. Missing or invalid `MASTER_KEY` → container exits non-zero; log names the var, never the value.
4. `pnpm dev` runs api + web; web loads with no requests to any external host (fonts bundled).
5. Shell renders in light and dark (system preference) using DESIGN.md tokens.

## Out of scope

Setup gate, sessions, users, CSRF (→ `auth`); worker, pg-boss, Playwright, `APP_ROLE` (→ `export`);
real app shell UI (→ Claude Design hand-off); audit implementation (→ `history-audit`).
