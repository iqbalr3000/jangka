import type { AssistantEvent } from "@jangka/shared/assistant";
import type { Section } from "@jangka/shared/document";
import { notifyManager, type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import { ApiError } from "./api";
import { chatQuery, streamAssistant } from "./assistant";
import { collectionsKey } from "./collections";
import { applySavedSection } from "./documents";
import { errorMessage } from "./form-errors";

export type Proposal = {
  instruction: string;
  markdown: string;
  status: "streaming" | "ready";
};

export type DraftProgress = {
  targets: string[];
  current: string | null;
  finished: string[];
};

export type AssistantNotice = { message: string; retry?: () => void };

type Kind = "chat" | "draft" | "revise";

type AssistantState = {
  running: Kind | null;
  /** The last chat reply is saved; its coverage is still being assessed. */
  coverageUpdating: boolean;
  pendingUser: string | null;
  reply: string | null;
  /** Id of the latest chat reply, live or saved; the panel animates that message. */
  replyId: string | null;
  referenceCount: number;
  /** A reply the user stopped: shown until the server's saved copy (same id) arrives. */
  stopped: { id: string; content: string } | null;
  draft: DraftProgress | null;
  streaming: Record<string, string>;
  proposals: Record<string, Proposal>;
  notice: AssistantNotice | null;
  /** Bumped to remount a section's editor with content written outside it (drafts, accepts). */
  generations: Record<string, number>;
};

const initialState: AssistantState = {
  running: null,
  coverageUpdating: false,
  pendingUser: null,
  reply: null,
  replyId: null,
  referenceCount: 0,
  stopped: null,
  draft: null,
  streaming: {},
  proposals: {},
  notice: null,
  generations: {},
};

/**
 * Client side of the assistant for one document: runs one generation at a time over SSE and keeps
 * the streamed text. It lives outside the page, so a draft keeps going (and stays visible) when
 * the user navigates away and back; closing or reloading the tab still stops it.
 */
export function createAssistantStore(documentId: string, queryClient: QueryClient) {
  let state = initialState;
  const listeners = new Set<() => void>();
  const chatKey = chatQuery(documentId).queryKey;
  let controller: AbortController | null = null;
  /** Identifies the latest run, so an older run's cleanup can't reset a newer run's state. */
  let runId = 0;
  /** The open stream only assesses coverage: a new run may replace it. */
  let coverageOnly = false;
  let replyText = "";
  let messageId: string | null = null;

  function set(update: Partial<AssistantState> | ((s: AssistantState) => Partial<AssistantState>)) {
    state = { ...state, ...(typeof update === "function" ? update(state) : update) };
    for (const listener of listeners) listener();
  }

  /**
   * Remounts in the same flush as query observers, which are notified on a later tick: earlier,
   * the editor would mount with the old content.
   */
  function remountSection(key: string) {
    notifyManager.schedule(() =>
      set((s) => ({ generations: { ...s.generations, [key]: (s.generations[key] ?? 0) + 1 } })),
    );
  }

  /** Saves into the document cache and remounts the section's editor with the new content. */
  function replaceSection(saved: Section) {
    applySavedSection(queryClient, documentId, saved);
    remountSection(saved.key);
  }

  async function run(
    kind: Kind,
    path: string,
    body: unknown,
    onEvent: (event: AssistantEvent) => void,
    retry: () => void,
  ) {
    if (controller) {
      if (!coverageOnly) return;
      // The next turn reassesses coverage.
      controller.abort();
    }
    const id = ++runId;
    const isCurrent = () => runId === id;
    const abort = new AbortController();
    controller = abort;
    coverageOnly = false;
    let replied = false;
    replyText = "";
    messageId = null;
    set({
      running: kind,
      coverageUpdating: false,
      referenceCount: 0,
      notice: null,
      stopped: null,
    });
    try {
      await streamAssistant(path, body, {
        signal: abort.signal,
        onEvent: (event) => {
          if (event.type === "error") {
            set({
              notice: {
                message: event.message,
                retry: event.code === "aborted" ? undefined : retry,
              },
            });
          } else if (event.type === "message_start") {
            messageId = event.messageId;
            if (kind === "chat") set({ replyId: event.messageId });
          } else if (event.type === "references") {
            set({ referenceCount: event.items.length });
          } else if (event.type === "reply_done") {
            replied = true;
            coverageOnly = true;
            set({ running: null, coverageUpdating: true });
            void queryClient.invalidateQueries({ queryKey: chatKey }).then(() => {
              if (isCurrent()) set({ pendingUser: null });
            });
          } else if (event.type === "coverage") {
            queryClient.setQueryData(chatKey, (current) =>
              current ? { ...current, state: event.state } : current,
            );
          }
          onEvent(event);
        },
      });
    } catch (error) {
      if (!abort.signal.aborted) {
        set({
          notice: {
            message: errorMessage(error),
            retry: error instanceof ApiError && error.status >= 500 ? retry : undefined,
          },
        });
      }
    } finally {
      // A run replaced while only coverage was left leaves the state to the newer run.
      if (isCurrent()) {
        if (abort.signal.aborted && kind === "chat" && messageId && !replied) {
          set({ stopped: { id: messageId, content: replyText } });
          // The server saves the interrupted reply just after the disconnect.
          setTimeout(() => void queryClient.invalidateQueries({ queryKey: chatKey }), 800);
        }
        controller = null;
        coverageOnly = false;
        set((s) => ({
          running: null,
          coverageUpdating: false,
          pendingUser: null,
          reply: null,
          draft: null,
          streaming: {},
          // A stopped revision leaves no half proposal behind.
          proposals: Object.fromEntries(
            Object.entries(s.proposals).filter(([, proposal]) => proposal.status === "ready"),
          ),
        }));
        await queryClient.invalidateQueries({ queryKey: chatKey });
        await queryClient.invalidateQueries({ queryKey: collectionsKey });
      }
    }
  }

  function sendChat(message: string) {
    set({ pendingUser: message, reply: "", replyId: null });
    void run(
      "chat",
      `/documents/${documentId}/chat`,
      { message },
      (event) => {
        if (event.type === "text") {
          replyText += event.delta;
          set({ reply: replyText });
        }
      },
      () => sendChat(message),
    );
  }

  function draftSections(options: {
    sections?: string[];
    force?: boolean;
    fromSource?: boolean;
    targets: string[];
  }) {
    set({ draft: { targets: options.targets, current: null, finished: [] } });
    void run(
      "draft",
      `/documents/${documentId}/draft`,
      { sections: options.sections, force: options.force, fromSource: options.fromSource },
      (event) => {
        if (event.type === "section_start") {
          set((s) => ({
            draft: s.draft && { ...s.draft, current: event.key },
            streaming: { ...s.streaming, [event.key]: "" },
          }));
        } else if (event.type === "text" && event.sectionKey) {
          const key = event.sectionKey;
          set((s) => ({
            streaming: { ...s.streaming, [key]: (s.streaming[key] ?? "") + event.delta },
          }));
        } else if (event.type === "section_done") {
          const { key } = event.section;
          replaceSection(event.section);
          set((s) => {
            const { [key]: _done, ...rest } = s.streaming;
            return {
              draft: s.draft && { ...s.draft, current: null, finished: [...s.draft.finished, key] },
              streaming: rest,
            };
          });
        } else if (event.type === "section_skipped" || event.type === "section_conflict") {
          set((s) => ({
            draft: s.draft && { ...s.draft, finished: [...s.draft.finished, event.key] },
          }));
          if (event.type === "section_conflict") {
            set({
              notice: {
                message: "A section was edited while it was being drafted; your edit was kept.",
              },
            });
          }
        }
      },
      () => draftSections(options),
    );
  }

  function updateProposal(key: string, update: (p: Proposal) => Proposal) {
    set((s) => {
      const current = s.proposals[key];
      return current ? { proposals: { ...s.proposals, [key]: update(current) } } : {};
    });
  }

  function clearProposal(key: string) {
    set((s) => {
      const { [key]: _gone, ...rest } = s.proposals;
      return { proposals: rest };
    });
  }

  function revise(key: string, instruction: string) {
    set((s) => ({
      proposals: { ...s.proposals, [key]: { instruction, markdown: "", status: "streaming" } },
    }));
    void run(
      "revise",
      `/documents/${documentId}/sections/${key}/revise`,
      { instruction },
      (event) => {
        if (event.type === "text" && event.sectionKey === key) {
          updateProposal(key, (p) => ({ ...p, markdown: p.markdown + event.delta }));
        } else if (event.type === "proposal" && event.sectionKey === key) {
          // The server fixed diagrams the stream contained.
          updateProposal(key, (p) => ({ ...p, markdown: event.markdown }));
        } else if (event.type === "done") {
          updateProposal(key, (p) => ({ ...p, status: "ready" }));
        } else if (event.type === "error") {
          clearProposal(key);
        }
      },
      () => revise(key, instruction),
    );
  }

  /** Proposes updates to sections the chat added facts to; each becomes a reviewable proposal. */
  function proposeUpdates(suggestions: { key: string; reason: string }[]) {
    const reasons = new Map(suggestions.map((s) => [s.key, s.reason]));
    const started = new Set<string>();
    const ready = new Set<string>();
    void run(
      "revise",
      `/documents/${documentId}/propose-updates`,
      { sections: [...reasons.keys()] },
      (event) => {
        if (event.type === "text" && event.sectionKey && reasons.has(event.sectionKey)) {
          const key = event.sectionKey;
          const instruction = `From chat: ${reasons.get(key) ?? ""}`;
          // The first delta replaces any earlier proposal for this section.
          const markdown = started.has(key) ? (state.proposals[key]?.markdown ?? "") : "";
          started.add(key);
          set((s) => ({
            proposals: {
              ...s.proposals,
              [key]: { instruction, markdown: markdown + event.delta, status: "streaming" },
            },
          }));
        } else if (event.type === "proposal_ready" && reasons.has(event.sectionKey)) {
          const key = event.sectionKey;
          ready.add(key);
          set((s) => ({
            proposals: {
              ...s.proposals,
              [key]: {
                instruction: `From chat: ${reasons.get(key) ?? ""}`,
                markdown: event.markdown,
                status: "ready",
              },
            },
          }));
        }
      },
      // Ready sections already left the server's suggestions.
      () => proposeUpdates(suggestions.filter((s) => !ready.has(s.key))),
    );
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    actions: {
      sendChat,
      draftSections,
      revise,
      proposeUpdates,
      replaceSection,
      remountSection,
      clearProposal,
      stop: () => controller?.abort(),
      dismissNotice: () => set({ notice: null }),
    },
  };
}

type AssistantStore = ReturnType<typeof createAssistantStore>;

/** One store per document for the life of the tab (one QueryClient per app). */
const stores = new Map<string, AssistantStore>();

export function useAssistant(documentId: string) {
  const queryClient = useQueryClient();
  const store = useMemo(() => {
    let existing = stores.get(documentId);
    if (!existing) {
      existing = createAssistantStore(documentId, queryClient);
      stores.set(documentId, existing);
    }
    return existing;
  }, [documentId, queryClient]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { ...state, ...store.actions };
}

export type Assistant = ReturnType<typeof useAssistant>;
