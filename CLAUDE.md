# CLAUDE.md

Self-hosted app (like Metabase) for generating BRD / PRD / TSD documents with LLM assistance,
standardized templates, Mermaid diagrams, collection-based permissions, and DOCX/PDF export.
One instance = one organization. Product name: **Jangka** (code-level name: `jangka`, packages `@jangka/*`).

**Docs: `docs/PRD.md` (what & why), `docs/DESIGN.md` (UX/UI), `docs/SPEC.md` (technical). Features are specced in `docs/plans/spec-<feature>.md`; read the relevant one (and the SPEC sections it references) before starting any task.**

## Commands

```bash
pnpm install
pnpm dev              # api + web + worker in watch mode
pnpm test:db:up       # start throwaway Postgres 18 for integration tests (port 54329)
pnpm test             # vitest (all packages); needs TEST_DATABASE_URL
pnpm test:e2e         # playwright: builds, recreates jangka_e2e next to TEST_DATABASE_URL, runs the built app
pnpm typecheck
pnpm lint             # biome check
pnpm db:generate      # drizzle-kit generate (after schema change)
pnpm db:migrate       # apply migrations
docker compose -f docker/docker-compose.yml up --build
```

## Stack (do not swap without an ADR)

Node 24 LTS (ADR 0001), TypeScript strict, pnpm + Turborepo, Vite + React + TanStack Router/Query + shadcn/ui,
Hono API, Postgres + Drizzle, pg-boss (queue), TipTap editor, Mermaid, Playwright Chromium (worker),
`docx` library, Zod v4, Vitest, Playwright e2e, Biome.

LLM: **official SDKs only** (`@anthropic-ai/sdk`, `openai`, `@google/genai`) behind our own adapter in
`packages/llm`. **Do NOT add Vercel AI SDK, LangChain, or any LLM framework.**

## Layout

```
apps/web         Vite React SPA
apps/api         Hono REST + SSE; serves built web assets in production
apps/worker      pg-boss consumers: export, diagram render
packages/db          Drizzle schema + migrations
packages/shared      Zod schemas, DTOs, error codes
packages/templates   BRD/PRD/TSD template definitions
packages/llm         provider adapters + factory + generation pipelines
packages/permissions pure permission resolver (no I/O)
packages/export      TipTap JSON -> HTML / DOCX
docs/PRD.md      product requirements (what & why)
docs/DESIGN.md   UX/UI design, design tokens, screens
docs/SPEC.md     technical spec + feature list (§11)
docs/plans/      overview, roadmap, per-feature specs
docs/adr/        architecture decision records
```

## Hard rules

1. **Every document/collection access goes through `packages/permissions`.** Never check access ad hoc in a route.
2. **Validate all input with Zod at the boundary** (HTTP body/query/params, job payloads, LLM output).
3. **Never log, return, or send to the frontend**: API keys, OIDC client secrets, password hashes, session tokens, setup token.
   API responses expose only `keyLast4`.
4. **Secrets at rest are encrypted** with `packages/shared/crypto` (AES-256-GCM, `MASTER_KEY`). No other crypto code.
5. **LLM output is untrusted.** Always parse with Zod; on failure retry max 2 times with the validation error appended.
6. **Only external runtime dependency is Postgres.** No Redis, no S3, no extra services.
7. **Section history is append-only** (`section_versions`). Never update or delete version rows.
8. Every mutating endpoint writes an `audit_logs` row (once feature `history-audit` lands; leave an `audit()` no-op hook before that).
9. Pass `AbortSignal` through every LLM call so user "stop" actually cancels the provider request.
10. No `any`. No `// @ts-ignore`. Use `unknown` + Zod narrowing.

## Workflow

- Work one feature at a time, in SPEC §11 order. Do not start the next feature until the current one's acceptance criteria pass.
- **Write tests first** for: `packages/permissions`, auth/session, crypto, setup wizard, OIDC account linking.
- Before declaring a task done: `pnpm typecheck && pnpm lint && pnpm test` must pass.
- Schema change → `pnpm db:generate`, commit the migration, never edit an applied migration.
- Non-obvious decision → add `docs/adr/NNNN-title.md` (context, decision, consequences; short).
- If the spec is ambiguous, stop and ask instead of guessing on anything touching auth, permissions, or data model.

## Conventions

- API base `/api/v1`. Error shape: `{ "error": { "code": string, "message": string, "details"?: unknown } }`.
- Streaming endpoints use SSE (`text/event-stream`), events mirror `StreamEvent` from `packages/llm`.
- IDs: UUIDv7 (`uuidv7` package), timestamps `timestamptz`, emails stored lowercased.
- Cursor pagination (`?cursor=&limit=`), default limit 50, max 200.
- File names kebab-case; React components PascalCase; one exported component per file.
- Dates/times in UI rendered in the browser's locale; stored in UTC.
