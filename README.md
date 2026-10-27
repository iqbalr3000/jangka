<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/jangka-logo-dark.png">
    <img src="docs/assets/jangka-logo-light.png" alt="Jangka — Precise specs for product & engineering teams." width="440">
  </picture>
</p>

<p align="center">
  Self-hosted workspace for writing <b>BRD</b>, <b>PRD</b> and <b>TSD</b> documents with LLM assistance.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-1D4ED8" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-24_LTS-1D4ED8" alt="Node 24 LTS">
  <img src="https://img.shields.io/badge/postgres-18-1D4ED8" alt="Postgres 18">
  <img src="https://img.shields.io/badge/deploy-docker-1D4ED8" alt="Docker">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#production-deployment">Production</a> ·
  <a href="#development">Development</a> ·
  <a href="#documentation">Docs</a>
</p>

<br>

## Why Jangka

Generic AI chat turns one prompt into a long, polished document full of invented assumptions.
Jangka works the other way around: the assistant **interviews** you, shows which template sections
are still missing information, and drafts each section into a **standardized template**. Sections
it has no information for stay empty instead of being made up.

It installs like Metabase: one Docker image plus Postgres. One instance serves one organization,
and you bring your own LLM key, so internal requirements never pass through a third-party SaaS.

<br>

## Features

**Writing**

- Interview-first drafting, section by section, streamed live
- Built-in BRD / PRD / TSD templates, plus custom templates
- Completeness check that shows empty and partial sections at a glance
- Rewrite a section with an instruction and review the diff before accepting
- Rich-text editor with Mermaid diagrams, edited as code and rendered live

**Collaboration**

- Collections with group-based permissions (No access / View / Edit)
- Review workflow with comments and approvals
- Traceability from BRD → PRD → TSD, with impact flags when an upstream requirement changes
- Section history and an audit log
- Full-text search

**Operations**

- DOCX and PDF export
- LLM providers: Anthropic, OpenAI-compatible, Gemini
- Email + password login, or SSO with Google or any OIDC provider
- Provider keys and OIDC secrets encrypted at rest (AES-256-GCM)
- No telemetry. The only external dependency is Postgres

<br>

## Quick start

Requires Docker with Compose v2.

```bash
export MASTER_KEY="$(openssl rand -base64 32)"   # store it safely, see "Backups"
export PUBLIC_URL=http://localhost:3000           # the URL people open
docker compose -f docker/docker-compose.yml up -d --build
```

Open `PUBLIC_URL`. The setup wizard asks for a one-time setup token, which is printed in the
app's log:

```bash
docker logs jangka 2>&1 | grep "SETUP TOKEN"
```

The wizard creates the organization and the first admin, and optionally an LLM provider.
LLM providers and SSO can be added later under **Admin**.

The bundled compose file runs Postgres 18 next to the app with a named volume (`pgdata`). To use
an existing Postgres instead, drop the `postgres` service and point `DATABASE_URL` at it.

<br>

## Configuration

| Variable               | Required | Default | Notes                                                                                                          |
| ---------------------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | yes      |         | `postgres://user:pass@host:5432/db`                                                                            |
| `MASTER_KEY`           | yes      |         | 32 bytes, base64 (`openssl rand -base64 32`). Encrypts provider API keys and OIDC client secrets.              |
| `PUBLIC_URL`           | yes      |         | External URL, e.g. `https://docs.example.com`. Used for cookies, the CSRF origin check and OIDC redirect URIs. |
| `PORT`                 | no       | `3000`  |                                                                                                                |
| `APP_ROLE`             | no       | `all`   | `api` (HTTP only), `worker` (export and diagram jobs only) or `all` (both in one process).                     |
| `LOG_LEVEL`            | no       | `info`  | `fatal` … `trace`. Logs are JSON on stdout.                                                                    |
| `SESSION_TTL_DAYS`     | no       | `30`    | Rolling session lifetime.                                                                                      |
| `FORCE_PASSWORD_LOGIN` | no       | `false` | Re-enables password login when SSO is misconfigured and everyone is locked out. Unset it afterwards.           |
| `ENABLE_FAKE_LLM`      | no       | `false` | Offers a deterministic fake provider. For development and tests only.                                          |

