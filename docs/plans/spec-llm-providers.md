# Spec — llm-providers

Status: agreed 2026-10-24. Feature #4 (SPEC §11). Builds on `access`. Next: `document`.
UI reference: `docs/design/Jangka Mockups.dc.html` — 1f (LLM providers), 1d (setup wizard).
Technical reference: SPEC §6.1 (adapters), §12 (testing).

## Goal

Admins connect Anthropic, OpenAI (or any OpenAI-compatible endpoint), Gemini, or OpenRouter with their own key,
test it, list its models, and pick an instance-wide default provider + model. `packages/llm` exposes the full
provider interface (`streamText`, `generateObject`, `testConnection`, `listModels`) so `assistant` only builds
pipelines on top. No API key ever appears in a response, log line, or error message.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Adapter scope | Full interface now, incl. streaming and structured output with Zod retry | SPEC puts adapters here; `assistant` is already large |
| Provider errors | Mapped to `LLMError` with a normalized message; raw provider messages are never surfaced or logged | Provider messages can echo key fragments |
| Extra error code | `invalid_request` (4xx other than auth/rate/context, e.g. unknown model) | Mapping it to `provider_down` would mislead |
| HTTP error | `502 llm_error`, `details: { reason: LLMErrorCode, retryAfterSeconds? }` | One code; UI picks copy by `reason` |
| Save requires test | Create and key/base-URL changes re-run `testConnection` server-side; failure → nothing saved | "Test must pass before Save" holds for the API too |
| Status badge | `last_tested_at` + `last_test_error` stored on the provider | Showing "Connected · tested 3m ago" without calling providers on every page view |
| Custom base URL | Only for kind `openai` (Ollama, vLLM, Azure-compatible gateways). OpenRouter uses its fixed URL | Admin-only setting on a self-hosted app; other kinds have one endpoint |
| Model list | Fetched live, not cached in DB; `contextWindow` optional | Lists change; not every provider reports context size |
| Default provider/model | `instance_settings.default_llm_provider_id` (fk, `on delete set null`) + `default_model`; cleared when the provider is deleted or disabled | Instance-wide only (PRD open question 2 stays open) |
| Fake provider | Kind `fake`, offered only when `ENABLE_FAKE_LLM=true` (default false); e2e enables it | Needed by e2e (production build) and keyless local dev |
| Adapter tests | Real SDKs against a local stub HTTP server via `baseURL` | No live calls, no extra deps, real SDK serialization |
| Provider factory injection | `AppDeps.llm` (factory) so API tests can point real adapters at the stub | Tests the key-leak acceptance through the real error path |

## `packages/llm` (new)

Deps: `@anthropic-ai/sdk`, `openai`, `@google/genai`, `zod`. No other LLM libraries.

```ts
type ProviderKind = "anthropic" | "openai" | "gemini" | "openrouter" | "fake";
type ProviderConfig = { kind: ProviderKind; apiKey: string; baseUrl?: string | null };
type ChatMessage = { role: "user" | "assistant"; content: string };
type ChatRequest = { model: string; system?: string; messages: ChatMessage[]; maxTokens?: number; temperature?: number };
type ModelInfo = { id: string; label: string; contextWindow?: number };
type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "done"; usage: { inputTokens: number; outputTokens: number } }
  | { type: "error"; error: LLMError };
type LLMErrorCode =
  | "auth" | "rate_limit" | "context_length" | "invalid_output" | "invalid_request" | "provider_down" | "aborted";

class LLMError extends Error { code; retryAfterSeconds?; }  // message = normalized copy only

interface LLMProvider {
  streamText(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent>;
  generateObject<T>(req: ChatRequest, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T>;
  testConnection(signal?: AbortSignal): Promise<void>;   // cheapest authenticated call (models list)
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
}

createProvider(config: ProviderConfig): LLMProvider
```

- `streamText` never throws for provider failures: it yields one `error` event and ends. `aborted` when the signal fires.
- `generateObject`: schema → `z.toJSONSchema()`, provider-specific request (SPEC §6.1), `safeParse`; on failure retry
  up to 2 times appending the Zod issues as a user message; then `invalid_output`. Shared loop, adapters only do
  one raw attempt.
  - Anthropic: forced tool. OpenAI: `json_schema` strict with transform (all required, optional → nullable,
    `additionalProperties: false`). Gemini: `responseMimeType` + schema with unsupported keywords stripped.
  - OpenRouter: `response_format` first; if rejected (400), prompt-embedded schema + first JSON object extraction.
- Error mapping (all adapters): 401/403 → `auth`; 429 → `rate_limit` (+ `retry-after`); 400 mentioning
  context/token limit → `context_length`; other 4xx → `invalid_request`; 5xx / network / timeout → `provider_down`;
  abort → `aborted`.
- Model lists: Anthropic and OpenAI `models.list`; OpenRouter models (with `context_length`); Gemini models
  supporting `generateContent`, `models/` prefix stripped.
- `fake`: `listModels` → `fake-small`, `fake-large`; `apiKey === "invalid"` → `auth` error (exercises error UI);
  `streamText` streams a deterministic reply word by word, honoring abort; `generateObject` returns from a queue set
  with `fakeResponses()` (tests; `assistant` extends it) and otherwise fails with `invalid_output`.
- Adapters never log. Normalized messages:
  `auth` "Key rejected by provider" · `rate_limit` "Rate limited, try again in {n}s" (or "shortly") ·
  `context_length` "The request is too long for this model" · `invalid_output` "The model returned output in an
  unexpected format" · `invalid_request` "The provider rejected the request" · `provider_down` "The provider is
  unreachable or returned an error" · `aborted` "Request cancelled".

