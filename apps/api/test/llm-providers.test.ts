import { Writable } from "node:stream";
import { instanceSettings, llmProviders } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { createProvider, FAKE_INVALID_KEY } from "@jangka/llm";
import { SECRET_KEY, type Stub, startStub } from "@jangka/llm/testing";
import { decryptSecret } from "@jangka/shared/crypto";
import { llmProvider, llmProviderList, llmStatus, testResult } from "@jangka/shared/llm";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger, redactPaths } from "../src/logger";
import {
  buildApp,
  call,
  createUser,
  login,
  setupInstance,
  TEST_MASTER_KEY,
  type TestApp,
  testDatabase,
} from "./helpers";

const { db, pool } = testDatabase();
let stub: Stub;
beforeAll(async () => {
  stub = await startStub();
});
afterAll(async () => {
  await stub.close();
  await pool.end();
});

// Every log line of the suite, for the key-leak check at the end.
const logLines: string[] = [];
const logger = createLogger(
  { level: "trace", pretty: false },
  new Writable({
    write(chunk: Buffer, _encoding, done) {
      logLines.push(chunk.toString("utf8"));
      done();
    },
  }),
);
// Response bodies seen by the suite, for the same check.
const bodies: string[] = [];

let app: TestApp;
let adminCookie: string;

async function req(method: string, path: string, body?: unknown, cookie = adminCookie) {
  const res = await call(app, method, path, { cookie, body });
  bodies.push(await res.clone().text());
  return res;
}

beforeEach(async () => {
  await truncateAll(pool);
  // Real adapters, pointed at the stub. The OpenAI path needs the /v1 prefix.
  app = buildApp(db, pool, {
    logger,
    llm: (config) =>
      createProvider({
        ...config,
        baseUrl: config.kind === "fake" ? null : `${stub.url}/v1`,
        maxRetries: 0,
      }),
  }).app;
  adminCookie = await setupInstance(app, db);
  stub.handle((request) => {
    const auth = request.headers.authorization;
    if (auth !== `Bearer ${SECRET_KEY}`) {
      // Like OpenAI: the error message echoes the key it was given.
      return {
        status: 401,
        json: { error: { message: `Incorrect API key provided: ${auth}`, type: "auth" } },
      };
    }
    return {
      json: {
        object: "list",
        data: [
          { id: "gpt-a", object: "model", created: 1, owned_by: "x" },
          { id: "gpt-b", object: "model", created: 1, owned_by: "x" },
        ],
      },
    };
  });
});

const OPENAI = { kind: "openai", label: "Production", apiKey: SECRET_KEY };

async function createOpenAI(extra: object = {}) {
  const res = await req("POST", "/admin/llm-providers", { ...OPENAI, ...extra });
  expect(res.status).toBe(201);
  return llmProvider.parse(await res.json());
}

