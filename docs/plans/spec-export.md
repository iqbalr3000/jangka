# Spec — export

Status: agreed 2026-10-25. Feature #7 (SPEC §11). Builds on `document`, `assistant`, `llm-providers`. Next: `traceability`.
Technical reference: SPEC §2 (roles), §3 (`diagram_renders`, `exports`), §6.2 step 4, §8, PRD FR-037/040/042, NFR-008,
DESIGN §6.7, §11.

## Goal

A user with view access exports a document to PDF or DOCX with a cover page, and downloads it within 24 hours.
Mermaid diagrams are rendered authoritatively in a worker (Playwright Chromium) and cached; diagrams the LLM writes
are auto-fixed (max 2 retries) before they are saved or proposed. Heavy work never blocks the API.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Worker | New `apps/worker` package exporting `startWorker(deps)`; no entrypoint of its own — its `dev` script runs the api entrypoint with `APP_ROLE=worker` | One startup path (env, logger, migrations) for dev and prod |
| `APP_ROLE` | `api` / `worker` / `all` (default). `apps/api/src/main.ts` decides: `api`/`all` serve HTTP, `worker`/`all` call `startWorker`; `all` = **one Node process**, one pool. Migrations run in every role (idempotent) | One entrypoint, no supervisor; Chromium is its own child process anyway |
| Queue | pg-boss in schema `pgboss` of the same DB, started by both roles (api only sends) | Postgres is the only runtime dependency |
| Diagram render | Shared Chromium, fresh context per job; `mermaid.min.js` injected from `node_modules` via `addScriptTag({ path })`; **all network requests aborted**; `securityLevel: "strict"`, theme `default` | Untrusted source; offline; print is always light |
| Render cache | `diagram_renders` keyed by `sha256(theme + "\n" + source)`; stores SVG + PNG (2x, element screenshot) or the error. Errors are cached too | A broken source is never re-rendered per export |
| Fix loop | Runs **during draft/revise in the api**, before a section is saved or a revision proposed: enqueue `diagram.render`, wait on the cache row (poll 250 ms, timeout 20 s, abortable). Error → `fixDiagram` LLM call with the error (max 2 retries). Still failing, timeout, or no worker → keep the source (client shows its error badge) | Saved/proposed content is already fixed; never rewrites a section behind the user (no surprise 409s) |
| HTML | Hand-written `toHtml()` in `packages/export`, whitelist-based like `toMarkdown()` (not `@tiptap/html`) — ADR 0002 | No server DOM emulation; no extension list to keep in sync with web |
| PDF | `toHtml` + print stylesheet → `page.setContent` (JS disabled, network blocked, Inter embedded as data URI) → `page.pdf()` A4 with header/footer | DESIGN §11 |
| DOCX | `toDocx()` with the `docx` library; diagrams as the cached PNG | SPEC §8 |
| Snapshot | Document content is read when the job **runs**, not when requested | Gap is seconds; no revision bookkeeping |
| Download | Only the requester, **and** view access is re-checked at download time | A revoked grant cannot fetch a file prepared earlier |
| Expiry | `expires_at = created_at + 24h`; after expiry download → `410 export_expired`; hourly cleanup deletes expired rows | FR-042 |
| Requirements appendix | Not built; checkbox hidden until `traceability` (FR-041) | `requirements` table doesn't exist yet |
| Cover "version" | Dropped; cover shows "Last updated" | Documents have no version number |
| Reliability | `export.run` retryLimit 1 (transient Chromium/DB failures); final failure → `status = failed` with a generic message, details only in logs | NFR-008 |
| Concurrency | Worker `localConcurrency` 2 for `export.run`, 4 for `diagram.render` | Bounds Chromium memory on small hosts |

## Jobs (`@jangka/worker/jobs`)

