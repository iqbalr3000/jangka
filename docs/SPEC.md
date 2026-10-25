# Jangka — Technical Spec

Status: v0.1 (living document). Owner: Iqbal.

## 1. Overview

A self-hosted web app that helps product and tech teams produce **BRD, PRD, and TSD** documents.
The user chats with an LLM that **interviews** them about the problem, then drafts the document
section by section into a **standardized template**, including Mermaid diagrams. Documents live in
**collections (folders)** governed by **group-based permissions** (Metabase model), can be edited
manually, versioned, linked to each other (BRD → PRD → TSD traceability), and exported to **DOCX/PDF**.

### Goals

- Install with one `docker compose up`; only dependency is Postgres.
- Bring-your-own-key: admin configures Anthropic, OpenAI, Gemini, or OpenRouter + model.
- Documents always follow the template structure; the LLM fills it, it does not invent the structure.
- The LLM asks clarifying questions before drafting; incomplete sections are flagged, not padded.
- Group-based permissions on collections; no per-document ACL.

### Non-goals (for now)

- Multi-tenant SaaS (one instance = one org).
- Real-time collaborative editing (CRDT). Last-write-wins per section with version conflict check.
- Mobile app. Native integrations (Jira, Confluence) — later.

## 2. Architecture

```
Browser (SPA) ──HTTP/SSE──> api (Hono) ──> Postgres
                                 │            ▲
                                 └─ pg-boss ──┤
                                              │
                         worker (pg-boss consumer, Playwright Chromium)
```

- Single Docker image; `CMD` selects role: `api`, `worker`, or `all` (default; both in one container).
- `api` serves the built SPA as static files in production.
- Long/heavy work (export, diagram render) runs in `worker` via pg-boss jobs.
- LLM streaming happens in `api` over SSE (not via the queue).

### Environment variables

| Var                | Required | Notes                                                                 |
| ------------------ | -------- | --------------------------------------------------------------------- |
| `DATABASE_URL`     | yes      | Postgres connection string                                            |
| `MASTER_KEY`       | yes      | 32 bytes base64. App refuses to start if missing/invalid              |
| `PUBLIC_URL`       | yes      | e.g. `https://docs.example.com`; used for OIDC redirect URIs, cookies |
| `PORT`             | no       | default 3000                                                          |
| `APP_ROLE`         | no       | `api` / `worker` / `all` (default `all`)                              |
| `LOG_LEVEL`        | no       | default `info`                                                        |
| `SESSION_TTL_DAYS` | no       | default 30                                                            |
| `ENABLE_FAKE_LLM`  | no       | default `false`; offers the deterministic fake provider (dev, e2e)    |

## 3. Data model

All tables: `id uuid (v7) pk`, `created_at timestamptz`, `updated_at timestamptz` unless noted.

### Instance & identity

**instance_settings** (singleton row, `id = 1`)
- `org_name text`, `setup_completed_at timestamptz null`, `setup_token_hash text null`
- `default_group_id uuid null` (group for auto-provisioned SSO users)
- `password_login_enabled bool default true`
- `default_llm_provider_id uuid null`, `default_model text null`

**users**
- `email text unique` (lowercased), `name text`, `password_hash text null` (argon2id PHC string; null for SSO-only)
- `is_active bool default true`, `last_login_at timestamptz null`

**sessions**
- `token_hash text unique` (sha256 of random 32-byte token; raw token only in cookie)
- `user_id fk`, `expires_at`, `ip text`, `user_agent text`

**groups**
- `name text unique`, `system_key text null unique` — `'admins'` | `'all_users'` for system groups (not deletable)

**group_members** — `group_id`, `user_id`, pk(group_id, user_id)
- Every user is implicitly in `all_users` (resolver adds it; no rows needed).

**auth_providers** (OIDC; feature `sso`)
- `kind text` (`google` | `oidc`), `name text`, `issuer text`, `client_id text`
- `client_secret_enc text`, `allowed_domains text[]` (empty = any), `auto_provision bool`, `enabled bool`

