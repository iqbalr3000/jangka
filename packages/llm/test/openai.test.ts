import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createProvider, type ProviderKind, type StreamEvent } from "../src/index";
import { collect, SECRET_KEY, type Stub, startStub } from "../src/testing";

let stub: Stub;
beforeAll(async () => {
  stub = await startStub();
});
afterAll(() => stub.close());

const provider = (kind: ProviderKind = "openai") =>
  createProvider({ kind, apiKey: SECRET_KEY, baseUrl: `${stub.url}/v1`, maxRetries: 0 });
const req = { model: "gpt-test", messages: [{ role: "user" as const, content: "Hi" }] };

function chunk(content: string | null, usage?: object) {
  return {
    id: "c1",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-test",
    choices: content === null ? [] : [{ index: 0, delta: { content }, finish_reason: null }],
    ...(usage && { usage }),
  };
}

function completion(content: string) {
  return {
    id: "c1",
    object: "chat.completion",
    created: 1,
    model: "gpt-test",
    choices: [
      { index: 0, message: { role: "assistant", content }, finish_reason: "stop", logprobs: null },
    ],
  };
}

const errorBody = (message: string) => ({ error: { message, type: "invalid_request_error" } });

describe("openai streamText", () => {
  it("streams deltas, puts the system prompt first, and reports usage", async () => {
    stub.handle(() => ({
      sse: [
        { data: chunk("Hel") },
        { data: chunk("lo") },
        { data: chunk(null, { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 }) },
      ],
      done: "[DONE]",
    }));
    const events = await collect(provider().streamText({ ...req, system: "Be brief" }));
    expect(events).toEqual([
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
      { type: "done", usage: { inputTokens: 9, outputTokens: 2 } },
    ]);
    const body = stub.requests[0]?.body as { messages: { role: string }[]; stream_options: object };
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("maps a 401 echoing the key to a normalized auth error", async () => {
    stub.handle(() => ({
      status: 401,
      json: errorBody(`Incorrect API key provided: ${SECRET_KEY}`),
    }));
    const [event] = await collect(provider().streamText(req));
    expect(event).toMatchObject({ type: "error", error: { code: "auth" } });
    expect(JSON.stringify(event)).not.toContain(SECRET_KEY);
    expect((event as Extract<StreamEvent, { type: "error" }>).error.message).not.toContain("sk-");
  });

  it("maps the context length error", async () => {
    stub.handle(() => ({
      status: 400,
      json: errorBody("This model's maximum context length is 128000 tokens."),
    }));
    const [event] = await collect(provider().streamText(req));
    expect(event).toMatchObject({ type: "error", error: { code: "context_length" } });
  });

  it("aborts mid-stream", async () => {
    stub.handle(() => ({ hang: true, sse: [{ data: chunk("Hi") }] }));
    const controller = new AbortController();
    const events: StreamEvent[] = [];
    for await (const event of provider().streamText(req, controller.signal)) {
      events.push(event);
      if (event.type === "text") controller.abort();
    }
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "aborted" } });
    await expect.poll(() => stub.closedEarly()).toBeGreaterThan(0);
  });
});

describe("openai generateObject", () => {
  const schema = z.object({ title: z.string(), note: z.string().optional() });

  it("uses strict json_schema and drops nulls for optional fields", async () => {
    stub.handle(() => ({ json: completion(JSON.stringify({ title: "PRD", note: null })) }));
    await expect(provider().generateObject(req, schema)).resolves.toEqual({ title: "PRD" });
    const body = stub.requests[0]?.body as {
      response_format: { type: string; json_schema: { strict: boolean; schema: object } };
    };
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema).toMatchObject({
      required: ["title", "note"],
      additionalProperties: false,
    });
  });

  it("retries when the content isn't valid JSON", async () => {
    let call = 0;
    stub.handle(() => {
      call++;
      return {
        json: completion(call === 1 ? "not json" : JSON.stringify({ title: "ok", note: null })),
      };
    });
    await expect(provider().generateObject(req, schema)).resolves.toEqual({ title: "ok" });
    expect(stub.requests).toHaveLength(2);
  });

  it("fails other providers' 400 instead of falling back", async () => {
    stub.handle(() => ({ status: 400, json: errorBody("response_format not supported") }));
    await expect(provider().generateObject(req, schema)).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("on OpenRouter falls back to a prompt-embedded schema when response_format is rejected", async () => {
    stub.handle((request) => {
      const body = request.body as { response_format?: unknown };
      return body.response_format
        ? { status: 400, json: errorBody("response_format not supported by this model") }
        : { json: completion('Sure! {"title": "Fallback"} hope that helps') };
    });
    await expect(provider("openrouter").generateObject(req, schema)).resolves.toEqual({
      title: "Fallback",
    });
    const fallback = stub.requests[1]?.body as { messages: { role: string; content: string }[] };
    expect(fallback.messages[0]).toMatchObject({ role: "system" });
    expect(fallback.messages[0]?.content).toContain("JSON Schema");
  });
});

describe("openai models and connection", () => {
  it("lists models sorted, with OpenRouter names and context windows", async () => {
    stub.handle(() => ({
      json: {
        object: "list",
        data: [
          { id: "z-model", object: "model", created: 1, owned_by: "x" },
          { id: "a-model", name: "A Model", context_length: 64000, object: "model", created: 1 },
        ],
      },
    }));
    await expect(provider().listModels()).resolves.toEqual([
      { id: "a-model", label: "A Model", contextWindow: 64000 },
      { id: "z-model", label: "z-model" },
    ]);
  });

  it("tests OpenAI keys via the models list", async () => {
    stub.handle(() => ({ json: { object: "list", data: [] } }));
    await provider().testConnection();
    expect(stub.requests[0]?.path).toBe("/v1/models");
  });

  it("tests OpenRouter keys via /key, since its model list is public", async () => {
    stub.handle(() => ({ json: { data: { label: "k" } } }));
    await provider("openrouter").testConnection();
    expect(stub.requests[0]?.path).toBe("/v1/key");
    expect(stub.requests[0]?.headers.authorization).toBe(`Bearer ${SECRET_KEY}`);
  });
});
