# Jangka

Self-hosted workspace for writing BRD / PRD / TSD documents with LLM assistance: standardized
templates, Mermaid diagrams, collection-based permissions, review workflow, and DOCX/PDF export.
One instance serves one organization. The only external dependency is Postgres.

- Product requirements: [`docs/PRD.md`](docs/PRD.md)
- UX / UI: [`docs/DESIGN.md`](docs/DESIGN.md)
- Technical spec: [`docs/SPEC.md`](docs/SPEC.md)

## Run with Docker

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

The wizard then creates the organization and the first admin, and optionally an LLM provider.
LLM providers (Anthropic, OpenAI-compatible, Gemini) and SSO (Google or any OIDC provider) can be
added later under **Admin**.

The bundled compose file runs Postgres 18 next to the app with a named volume (`pgdata`). To use
an existing Postgres instead, drop the `postgres` service and point `DATABASE_URL` at it.

## Configuration

| Variable               | Required | Default | Notes                                                                                             |
| ---------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | yes      |         | `postgres://user:pass@host:5432/db`                                                               |
| `MASTER_KEY`           | yes      |         | 32 bytes, base64 (`openssl rand -base64 32`). Encrypts provider API keys and OIDC client secrets. |
| `PUBLIC_URL`           | yes      |         | External URL, e.g. `https://docs.example.com`. Used for cookies, the CSRF origin check and OIDC redirect URIs. |
| `PORT`                 | no       | `3000`  |                                                                                                   |
| `APP_ROLE`             | no       | `all`   | `api` (HTTP only), `worker` (export and diagram jobs only) or `all` (both in one process).        |
| `LOG_LEVEL`            | no       | `info`  | `fatal` … `trace`. Logs are JSON on stdout.                                                       |
| `SESSION_TTL_DAYS`     | no       | `30`    | Rolling session lifetime.                                                                         |
| `FORCE_PASSWORD_LOGIN` | no       | `false` | Re-enables password login when SSO is misconfigured and everyone is locked out. Unset it afterwards. |
| `ENABLE_FAKE_LLM`      | no       | `false` | Offers a deterministic fake provider. For development and tests only.                             |

The app refuses to start when a variable is missing or invalid, and the error names the
variable. Values are never echoed.

## Production deployment

**TLS and reverse proxy.** Put the app behind a proxy that terminates TLS, and set `PUBLIC_URL` to
the `https://` address. Assistant replies stream over Server-Sent Events, so disable response
buffering for `/api/`. With nginx:

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

**Separate worker.** Exports and diagram renders run headless Chromium. The default `APP_ROLE=all`
runs them in the same container. To keep heavy jobs away from request handling, run the same image
twice, once with `APP_ROLE=api` (publishes the port) and once with `APP_ROLE=worker` (no port).
Both use the same `DATABASE_URL` and `MASTER_KEY`. Jobs go through Postgres (pg-boss), so nothing
else is needed.

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

## Upgrading

```bash
git pull
docker compose -f docker/docker-compose.yml up -d --build
```

Database migrations run automatically when the app starts. Take a database backup first, because
migrations are forward-only. If a migration fails, the app logs `migrations failed` and exits
without serving traffic.

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
```

Project conventions and hard rules for contributors are in [`CLAUDE.md`](CLAUDE.md). Feature
specs are in `docs/plans/`, and architecture decisions in `docs/adr/`.