**user_identities** (feature `sso`) — `user_id`, `provider_id`, `subject text`, unique(provider_id, subject)

### LLM

**llm_providers**
- `kind text` (`anthropic` | `openai` | `gemini` | `openrouter`), `label text`
- `api_key_enc text`, `key_last4 text`, `base_url text null`, `enabled bool`

### Content

**collections**
- `parent_id uuid null` (null = child of the virtual root "Our documents")
- `name text`, `personal_owner_id uuid null unique` (set = personal collection), `archived_at null`
- Constraint: personal collections and their descendants cannot receive grants.

**collection_grants**
- `collection_id uuid null` (null = root), `group_id`, `level text` (`view` | `edit`)
- unique(collection_id, group_id). Absence of a row = inherit.
- To explicitly block inheritance, store `level = 'none'` (so enum is `none` | `view` | `edit`).

**templates**
- `doc_type text` (`brd` | `prd` | `tsd`), `name text`, `version int`, `definition jsonb`, `is_builtin bool`
- unique(doc_type, name, version). Built-ins seeded from `packages/templates` on boot.

**documents**
- `collection_id uuid null` (null = root), `doc_type`, `template_id fk`, `title text`
- `status text` (`draft` | `in_review` | `approved`), `created_by fk users`, `archived_at null`
- `source_document_id uuid null` (e.g. PRD generated from BRD; feature `traceability`)

**document_sections**
- `document_id fk`, `section_key text` (from template), `position int`
- `content jsonb` (TipTap JSON, source of truth), `content_md text` (derived; used as LLM context)
- `completeness text` (`empty` | `partial` | `complete`), `revision int` (optimistic lock)
- `updated_by fk users null`; unique(document_id, section_key)

**section_versions** (append-only)
- `section_id fk`, `revision int`, `content jsonb`, `source text` (`llm` | `human`), `created_by fk`
- No `updated_at`. Never updated/deleted.

**requirements** (feature `traceability`)
- `document_id fk`, `section_id fk`, `code text` (`BR-001`, `FR-001`, `NFR-001`)
- `kind text` (`business` | `functional` | `non_functional`), `title`, `description`, `priority text` (`must` | `should` | `could`)
- unique(document_id, code)

**requirement_links** (feature `traceability`)
- `from_requirement_id`, `to_requirement_id`, `relation text` (`derives_from` | `implements`), unique(from, to, relation)

**diagram_renders** (cache)
- `source_hash text pk` (sha256 of mermaid source + theme), `svg text null`, `png bytea null`, `error text null`

**chat_threads** — `document_id fk`, `created_by fk`
**chat_messages**
- `thread_id fk`, `role text` (`user` | `assistant`), `content text`
- `provider_kind text null`, `model text null`, `input_tokens int null`, `output_tokens int null`

**interview_states** — `document_id pk fk`, `state jsonb` (see §6.2), `updated_at`

**invites** (feature `auth`)
- `kind text` (`invite` | `password_reset`), `email text`, `user_id fk null` (reset only), `token_hash text unique`
- `created_by fk users`, `expires_at` (7 days), `used_at null`

**exports**
- `document_id fk`, `format text` (`pdf` | `docx`), `status text` (`queued` | `running` | `done` | `failed`)
- `file bytea null`, `file_name text null`, `error text null`, `requested_by fk`, `expires_at` (24h; cleanup job)

**comments** (feature `review`) — `section_id fk`, `parent_id null`, `author_id`, `body text`, `resolved_at null`

**audit_logs** (feature `history-audit`; no `updated_at`)
- `actor_id null`, `action text` (e.g. `document.update_section`), `target_type`, `target_id`, `metadata jsonb`, `ip`

## 4. Permissions

Implemented as a **pure function** in `packages/permissions`. Callers load the collection tree + grants
- user's groups once (small data; cacheable per request) and pass them in.

### Semantics