describe("llm providers", () => {
  it("are admin-only", async () => {
    await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
    const cookie = await login(app, "rina@acme.co", "rina-password-123");
    expect((await req("GET", "/admin/llm-providers", undefined, cookie)).status).toBe(403);
    expect((await req("GET", "/llm/status", undefined, cookie)).status).toBe(200);
  });

  it("tests an unsaved key and returns the model list", async () => {
    const res = await req("POST", "/admin/llm-providers/test", {
      kind: "openai",
      apiKey: SECRET_KEY,
    });
    expect(res.status).toBe(200);
    expect(testResult.parse(await res.json()).models.map((m) => m.id)).toEqual(["gpt-a", "gpt-b"]);
  });

  it("stores a tested provider with the key encrypted and only last4 exposed", async () => {
    const created = await createOpenAI({ defaultModel: "gpt-b" });
    expect(created).toMatchObject({ keyLast4: "1234", isDefault: true, lastTestError: null });

    const [row] = await db.select().from(llmProviders);
    expect(row?.apiKeyEnc).not.toContain(SECRET_KEY);
    expect(decryptSecret(row?.apiKeyEnc ?? "", TEST_MASTER_KEY)).toBe(SECRET_KEY);

    const list = llmProviderList.parse(await (await req("GET", "/admin/llm-providers")).json());
    expect(list.items).toHaveLength(1);
    const settings = await (await req("GET", "/admin/settings/llm")).json();
    expect(settings).toEqual({ providerId: created.id, model: "gpt-b" });
    expect(llmStatus.parse(await (await req("GET", "/llm/status")).json())).toEqual({
      configured: true,
    });
  });

  it("refuses to save a rejected key, with a normalized error", async () => {
    const res = await req("POST", "/admin/llm-providers", { ...OPENAI, apiKey: "sk-wrong-9999" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: {
        code: "llm_error",
        message: "Key rejected by provider",
        details: { reason: "auth" },
      },
    });
    expect(await db.select().from(llmProviders)).toHaveLength(0);
  });

  it("rejects a default model the provider doesn't offer", async () => {
    const res = await req("POST", "/admin/llm-providers", { ...OPENAI, defaultModel: "nope" });
    expect(res.status).toBe(400);
  });

  it("validates kind-specific input", async () => {
    const noKey = await req("POST", "/admin/llm-providers", { ...OPENAI, apiKey: "" });
    expect(noKey.status).toBe(400);
    const baseUrl = await req("POST", "/admin/llm-providers", {
      ...OPENAI,
      kind: "anthropic",
      baseUrl: "http://localhost:11434/v1",
    });
    expect(baseUrl.status).toBe(400);
  });

  it("re-tests a replaced key and keeps the old one when the new one fails", async () => {
    const created = await createOpenAI();
    const bad = await req("PATCH", `/admin/llm-providers/${created.id}`, { apiKey: "sk-bad-0000" });
    expect(bad.status).toBe(502);
    const [row] = await db.select().from(llmProviders);
    expect(decryptSecret(row?.apiKeyEnc ?? "", TEST_MASTER_KEY)).toBe(SECRET_KEY);

    const renamed = await req("PATCH", `/admin/llm-providers/${created.id}`, { label: "Prod" });
    expect(llmProvider.parse(await renamed.json()).label).toBe("Prod");
  });

  it("records test results on the provider", async () => {
    const created = await createOpenAI();
    stub.handle(() => ({ status: 429, headers: { "retry-after": "30" }, json: { error: {} } }));
    const res = await req("POST", `/admin/llm-providers/${created.id}/test`);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: { details: { reason: "rate_limit", retryAfterSeconds: 30 } },
    });
    const list = llmProviderList.parse(await (await req("GET", "/admin/llm-providers")).json());
    expect(list.items[0]).toMatchObject({ lastTestError: "rate_limit" });
    expect(list.items[0]?.lastTestedAt).not.toBeNull();
  });

  it("clears the default when its provider is disabled or deleted", async () => {
    const created = await createOpenAI({ defaultModel: "gpt-a" });
    await req("PATCH", `/admin/llm-providers/${created.id}`, { enabled: false });
    expect(await (await req("GET", "/admin/settings/llm")).json()).toEqual({
      providerId: null,
      model: null,
    });

    const put = await req("PUT", "/admin/settings/llm", { providerId: created.id, model: "gpt-a" });
    expect(put.status).toBe(400);

    await req("PATCH", `/admin/llm-providers/${created.id}`, { enabled: true });
    await req("PUT", "/admin/settings/llm", { providerId: created.id, model: "gpt-a" });
    expect((await req("DELETE", `/admin/llm-providers/${created.id}`)).status).toBe(204);
    const [settings] = await db.select().from(instanceSettings).where(eq(instanceSettings.id, 1));
    expect(settings).toMatchObject({ defaultLlmProviderId: null, defaultModel: null });
    expect(llmStatus.parse(await (await req("GET", "/llm/status")).json())).toEqual({
      configured: false,
    });
  });

  it("lists a stored provider's models", async () => {
    const created = await createOpenAI();
    const res = await req("GET", `/admin/llm-providers/${created.id}/models`);
    expect(await res.json()).toMatchObject({ models: [{ id: "gpt-a" }, { id: "gpt-b" }] });
  });

  it("offers the fake provider only when enabled", async () => {
    const fake = { kind: "fake", label: "Fake", apiKey: "" };
    expect((await req("POST", "/admin/llm-providers", fake)).status).toBe(201);
    const invalid = await req("POST", "/admin/llm-providers/test", {
      kind: "fake",
      apiKey: FAKE_INVALID_KEY,
    });
    expect(invalid.status).toBe(502);

    app = buildApp(db, pool, { enableFakeLlm: false }).app;
    expect((await req("POST", "/admin/llm-providers", fake)).status).toBe(400);
  });
});

// Runs last: the suite above exercised success and failure paths with a key-echoing provider.
describe("key-leak check", () => {
  it("never puts an API key in a log line or response body", () => {
    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.some((line) => line.includes("llm provider call failed"))).toBe(true);
    for (const text of [...logLines, ...bodies]) {
      expect(text).not.toContain(SECRET_KEY);
      expect(text).not.toContain("sk-wrong-9999");
      expect(text).not.toContain("sk-bad-0000");
    }
  });

  it("redacts apiKey fields even if a caller logs one by mistake", () => {
    const lines: string[] = [];
    const sink = pino(
      { redact: { paths: redactPaths, censor: "[Redacted]" } },
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(chunk.toString("utf8"));
          done();
        },
      }),
    );
    sink.info({ provider: { apiKey: SECRET_KEY } }, "oops");
    expect(lines.join("")).not.toContain(SECRET_KEY);
  });
});
