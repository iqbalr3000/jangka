import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createProvider, type StreamEvent } from "../src/index";
import { collect, SECRET_KEY, type Stub, startStub } from "../src/testing";

let stub: Stub;
beforeAll(async () => {
  stub = await startStub();
});
afterAll(() => stub.close());

const provider = () =>
  createProvider({ kind: "gemini", apiKey: SECRET_KEY, baseUrl: stub.url, maxRetries: 0 });
const req = {
  model: "gemini-test",
  messages: [
    { role: "user" as const, content: "Hi" },
    { role: "assistant" as const, content: "Hello" },
    { role: "user" as const, content: "More" },
  ],
};

function response(text: string, usage?: object) {
  return {
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }],
    ...(usage && { usageMetadata: usage }),
  };
}

const errorBody = (code: number, message: string) => ({
  error: { code, message, status: "ERROR" },
});

describe("gemini streamText", () => {
  it("streams text, maps roles, and reports usage", async () => {
    stub.handle(() => ({
      sse: [
        { data: response("Hel") },
        { data: response("lo", { promptTokenCount: 8, candidatesTokenCount: 2 }) },
      ],
    }));
    const events = await collect(provider().streamText({ ...req, system: "Be brief" }));
    expect(events).toEqual([
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
      { type: "done", usage: { inputTokens: 8, outputTokens: 2 } },
    ]);
    const request = stub.requests[0];
    expect(request?.path).toContain("/models/gemini-test:streamGenerateContent");
    const body = request?.body as { contents: { role: string }[]; systemInstruction: unknown };
    expect(body.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(JSON.stringify(body.systemInstruction)).toContain("Be brief");
  });

  it("maps Gemini's 400 invalid-key response to auth, without leaking the key", async () => {
    stub.handle(() => ({
      status: 400,
      json: errorBody(400, `API key not valid: ${SECRET_KEY}`),
    }));
    const [event] = await collect(provider().streamText(req));
    expect(event).toMatchObject({ type: "error", error: { code: "auth" } });
    expect(JSON.stringify(event)).not.toContain(SECRET_KEY);
    expect((event as Extract<StreamEvent, { type: "error" }>).error.message).not.toContain(
      SECRET_KEY,
    );
  });

  it("maps 429 and 503", async () => {
    stub.handle(() => ({ status: 429, json: errorBody(429, "quota") }));
    await expect(provider().testConnection()).rejects.toMatchObject({ code: "rate_limit" });
    stub.handle(() => ({ status: 503, json: errorBody(503, "unavailable") }));
    await expect(provider().testConnection()).rejects.toMatchObject({ code: "provider_down" });
  });
});

describe("gemini generateObject", () => {
  it("requests JSON with a schema stripped of unsupported keywords", async () => {
    const schema = z.object({ title: z.string() });
    stub.handle(() => ({ json: response(JSON.stringify({ title: "PRD" })) }));
    await expect(provider().generateObject(req, schema)).resolves.toEqual({ title: "PRD" });
    const body = stub.requests[0]?.body as {
      generationConfig: { responseMimeType: string; responseJsonSchema: Record<string, unknown> };
    };
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema).toMatchObject({ type: "object" });
    expect(body.generationConfig.responseJsonSchema).not.toHaveProperty("additionalProperties");
    expect(body.generationConfig.responseJsonSchema).not.toHaveProperty("$schema");
  });
});

describe("gemini models", () => {
  it("lists only generateContent models, without the models/ prefix", async () => {
    stub.handle(() => ({
      json: {
        models: [
          {
            name: "models/gemini-a",
            displayName: "Gemini A",
            inputTokenLimit: 1000000,
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/embed-b",
            displayName: "Embed B",
            supportedGenerationMethods: ["embedContent"],
          },
        ],
      },
    }));
    await expect(provider().listModels()).resolves.toEqual([
      { id: "gemini-a", label: "Gemini A", contextWindow: 1000000 },
    ]);
  });
});