- Levels ordered: `none < view < edit`.
- **view**: see the collection and its documents, read sections, export, view chat history.
- **edit**: view + create/edit/move/archive documents and sub-collections, run LLM generation.
- **Only admins** (members of `admins`) manage users, groups, grants, LLM providers, auth providers, settings.
- Admins have effective `edit` everywhere, including personal collections.
- Effective level of a group on collection C = its explicit grant on C if present, else on C's parent,
  recursively up to the root; root with no grant = `none`.
- User's effective level = **max** over all their groups (including implicit `all_users`).
- Personal collection (and descendants): owner = `edit`, admins = `edit`, everyone else = `none`. Grants ignored.
- Documents inherit their collection's level. No per-document ACL.
- Moving a document/collection requires `edit` on source **and** destination.
- Cannot move a collection into its own descendant.
- Linked artifacts the viewer cannot view (e.g. a linked BRD) are shown as "Restricted document" with no title/content.
- LLM context assembly may only include documents the **requesting user** can view.

### API

```ts
type Level = "none" | "view" | "edit";
resolveLevel(ctx: PermissionContext, collectionId: string | null): Level;
can(ctx, action: Action, target: Target): boolean;
filterViewable<T extends { collectionId: string | null }>(ctx, items: T[]): T[];
```

### Required test matrix (minimum)

- Root grant `view` to all_users → every non-personal collection is `view`.
- Child explicit `none` overrides parent `edit`; grandchild inherits `none`.
- User in group A (`view`) and group B (`edit`) → `edit`.
- Non-owner, non-admin on another user's personal collection → `none`, even with root grant `edit`.
- Admin on someone's personal collection → `edit`.
- Move doc: `edit` on source but `view` on destination → denied.
- Move collection into own descendant → denied.
- Archived collection: documents still resolve permission (archive ≠ permission change).
- `filterViewable` excludes restricted linked documents.

## 5. Auth & setup

### First-run setup (feature `auth`)

1. On boot, if `setup_completed_at` is null and no `setup_token_hash`: generate a random token,
   store its hash, **print the raw token to stdout** in a clearly marked log line.
2. All routes except `/api/v1/setup/*`, health, and static assets return `409 setup_required` until setup completes.
3. `POST /api/v1/setup` with `{ token, orgName, adminName, adminEmail, password }`:
   inside a transaction holding `pg_advisory_xact_lock`, verify token, verify not already set up,
   create user, add to `admins`, seed system groups and built-in templates, set `setup_completed_at`,
   clear `setup_token_hash`. Second concurrent request must fail with `409`.

### Password login

- argon2id via Node's built-in `crypto.argon2` (spec-auth). Min length 12. Rate limit: 10 attempts / 15 min per IP+email (in-memory LRU is fine).
- Session cookie: `httpOnly`, `Secure` (when `PUBLIC_URL` is https), `SameSite=Lax`, rolling expiry.
- CSRF: mutating requests must have `Origin` matching `PUBLIC_URL`; otherwise `403`.
- Admin onboards users with single-use links (7-day expiry); the same mechanism resets passwords. No temporary passwords, no SMTP.

### OIDC SSO (feature `sso`)

- Admin configures providers at runtime (no restart). Library: `openid-client`. Discovery via `issuer`.
- Google preset: issuer `https://accounts.google.com`.
- Flow: authorization code + PKCE + `state` + `nonce`, stored in a short-lived signed cookie.
- Redirect URI shown to admin: `${PUBLIC_URL}/api/v1/auth/oidc/{providerId}/callback`.
- Domain restriction: check email domain (and Google `hd` claim when kind = google) against `allowed_domains`.
- Account linking: match by `(provider, subject)` first. Else if email matches an existing user **and**
  `email_verified === true` → link. Else if `auto_provision` → create user, add to `default_group_id`. Else deny.
- Admin can disable password login only if at least one enabled OIDC provider exists and an admin has a linked identity.

## 6. LLM layer (`packages/llm`)

### 6.1 Provider adapters