## Data model (migration `0002_llm_providers`)

- **llm_providers** — `id`, `kind text` check in (`anthropic`,`openai`,`gemini`,`openrouter`,`fake`), `label text not null`,
  `api_key_enc text null` (null only for `fake`), `key_last4 text null`, `base_url text null`, `enabled bool default true`,
  `last_tested_at null`, `last_test_error text null` (an `LLMErrorCode`), timestamps.
- **instance_settings** — add `default_llm_provider_id uuid null fk llm_providers on delete set null`, `default_model text null`.

## Config / env

- `ENABLE_FAKE_LLM` (bool, default `false`). e2e sets it to `true`.
- `AppDeps` gains `masterKey: Buffer` and `llm: (config: ProviderConfig) => LLMProvider` (default `createProvider`).

## `packages/shared/llm` (new subpath)

`providerKind`, `modelInfo`, `llmProvider { id, kind, label, keyLast4, baseUrl, enabled, lastTestedAt, lastTestError, isDefault }`,
`llmProviderList { items, fakeEnabled }`, `testProviderRequest { kind, apiKey, baseUrl? }`,
`createProviderRequest { kind, label, apiKey, baseUrl?, defaultModel? }`,
`updateProviderRequest { label?, apiKey?, baseUrl?, enabled? }`, `testResult { models, latencyMs }`,
`modelList { models }`, `llmSettings { providerId, model }` (both nullable together), `llmStatus { configured }`.
Error code `llm_error` added to `errors.ts`.

## API

| Endpoint | Auth | Behavior |
|---|---|---|
| `GET /admin/llm-providers` | admin | List + `fakeEnabled` |
| `POST /admin/llm-providers/test` | admin | Unsaved key: `testConnection` + `listModels` → `testResult`; failure → `502 llm_error` |
| `POST /admin/llm-providers` | admin | Tests, encrypts key, stores `key_last4`, `last_tested_at`. With `defaultModel` → becomes default. `fake` when disabled → 400; `baseUrl` on non-`openai` → 400. 201 provider |
| `PATCH /admin/llm-providers/:id` | admin | Label / enabled / key / base URL. New key or base URL → re-test before saving. Disabling the default clears it |
| `DELETE /admin/llm-providers/:id` | admin | Clears default (provider + model) if it was the default. 204 |
| `POST /admin/llm-providers/:id/test` | admin | Records `last_tested_at` / `last_test_error`; returns `testResult` or `502 llm_error` |
| `GET /admin/llm-providers/:id/models` | admin | `modelList` |
| `GET /admin/settings/llm` · `PUT` | admin | Default provider + model; provider must exist and be enabled; `{ null, null }` clears |
| `GET /llm/status` | user | `{ configured }` = an enabled default provider + model exists |

Logs on provider failure: `{ providerKind, reason }` only. Every mutating endpoint calls `audit()` (no key in metadata).

## Web

- **`/admin/llm`** (admin nav "LLM providers") per 1f:
  - Default model card: provider select (enabled providers) + `ModelPicker` + Save.
  - Provider list: initial, label, kind, `••••last4`, status (● Connected / ◐ Rate limited / ✕ Key rejected /
    ✕ Unreachable / ○ Not tested) + "Tested 3m ago", Default badge, `⋯` (Test again, Replace key, Rename,
    Disable/Enable, Delete).
  - **Add provider** dialog, 4 steps with completed steps collapsed + Change: Provider (Anthropic, OpenAI, Gemini,
    OpenRouter, Fake if enabled) → API key + label (+ base URL for OpenAI) → Test connection (model count, latency;
    errors with normalized copy) → Pick a default model (optional when a default exists) → Save.
- **`ModelPicker`**: search input + scrollable list (OpenRouter returns hundreds).
- **Setup wizard**: step 4 "LLM (optional)" after the admin step (session already exists), same add flow, Skip → home.
- **Home banner** (admins, when `/llm/status` not configured): "Add an LLM provider to start drafting." → `/admin/llm`.

## Tests

**llm** (stub HTTP server per provider): stream parsing → text events + usage; error mapping per status
(401, 429 + retry-after, 400 context, 404 model, 500, connection refused, abort mid-stream closes the request);
`generateObject` per provider request shape (tool / json_schema / Gemini schema), retry with Zod error then success,
`invalid_output` after 2 retries, OpenRouter fallback on rejected `response_format`; OpenAI strict schema transform
and Gemini keyword stripping (unit); model listing per provider; `LLMError` messages never contain the key.

**api**: admin-only; create with rejected key → 502, nothing stored; stored row has encrypted key ≠ plaintext and
decrypts to it; responses only expose `keyLast4`; key replace re-tests; disable/delete clears default; settings PUT
validation; `fake` rejected when disabled; `/llm/status` for members. **Key-leak check**: capture all log output during
a suite that runs success and failure flows (stub returns 401 echoing the key), then assert the key string appears in
no log line and no response body.

**e2e** (`ENABLE_FAKE_LLM=true`): onboarding skips the LLM step; new `llm.spec.ts` — admin adds a Fake provider,
tests it, picks `fake-small`, saves; it is listed as default and the home banner is gone.

## Acceptance

1. SPEC §11 baseline: no API key in any response, log line, or error message (key-leak test).
2. Tests above green; `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## Out of scope

Generation pipelines, prompts, context budget, SSE endpoints (→ `assistant`); per-collection or per-user model choice;
fallback provider; `MASTER_KEY` rotation.