Job names + Zod payload schemas, shared by api (send) and worker (work). Payloads validated on receipt (hard rule #2).

| Job | Payload | Behavior |
|---|---|---|
| `diagram.render` | `{ hash, source }` | `singletonKey = hash`. Skips if the cache row exists; renders; upserts `diagram_renders` |
| `export.run` | `{ exportId }` | `running` → load document + sections (+ author, org name) → render missing diagrams inline (same renderer, through the cache) → PDF/DOCX → `done` with `file`, `file_name` |
| `export.cleanup` | — | Scheduled `0 * * * *`: delete `exports` past `expires_at`, and `diagram_renders` older than 30 days |

Renderer: one `chromium.launch({ args: ["--disable-dev-shm-usage"] })` per worker, relaunched if it disconnects;
closed on shutdown (SIGTERM drains pg-boss first).

## `packages/export`

```ts
mermaidBlocks(doc: DocNode): string[]                      // sources in document order
diagramHash(source: string, theme?: "default"): string     // sha256, shared by api + worker
toHtml(input: ExportInput, opts: { fontCss: string }): string
toDocx(input: ExportInput): Promise<Buffer>

type ExportInput = {
  document: { title; docType; status; author; updatedAt; orgName: string | null };
  sections: { title; content: DocNode; empty: boolean }[];
  diagrams: Map<string, { svg: string; png: Buffer } | { error: string }>;  // by hash
  includeCover: boolean;
};
```

Both are pure (no I/O); the worker loads fonts and diagrams and passes them in.

- **Shared rendering rules**: section title = H2 (template order); empty section (`completeness = empty` or no content)
  → gray box "Not yet specified."; diagram → centered image, caption "Figure n — <section title>" (n counts across the
  document); failed diagram → its source as a code block + "Diagram could not be rendered: <error>".
- **toHtml**: escapes every text and attribute; links only from the already-whitelisted `href`; a table whose first
  row is all `tableHeader` emits `<thead>` (repeats on page break), zebra body rows; IDs/code in JetBrains Mono.
  Cover page: wordmark (small, top-left), type badge, title, status, author, last updated; `page-break-after`.
- **PDF chrome** (worker, `page.pdf`): A4, margins 20 mm, `headerTemplate` title (left) + type · status (right),
  `footerTemplate` `n / total` + org name. Inter 11 pt / 1.5, headings 600.
- **toDocx**: headings, paragraphs, bold/italic/code/link, bullet + numbered lists (nested; numbering config),
  blockquote (indented), hr, code blocks (mono, shaded), tables (header row `tableHeader: true`, borders), diagrams as
  `ImageRun` from the PNG scaled to page width (max 16 cm), same cover page + section break, header/footer with
  `PageNumber.CURRENT` / `TOTAL_PAGES`. Font "Inter" with Calibri fallback (not embedded).

File name: `<slug(title) || "document">.<pdf|docx>`; download sets `Content-Disposition` with an RFC 5987 `filename*`.

## `packages/llm/src/pipelines`

```ts
fixDiagram(provider, { source, error, expectsDiagram?, model }, signal): Promise<string>  // generateObject { source }
```

Prompt: "Return corrected Mermaid source only; keep the meaning; fix the syntax error below." Output Zod-validated
(non-empty, ≤ `MAX_MERMAID_CHARS`); a code fence around the answer is stripped; validation failure follows hard rule #5.
The fake provider has no special case (tests queue the fixed source with `fakeResponses`).

## API changes (assistant)

- Helper `ensureDiagrams(doc, ctx, signal): Promise<DocNode>` in `services/diagrams.ts`: for each `mermaidBlock`,
  render via the queue + wait; on error run `fixDiagram` and re-render (max 2); replaces fixed sources in the node tree.
  Fix calls are not counted in the message's token usage (`generateObject` doesn't report usage).
  The checker is injectable (`AppDeps.diagrams`); api tests use a stub, the default waits on the worker.
- **Draft**: called after `fromMarkdown`, before the revision-checked save. `section_done` carries the saved (fixed) content.
- **Revise**: called after the stream; if anything changed, a new event `proposal { sectionKey, markdown }`
  (`toMarkdown` of the fixed doc) replaces the client's streamed buffer before the diff is shown.
- Abort during the wait or a fix call cancels both, same as the stream.

## Data model (migration `0005_export`)

- **diagram_renders** — `source_hash text pk`, `svg text null`, `png bytea null`, `error text null`, `created_at`.
  Check: (`svg` and `png` not null) xor (`error` not null).
- **exports** — `id`, `document_id fk cascade`, `format` (`pdf`|`docx`), `status` (`queued`|`running`|`done`|`failed`),
  `include_cover bool`, `file bytea null`, `file_name text null`, `error text null`, `requested_by fk`, `created_at`,
  `updated_at`, `expires_at`. Index on `expires_at`.

## Env

`APP_ROLE` (`api`|`worker`|`all`, default `all`) in `packages/shared/env` (already in SPEC §2); added to `.env.example`.

## `packages/shared/export` (new subpath)

