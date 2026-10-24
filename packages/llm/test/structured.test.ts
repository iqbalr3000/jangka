import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createProvider,
  FAKE_INVALID_KEY,
  fakeResponses,
  LLMError,
  llmErrorCodes,
} from "../src/index";
import {
  extractJson,
  jsonSchemaOf,
  stripNullOptionals,
  toGeminiSchema,
  toOpenAIStrict,
} from "../src/structured";
import { collect } from "../src/testing";

const schema = z.object({
  title: z.string(),
  note: z.string().optional(),
  items: z.array(z.object({ id: z.string(), hint: z.string().optional() })),
});

describe("toOpenAIStrict", () => {
  it("requires every property, makes optional ones nullable, closes objects", () => {
    const strict = toOpenAIStrict(jsonSchemaOf(schema));
    expect(strict).toMatchObject({
      required: ["title", "note", "items"],
      additionalProperties: false,
      properties: { note: { anyOf: [{ type: "string" }, { type: "null" }] } },
    });
    const item = (strict.properties as { items: { items: object } }).items.items;
    expect(item).toMatchObject({ required: ["id", "hint"], additionalProperties: false });
  });

  it("strips nulls of optional fields from the output, keeping required ones", () => {
    const original = jsonSchemaOf(schema);
    expect(
      stripNullOptionals({ title: "t", note: null, items: [{ id: "1", hint: null }] }, original),
    ).toEqual({ title: "t", items: [{ id: "1" }] });
  });
});

describe("toGeminiSchema", () => {
  it("drops unsupported keywords at every depth", () => {
    const gemini = JSON.stringify(toGeminiSchema(jsonSchemaOf(schema)));
    expect(gemini).not.toContain("additionalProperties");
    expect(gemini).not.toContain("$schema");
  });
});

describe("extractJson", () => {
  it("finds the first balanced object in prose", () => {
    expect(extractJson('Here: {"a": {"b": "}"}} trailing')).toEqual({ a: { b: "}" } });
    expect(extractJson("no json")).toBe("no json");
  });
});

describe("LLMError", () => {
  it("only ever carries normalized messages", () => {
    for (const code of llmErrorCodes) {
      expect(new LLMError(code).message).not.toMatch(/sk-|key:/i);
    }
  });
});

describe("fake provider", () => {
  const fake = createProvider({ kind: "fake", apiKey: "" });
  const req = { model: "fake-small", messages: [{ role: "user" as const, content: "Hello" }] };

  it("streams a deterministic reply", async () => {
    const events = await collect(fake.streamText(req));
    const text = events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
    expect(text).toBe("This is a fake reply to: Hello");
    expect(events.at(-1)?.type).toBe("done");
  });

  it("honors abort", async () => {
    const controller = new AbortController();
    const events = [];
    for await (const event of fake.streamText(req, controller.signal)) {
      events.push(event);
      controller.abort();
    }
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "aborted" } });
  });

  it("returns queued objects through the same validation", async () => {
    fakeResponses({ wrong: true }, { ok: true });
    await expect(fake.generateObject(req, z.object({ ok: z.boolean() }))).resolves.toEqual({
      ok: true,
    });
  });

  it("rejects the invalid key", async () => {
    const bad = createProvider({ kind: "fake", apiKey: FAKE_INVALID_KEY });
    await expect(bad.testConnection()).rejects.toMatchObject({ code: "auth" });
    await expect(fake.listModels()).resolves.toHaveLength(2);
  });
});