Official SDKs only. Three adapters:
- `anthropic` → `@anthropic-ai/sdk`
- `openai-compatible` → `openai` SDK; used for OpenAI and OpenRouter (`baseURL: https://openrouter.ai/api/v1`)
- `gemini` → `@google/genai`

```ts
type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "done"; usage: { inputTokens: number; outputTokens: number } }
  | { type: "error"; error: LLMError };

type LLMErrorCode =
  | "auth"
  | "rate_limit"
  | "context_length"
  | "invalid_output"
  | "provider_down"
  | "aborted";

interface LLMProvider {
  streamText(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent>;
  generateObject<T>(req: ChatRequest, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T>;
  testConnection(): Promise<void>;
  listModels(): Promise<ModelInfo[]>;
}
```

Structured output per provider (schema defined once in Zod, converted with `z.toJSONSchema()`):
- Anthropic: single tool with `input_schema`, `tool_choice: { type: "tool", name }`; read `tool_use.input`.
- OpenAI: `response_format: { type: "json_schema", strict: true }`; adapter transforms schema
  (all properties required, optional → nullable, `additionalProperties: false`).
- Gemini: `responseMimeType: "application/json"` + response schema; adapter strips unsupported keywords.
- OpenRouter: try `response_format`; if the model rejects it, fall back to prompt-embedded schema + JSON extraction.
- **Always** `schema.safeParse()` the result; on failure retry up to 2 times with the Zod error message appended.

All SDK errors are mapped to `LLMError`. Adapters never log request bodies containing keys.

### 6.2 Generation pipelines

**Interview** (chat, per document)
- User/assistant turns streamed via `streamText`. System prompt includes template definition, doc type,
  current section summaries, and instructions to ask focused questions (max 3 per turn) and not to draft yet.
- After each assistant turn, run `generateObject` → `InterviewState`:

  ```ts
  { sections: { key: string; coverage: "missing" | "partial" | "covered"; notes: string }[];
    openQuestions: string[]; readyToDraft: boolean }
  ```
- UI shows a coverage checklist. "Draft document" is enabled when all `required` sections are ≥ `partial`
  (user may force-draft; then missing sections get `completeness = 'empty'` with a visible placeholder, never invented content).

**Draft** (per section, sequential, cancellable)
1. `streamText` → markdown for that section (template `guidance` + interview transcript + previously drafted sections as context).
2. Convert markdown → TipTap JSON, save as new `section_versions` row (`source = 'llm'`).
3. `generateObject` → `{ completeness, requirements[], diagrams[] }` for the section (requirements: feature `traceability`).
4. Each Mermaid diagram → render job; on render error, ask LLM to fix with the error (max 2 retries); if still failing, keep source + show error badge.

**Revise** (single section)
- Input: section key + instruction. Stream new markdown; UI shows diff vs current; user accepts → new version, rejects → discarded.

**Context budget**: estimate tokens (chars/4 heuristic is fine initially); when over 70% of model context,
summarize older chat turns and use `content_md` summaries of distant sections.

## 7. Templates (`packages/templates`)

```ts
type TemplateDefinition = {
  docType: "brd" | "prd" | "tsd";
  name: string;
  version: number;
  sections: {
    key: string;
    title: string;
    required: boolean;
    guidance: string; // instructions to the LLM for this section
    interviewHints: string[]; // what to ask the user
    requirementKind?: "business" | "functional" | "non_functional";
    expectsDiagram?: "flowchart" | "sequence" | "erd" | "state";
  }[];
};
```

Built-in PRD (feature `document`) sections: Overview, Problem Statement, Goals & Success Metrics, Target Users & Personas,
User Stories, Functional Requirements, Non-Functional Requirements, User Flow (diagram: flowchart),
Out of Scope, Assumptions & Dependencies, Risks & Mitigations, Open Questions.

Built-in BRD (feature `traceability`): Executive Summary, Business Problem, Business Objectives, Stakeholders, Current State (AS-IS),
Proposed Solution (TO-BE, diagram: flowchart), Business Requirements, Scope / Out of Scope, Constraints,
Assumptions, Risks, Success Criteria, Cost/Benefit (optional).