`exportFormat`, `exportStatus`, `createExportRequest { format, includeCover: boolean (default true) }`,
`exportJob { id, documentId, format, status, includeCover, fileName, error, createdAt, expiresAt }` (includeCover so
Retry repeats the same options), `EXPORT_CONTENT_TYPES`, `EXPORT_TTL_MS`.
Error codes `export_expired`, `export_not_ready`. `assistantEvent` gains `proposal { sectionKey, markdown }`.

## API

| Endpoint | Behavior |
|---|---|
| `POST /documents/:id/exports` | View on the document (`packages/permissions`); not archived. Inserts `queued`, sends `export.run`, `audit()`; `202 exportJob` |
| `GET /exports/:id` | Requester only (others → 404) + current view; `exportJob` |
| `GET /exports/:id/download` | Requester + current view; not `done` → `409 export_not_ready`; expired → `410 export_expired`; streams `file` with the content type |

## Docker

- `apps/api` `dependencies` = `playwright-core` only (external in tsup). The worker's runtime files (mermaid's browser
  build, the font CSS and woff2 subsets) are copied by `apps/worker/scripts/copy-assets.ts` into `apps/api/dist/assets`
  during the api build; `assetPath()` prefers them and falls back to node_modules in dev and tests.
  Build: `pnpm --filter @jangka/api deploy --prod --legacy /deploy` → runtime `node_modules` (14 MB).
- Runtime: `playwright-core/cli.js install --with-deps --only-shell chromium`, then `apt-get purge --auto-remove xvfb`
  (xvfb drags in Mesa/LLVM, needed only by headed browsers) and ffmpeg removed. Fonts stay (CJK / emoji in diagrams).
  Measured image: 965 MB (was 1.49 GB): base ±550 MB, Chromium + libraries 399 MB.
- `CMD` unchanged (`node apps/api/dist/main.js`); role from `APP_ROLE`.

## Dependencies

`apps/worker`: `pg-boss`, `playwright-core` (exact version matching `@playwright/test`), `mermaid` (same major as web),
`@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`; dev `jszip`. `packages/export`: `docx` (render
code in the `@jangka/export/render` subpath so the web bundle never pulls in `docx`/`node:crypto`); dev `jszip`.
`apps/api`: see Docker.

## Web

- **ExportDialog** (header `Export ▾` and `⌘⇧E`): Format (PDF / DOCX), Include `[✓] Cover page`, warning
  "N sections are empty and will show as placeholders." when applicable; `[Cancel] [Export]`.
- Toast: "Preparing PDF…" (poll `GET /exports/:id` every 1 s, stop on unmount) → "Ready · Download (expires in 24h)" →
  download via `/exports/:id/download`; failed → "Export failed · Retry".
- Available to viewers too (view includes export).

## Tests

**export** (unit): `toHtml` escapes text/attrs, `<thead>` for header rows, empty-section placeholder, figure numbering,
failed diagram fallback, cover on/off; `toDocx` snapshot of normalized `word/document.xml` (via `jszip`) for a fixture
with every node type; `mermaidBlocks` / `diagramHash` stable.
**llm**: `fixDiagram` validates output and retries on invalid.
**worker** (integration, real Chromium + Postgres; own database `jangka_worker_test`, since vitest runs projects in
parallel and the api project truncates the shared one): valid diagram → SVG + PNG cached; invalid → error cached; second
request is a cache hit (no render); network requests from the page are blocked; `export.run` for the baseline fixture
(3 diagrams + 30-row table) produces a PDF (page count > 1, starts with `%PDF`) and a DOCX containing 3 images and a
31-row table; failure → `failed` with a generic message; cleanup deletes expired rows only.
**api**: create needs view (no access → 404); status/download requester-only; download after grant revoked → 404;
`409 export_not_ready`; `410 export_expired`; draft with a broken diagram (fake renderer stub) saves the fixed source;
fix still failing after 2 → source kept; revise emits `proposal` with fixed markdown; abort during fix cancels it.
**e2e**: open a PRD with a diagram → Export PDF → toast → download succeeds; same for DOCX.

## Acceptance

1. SPEC §11 baseline: PRD with 3 diagrams + 30-row table exports cleanly to both formats (visual check of the PDF +
   DOCX structure snapshot).
2. `docker compose up --build` with default `APP_ROLE=all` exports a PDF end to end.
3. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## Out of scope

Requirements appendix (→ `traceability`); version number / change log in exports (PRD open question 3); dark-theme
diagrams in exports; embedding fonts in DOCX; multiple API instances (in-memory locks stay); per-user export rate limit.
