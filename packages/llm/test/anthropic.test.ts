import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createProvider, LLMError, type StreamEvent } from "../src/index";
import { collect, SECRET_KEY, type Stub, startStub } from "../src/testing";

let stub: Stub;
beforeAll(async () => {
  stub = await startStub();
});
afterAll(() => stub.close());

const provider = () =>
  createProvider({ kind: "anthropic", apiKey: SECRET_KEY, baseUrl: stub.url, maxRetries: 0 });
const req = { model: "claude-test", messages: [{ role: "user" as const, content: "Hi" }] };

function message(content: unknown[]) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-test",
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 5 },
  };
}

function errorBody(message: string) {
  return { type: "error", error: { type: "error", message } };
}

describe("anthropic streamText", () => {
  it("streams text deltas and reports usage", async () => {
    stub.handle(() => ({
      sse: [
        { event: "message_start", data: { type: "message_start", message: message([]) } },
        {
          event: "content_block_start",
          data: {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          },
        },
        {
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Hel" },
          },
        },
        {
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "lo" },
          },
        },
        { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
        {
          event: "message_delta",
          data: {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 7 },
          },
        },
        { event: "message_stop", data: { type: "message_stop" } },
      ],
    }));
    const events = await collect(provider().streamText({ ...req, system: "Be brief" }));
    expect(events).toEqual([
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
      { type: "done", usage: { inputTokens: 12, outputTokens: 7 } },
    ]);
    expect(stub.requests[0]?.path).toBe("/v1/messages");
    expect(stub.requests[0]?.headers.authorization).toBe(`Bearer ${SECRET_KEY}`);
    expect(stub.requests[0]?.body).toMatchObject({ system: "Be brief", stream: true });
  });

  it("yields a normalized error event instead of throwing", async () => {
    stub.handle(() => ({ status: 401, json: errorBody(`invalid x-api-key ${SECRET_KEY}`) }));
    const events = await collect(provider().streamText(req));
    expect(events).toHaveLength(1);
    const event = events[0] as Extract<StreamEvent, { type: "error" }>;
    expect(event.error.code).toBe("auth");
    expect(event.error.message).toBe("Key rejected by provider");
    expect(JSON.stringify(event)).not.toContain(SECRET_KEY);
  });

  it("aborts mid-stream and closes the provider request", async () => {
    stub.handle(() => ({
      hang: true,
      sse: [
        { event: "message_start", data: { type: "message_start", message: message([]) } },
        {
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Hi" },
          },
        },
      ],
    }));
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

describe("anthropic error mapping", () => {
  const cases: [number, Record<string, string>, string, string][] = [
    [429, { "retry-after": "30" }, "rate limited", "rate_limit"],
    [400, {}, "prompt is too long: 250000 tokens > 200000 maximum", "context_length"],
    [404, {}, "model: claude-nope", "invalid_request"],
    [529, {}, "overloaded", "provider_down"],
  ];
  it.each(cases)("maps %i to the right code", async (status, headers, text, code) => {
    stub.handle(() => ({ status, headers, json: errorBody(text) }));
    const error = await provider()
      .testConnection()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect((error as LLMError).code).toBe(code);
    if (code === "rate_limit") {
      expect((error as LLMError).message).toBe("Rate limited, try again in 30s");
    }
  });

  it("maps a refused connection to provider_down", async () => {
    const dead = createProvider({
      kind: "anthropic",
      apiKey: SECRET_KEY,
      baseUrl: "http://127.0.0.1:1",
      maxRetries: 0,
    });
    await expect(dead.testConnection()).rejects.toMatchObject({ code: "provider_down" });
  });
});

describe("anthropic generateObject", () => {
  const schema = z.object({ title: z.string(), tags: z.array(z.string()) });

  it("forces a tool call with the JSON schema and returns its input", async () => {
    stub.handle(() => ({
      json: message([
        { type: "tool_use", id: "t1", name: "respond", input: { title: "PRD", tags: ["a"] } },
      ]),
    }));
    await expect(provider().generateObject(req, schema)).resolves.toEqual({
      title: "PRD",
      tags: ["a"],
    });
    const body = stub.requests[0]?.body as {
      tools: { name: string; input_schema: { properties: object } }[];
      tool_choice: unknown;
    };
    expect(body.tool_choice).toEqual({ type: "tool", name: "respond" });
    expect(Object.keys(body.tools[0]?.input_schema.properties ?? {})).toEqual(["title", "tags"]);
  });

  it("retries with the validation error, then succeeds", async () => {
    let call = 0;
    stub.handle(() => {
      call++;
      const input = call === 1 ? { title: 42 } : { title: "ok", tags: [] };
      return { json: message([{ type: "tool_use", id: "t", name: "respond", input }]) };
    });
    await expect(provider().generateObject(req, schema)).resolves.toEqual({
      title: "ok",
      tags: [],
    });
    const retry = stub.requests[1]?.body as { messages: { role: string; content: string }[] };
    expect(retry.messages.at(-1)?.content).toContain("does not match the required schema");
  });

  it("gives up with invalid_output after 2 retries", async () => {
    stub.handle(() => ({
      json: message([{ type: "tool_use", id: "t", name: "respond", input: { nope: true } }]),
    }));
    await expect(provider().generateObject(req, schema)).rejects.toMatchObject({
      code: "invalid_output",
    });
    expect(stub.requests).toHaveLength(3);
  });
});

describe("anthropic models", () => {
  it("lists models with display names", async () => {
    stub.handle(() => ({
      json: {
        data: [
          {
            id: "claude-a",
            display_name: "Claude A",
            type: "model",
            created_at: "2026-01-01T00:00:00Z",
          },
        ],
        has_more: false,
        first_id: "claude-a",
        last_id: "claude-a",
      },
    }));
    await expect(provider().listModels()).resolves.toEqual([{ id: "claude-a", label: "Claude A" }]);
    expect(stub.requests[0]?.path).toMatch(/^\/v1\/models/);
  });
});
