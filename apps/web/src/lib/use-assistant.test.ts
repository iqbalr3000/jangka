import type { AssistantEvent } from "@jangka/shared/assistant";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistantStore } from "./use-assistant";

type FakeStream = {
  path: string;
  signal: AbortSignal;
  emit: (event: AssistantEvent) => void;
  end: () => void;
};

// The real module listens on `window`; these tests run in Node.
vi.mock("./connection", () => ({ reportRequest: () => {} }));

// Each run opens a stream the test drives by hand; aborting rejects it like fetch does.
const { streams } = vi.hoisted(() => ({ streams: [] as FakeStream[] }));
vi.mock("./assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./assistant")>()),
  streamAssistant: (
    path: string,
    _body: unknown,
    { signal, onEvent }: { signal: AbortSignal; onEvent: (event: AssistantEvent) => void },
  ) =>
    new Promise<void>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      streams.push({ path, signal, emit: onEvent, end: resolve });
    }),
}));

function stream(index: number): FakeStream {
  const found = streams[index];
  if (!found) throw new Error(`stream ${index} not opened`);
  return found;
}

const coverage: AssistantEvent = {
  type: "coverage",
  state: { sections: [], openQuestions: [], readyToDraft: false },
};

let store: ReturnType<typeof createAssistantStore>;
const state = () => store.getSnapshot();

beforeEach(() => {
  streams.length = 0;
  store = createAssistantStore("doc-1", new QueryClient());
});

describe("chat", () => {
  it("frees the composer at reply_done while coverage is still assessed", async () => {
    store.actions.sendChat("Refunds take too long");
    stream(0).emit({ type: "message_start", messageId: "m1" });
    stream(0).emit({ type: "text", delta: "Which refunds?" });
    expect(state()).toMatchObject({ running: "chat", reply: "Which refunds?" });

    stream(0).emit({ type: "reply_done", messageId: "m1" });
    expect(state()).toMatchObject({ running: null, coverageUpdating: true });

    stream(0).emit(coverage);
    stream(0).end();
    await vi.waitFor(() => expect(state().coverageUpdating).toBe(false));
  });

  it("ignores a second message while a reply is still streaming", () => {
    store.actions.sendChat("First");
    store.actions.sendChat("Second");
    expect(streams).toHaveLength(1);
  });

  it("a message sent during coverage replaces that stream, and the old one can't reset the new turn", async () => {
    store.actions.sendChat("First");
    stream(0).emit({ type: "message_start", messageId: "m1" });
    stream(0).emit({ type: "reply_done", messageId: "m1" });

    store.actions.sendChat("Second");
    expect(stream(0).signal.aborted).toBe(true);
    expect(streams).toHaveLength(2);

    // The aborted stream's cleanup runs after the new turn started.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state()).toMatchObject({
      running: "chat",
      pendingUser: "Second",
      coverageUpdating: false,
    });
  });

  it("keeps a stopped reply's text until the saved copy arrives", async () => {
    store.actions.sendChat("Explain the flow");
    stream(0).emit({ type: "message_start", messageId: "m1" });
    stream(0).emit({ type: "text", delta: "First the user" });
    store.actions.stop();
    await vi.waitFor(() => expect(state().running).toBeNull());
    expect(state().stopped).toEqual({ id: "m1", content: "First the user" });
  });
});

describe("revise", () => {
  it("a stopped revision leaves no half proposal behind", async () => {
    store.actions.revise("goals", "Make the goals measurable");
    stream(0).emit({ type: "text", delta: "| ID |", sectionKey: "goals" });
    expect(state().proposals.goals).toMatchObject({ status: "streaming", markdown: "| ID |" });

    store.actions.stop();
    await vi.waitFor(() => expect(state().running).toBeNull());
    expect(state().proposals).toEqual({});
  });

  it("keeps a finished proposal for the user to accept", async () => {
    store.actions.revise("goals", "Make the goals measurable");
    stream(0).emit({ type: "text", delta: "Draft", sectionKey: "goals" });
    stream(0).emit({ type: "proposal", sectionKey: "goals", markdown: "Fixed draft" });
    stream(0).emit({ type: "done", usage: { inputTokens: 1, outputTokens: 1 } });
    stream(0).end();
    await vi.waitFor(() => expect(state().running).toBeNull());
    expect(state().proposals.goals).toMatchObject({ status: "ready", markdown: "Fixed draft" });
  });
});