Built-in TSD (feature `traceability`): Overview, Architecture (diagram: flowchart), Components, Data Model (diagram: erd),
API Design, Key Sequences (diagram: sequence), Non-Functional Design (performance, security, scalability),
Infrastructure & Deployment, Observability, Migration/Rollout Plan, Testing Strategy, Risks & Open Questions.

Template versions are immutable; documents pin `template_id`. Custom org templates (feature `custom-templates`) are copies with new versions.

## 8. Diagrams & export

- Mermaid lives in TipTap as a custom `mermaidBlock` node `{ source: string }`.
- Client renders live with `mermaid`. Worker renders authoritative SVG/PNG with Playwright Chromium; cached in `diagram_renders` by hash.
- **PDF**: TipTap JSON → HTML (hand-written `toHtml`, ADR 0002, + shared print stylesheet), diagrams as inline SVG,
  cover page (title, type, status, author, date), requirements appendix; `page.pdf()` A4 with header/footer page numbers.
- **DOCX**: TipTap JSON → `docx` library (headings, paragraphs, bold/italic/code, bullet/numbered lists, tables, code blocks),
  diagrams as PNG at 2x scale, same cover page + requirements appendix as a table.
- Export flow: `POST /documents/:id/exports` → job queued → client polls `GET /exports/:id` → download. Expired after 24h.

## 9. API surface (initial)

```
GET  /api/v1/health
GET  /api/v1/setup/status          POST /api/v1/setup
POST /api/v1/setup/verify-token
POST /api/v1/auth/login            POST /api/v1/auth/logout       GET /api/v1/auth/me
GET  /api/v1/invites/:token        POST /api/v1/invites/:token/accept
GET  /api/v1/auth/oidc/providers   GET  /api/v1/auth/oidc/:id/start   GET /api/v1/auth/oidc/:id/callback

# admin
GET/PATCH /api/v1/admin/users       POST /admin/users/:id/reset-link
GET/POST /api/v1/admin/invites      DELETE /admin/invites/:id
CRUD /api/v1/admin/groups   /admin/groups/:id/members
GET/PUT /api/v1/admin/permissions          # full grant graph (Metabase-style matrix)
CRUD /api/v1/admin/llm-providers           POST /admin/llm-providers/:id/test   GET /admin/llm-providers/:id/models
CRUD /api/v1/admin/auth-providers          GET/PUT /admin/settings

# content
GET/POST /api/v1/collections               PATCH/DELETE /collections/:id    GET /collections/:id/items
GET/POST /api/v1/documents                 GET/PATCH /documents/:id         POST /documents/:id/move
GET  /api/v1/documents/:id/sections        PUT /documents/:id/sections/:key (body includes `revision`)
GET  /api/v1/documents/:id/sections/:key/versions
POST /api/v1/documents/:id/chat            (SSE)   GET /documents/:id/chat
POST /api/v1/documents/:id/draft           (SSE, all or selected sections)
POST /api/v1/documents/:id/sections/:key/revise (SSE)
POST /api/v1/documents/:id/exports         GET /exports/:id   GET /exports/:id/download
GET  /api/v1/templates
```

Section `PUT` with stale `revision` → `409 revision_conflict` (client shows reload/merge prompt).

## 10. Frontend

Routes: `/setup`, `/login`, `/` (collections browser), `/c/:collectionId`, `/d/:documentId`,
`/admin/{users,groups,permissions,llm,auth,settings}`.

Document page layout: left = section outline with completeness badges; center = TipTap editor;
right = chat panel (interview / revise) with coverage checklist. Streaming text appears in the target section live.
Permissions page: matrix of groups × collections with dropdown per cell (`No access` / `View` / `Edit` / `Inherit`).

## 11. Features

Work is planned and built **per feature**, not per milestone. Each feature has its own spec at
`docs/plans/spec-<feature>.md` (written after brainstorming); status lives in `docs/plans/roadmap.md`.
The sections above (data model, permissions, LLM layer, …) remain the shared technical reference.