The app refuses to start when a variable is missing or invalid, and the error names the
variable. Values are never echoed.

<br>

## Production deployment

### TLS and reverse proxy

Put the app behind a proxy that terminates TLS, and set `PUBLIC_URL` to the `https://` address.
Assistant replies stream over Server-Sent Events, so disable response buffering for `/api/`.
With nginx:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_buffering off;          # SSE: send tokens as they arrive
  proxy_read_timeout 300s;      # long drafting runs
}
```

### Separate worker

Exports and diagram renders run headless Chromium. The default `APP_ROLE=all` runs them in the
same container. To keep heavy jobs away from request handling, run the same image twice:

- `APP_ROLE=api`, which publishes the port
- `APP_ROLE=worker`, with no port

Both use the same `DATABASE_URL` and `MASTER_KEY`. Jobs go through Postgres (pg-boss), so nothing
else is needed.

<br>

## Backups

Back up two things:

1. **The database**, for example nightly:

   ```bash
   docker compose -f docker/docker-compose.yml exec -T postgres \
     pg_dump -U jangka -Fc jangka > jangka-$(date +%F).dump
   ```

   Restore with `pg_restore --clean --if-exists -d jangka`.

2. **`MASTER_KEY`**, kept separately from the dump, for example in a password manager. Without it,
   stored LLM API keys and OIDC client secrets can't be decrypted. Documents remain readable, but
   every provider and SSO secret has to be re-entered.

Export files expire after 24 hours and don't need a backup.

<br>

## Upgrading

```bash
git pull
docker compose -f docker/docker-compose.yml up -d --build
```

Database migrations run automatically when the app starts. Take a database backup first, because
migrations are forward-only. If a migration fails, the app logs `migrations failed` and exits
without serving traffic.

<br>

## Development

Requires Node 24 and pnpm (`corepack enable`).

```bash
pnpm install
cp .env.example .env          # set MASTER_KEY
pnpm db:dev:up                # dev Postgres on :5432
pnpm dev                      # api + web + worker in watch mode; web on http://localhost:5173
```

Checks:

```bash
pnpm typecheck && pnpm lint
pnpm test:db:up && pnpm test  # integration tests against a throwaway Postgres on :54329
pnpm test:e2e                 # Playwright, against the built app
pnpm test:perf                # NFR-007 timings with 5,000 documents (not part of CI)
```

### Project layout

```
apps/web              Vite + React SPA
apps/api              Hono REST + SSE; serves the built web app in production
apps/worker           pg-boss consumers: export, diagram render
packages/db           Drizzle schema and migrations
packages/shared       Zod schemas, DTOs, error codes, crypto
packages/templates    BRD / PRD / TSD template definitions
packages/llm          provider adapters and generation pipelines
packages/permissions  pure permission resolver
packages/export       TipTap JSON → HTML / DOCX
```

Conventions and hard rules for contributors are in [`CLAUDE.md`](CLAUDE.md).

<br>

## Documentation

| Document                               | What's in it                                |
| -------------------------------------- | ------------------------------------------- |
| [`docs/PRD.md`](docs/PRD.md)           | Product requirements: what and why          |
| [`docs/DESIGN.md`](docs/DESIGN.md)     | UX / UI, design tokens, brand               |
| [`docs/SPEC.md`](docs/SPEC.md)         | Technical spec and feature list             |
| [`docs/plans/`](docs/plans/)           | Roadmap and per-feature specs               |
| [`docs/adr/`](docs/adr/)               | Architecture decision records               |
| [`docs/assets/`](docs/assets/)         | Logo, mark and app icons                    |

<br>

## License

[MIT](LICENSE) © 2026 iqbalr3000