A feature is done when its acceptance criteria pass + `typecheck`, `lint`, `test` green. Build in the order below.

### Phase 1 — usable product

| #   | Feature         | Scope                                                                                                                                                     | Baseline acceptance                                                                                                          |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | `foundation`    | Monorepo, Biome, Vitest, env validation (Zod), crypto util, Drizzle base, error shape, `audit()` no-op, Docker image + compose, SPA shell + design tokens | `docker compose up` boots api against Postgres; app refuses to start without valid `MASTER_KEY` (worker lands with `export`) |
| 2   | `auth`          | Setup wizard (token, advisory lock), password login, sessions, CSRF origin check, `/auth/me`, admin-created users + invite links                          | Fresh machine: token in logs → setup → login → empty home. Concurrent setup: one request fails                               |
| 3   | `access`        | Groups, collections tree, personal collections, grants, `packages/permissions`, permissions matrix UI, "Check a user's access" (should); all content routes enforce permissions             | §4 test matrix green. E2E: user B can't see user A's document without a grant; sees it after grant                           |
| 4   | `llm-providers` | Adapters (Anthropic, OpenAI-compatible, Gemini) + `fake`, provider CRUD, encrypted keys, test connection, model listing, default provider/model           | No API key in any response, log line, or error message (test greps logs during the run)                                      |
| 5   | `document`      | PRD template, documents + sections, TipTap editor with `mermaidBlock` (client render), section versions, optimistic locking                               | Create PRD, edit sections manually, stale revision → `409 revision_conflict`                                                 |
| 6   | `assistant`     | Interview chat + coverage, draft per section, revise with diff + undo after accept (restores previous version as a new one), SSE, abort, context budget                                                                | PRD from chat → all sections drafted → revise one via chat → stop mid-stream cancels the provider call                       |
| 7   | `export`        | Worker app + pg-boss + `APP_ROLE`, Playwright, diagram render cache + LLM fix loop, PDF and DOCX, cover page, 24h expiry                                  | PRD with 3 diagrams + 30-row table exports cleanly to both formats (visual check + DOCX structure snapshot)                  |

### Phase 2

| #   | Feature         | Scope                                                                                                                                                         | Baseline acceptance                                                                                   |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 8   | `traceability`  | BRD/TSD templates, requirements extraction + IDs, links, generate PRD from BRD / TSD from PRD, trace view, restricted links, requirements appendix in exports | BRD → PRD → TSD chain where each FR links to a BR; user without BRD access sees "Restricted document" |
| 9   | `sso`           | Runtime OIDC providers, Google preset, PKCE, domain restriction, linking rules (§5), auto-provision                                                           | Tests for each linking branch, including unverified-email rejection                                   |
| 10  | `history-audit` | Section version history with diff + restore (restore = new version), audit log + admin viewer                                                                 | Every mutating endpoint writes an `audit_logs` row                                                    |

### Phase 3

| #   | Feature            | Scope                                                                                                                  | Baseline acceptance                                                                  |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 11  | `custom-templates` | Duplicate a built-in, edit sections/guidance, publish as new version                                                   | —                                                                                    |
| 12  | `review`           | Threaded comments per section, resolve, status workflow `draft → in_review → approved`                                 | —                                                                                    |
| 13  | `impact-retrieval` | Upstream requirement change flags downstream links "needs review"; LLM references other docs only via `filterViewable` | Prompt asking to summarize a document the user can't view returns no content from it |
| 14  | `search`           | Search titles and content of viewable documents                                                                        | Results never include documents the user can't view                                  |

## 12. Testing strategy

- Unit (Vitest): permissions, crypto, schema transforms per provider, markdown ↔ TipTap conversion, template validation.
- Integration: API routes against a real Postgres (compose test DB), LLM adapters against recorded fixtures (no live calls in CI).
- E2E (Playwright): setup flow, login, permission isolation, PRD draft with a fake LLM provider, export download.
- Provide a `fake` LLM provider (deterministic responses) for tests and local dev without keys.
