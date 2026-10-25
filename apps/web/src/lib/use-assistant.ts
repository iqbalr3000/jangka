import type { AssistantEvent } from "@jangka/shared/assistant";
import type { Section } from "@jangka/shared/document";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { ApiError } from "./api";
import { chatQuery, streamAssistant } from "./assistant";
import { collectionsKey } from "./collections";
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

/**
 * Client side of the assistant for one document: runs one generation at a time over SSE, keeps
 * the streamed text, and reports saved sections back to the workspace.
 */
export function useAssistant(documentId: string, onSectionSaved: (section: Section) => void) {
  const queryClient = useQueryClient();
  const controller = useRef<AbortController | null>(null);
  const [running, setRunning] = useState<Kind | null>(null);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const replyText = useRef("");
  const messageId = useRef<string | null>(null);
  /** A reply the user stopped: shown until the server's saved copy (same id) arrives. */
  const [stopped, setStopped] = useState<{ id: string; content: string } | null>(null);
  const [draft, setDraft] = useState<DraftProgress | null>(null);
  const [streaming, setStreaming] = useState<Record<string, string>>({});
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [notice, setNotice] = useState<AssistantNotice | null>(null);

  const chatKey = chatQuery(documentId).queryKey;

  const run = useCallback(
    async (
      kind: Kind,
      path: string,
      body: unknown,
      onEvent: (event: AssistantEvent) => void,
      retry: () => void,
    ) => {
      if (controller.current) return;
      const abort = new AbortController();
      controller.current = abort;
      setRunning(kind);
      setNotice(null);
      setStopped(null);
      replyText.current = "";
      messageId.current = null;
      try {
        await streamAssistant(path, body, {
          signal: abort.signal,
          onEvent: (event) => {
            if (event.type === "error") {
              setNotice({
                message: event.message,
                retry: event.code === "aborted" ? undefined : retry,
              });
            } else if (event.type === "message_start") {
              messageId.current = event.messageId;
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
          setNotice({
            message: errorMessage(error),
            retry: error instanceof ApiError && error.status >= 500 ? retry : undefined,
          });
        }
      } finally {
        if (abort.signal.aborted && kind === "chat" && messageId.current) {
          setStopped({ id: messageId.current, content: replyText.current });
          // The server saves the interrupted reply just after the disconnect.
          setTimeout(() => void queryClient.invalidateQueries({ queryKey: chatKey }), 800);
        }
        controller.current = null;
        setRunning(null);
        setPendingUser(null);
        setReply(null);
        setDraft(null);
        setStreaming({});
        // A stopped revision leaves no half proposal behind.
        setProposals((p) =>
          Object.fromEntries(
            Object.entries(p).filter(([, proposal]) => proposal.status === "ready"),
          ),
        );
        await queryClient.invalidateQueries({ queryKey: chatKey });
        await queryClient.invalidateQueries({ queryKey: collectionsKey });
      }
    },
    [queryClient, chatKey],
  );

  const sendChat = useCallback(
    (message: string) => {
      setPendingUser(message);
      setReply("");
      void run(
        "chat",
        `/documents/${documentId}/chat`,
        { message },
        (event) => {
          if (event.type === "text") {
            replyText.current += event.delta;
            setReply(replyText.current);
          }
        },
        () => sendChat(message),
      );
    },
    [documentId, run],
  );

  const draftSections = useCallback(
    (options: {
      sections?: string[];
      force?: boolean;
      fromSource?: boolean;
      targets: string[];
    }) => {
      setDraft({ targets: options.targets, current: null, finished: [] });
      void run(
        "draft",
        `/documents/${documentId}/draft`,
        { sections: options.sections, force: options.force, fromSource: options.fromSource },
        (event) => {
          if (event.type === "section_start") {
            setDraft((d) => d && { ...d, current: event.key });
            setStreaming((s) => ({ ...s, [event.key]: "" }));
          } else if (event.type === "text" && event.sectionKey) {
            const key = event.sectionKey;
            setStreaming((s) => ({ ...s, [key]: (s[key] ?? "") + event.delta }));
          } else if (event.type === "section_done") {
            onSectionSaved(event.section);
            setDraft(
              (d) => d && { ...d, current: null, finished: [...d.finished, event.section.key] },
            );
            setStreaming(({ [event.section.key]: _done, ...rest }) => rest);
          } else if (event.type === "section_skipped" || event.type === "section_conflict") {
            setDraft((d) => d && { ...d, finished: [...d.finished, event.key] });
            if (event.type === "section_conflict") {
              setNotice({
                message: "A section was edited while it was being drafted; your edit was kept.",
              });
            }
          }
        },
        () => draftSections(options),
      );
    },
    [documentId, run, onSectionSaved],
  );

  const revise = useCallback(
    (key: string, instruction: string) => {
      setProposals((p) => ({ ...p, [key]: { instruction, markdown: "", status: "streaming" } }));
      void run(
        "revise",
        `/documents/${documentId}/sections/${key}/revise`,
        { instruction },
        (event) => {
          if (event.type === "text" && event.sectionKey === key) {
            setProposals((p) => {
              const current = p[key];
              return current
                ? { ...p, [key]: { ...current, markdown: current.markdown + event.delta } }
                : p;
            });
          } else if (event.type === "proposal" && event.sectionKey === key) {
            // The server fixed diagrams the stream contained.
            setProposals((p) => {
              const current = p[key];
              return current ? { ...p, [key]: { ...current, markdown: event.markdown } } : p;
            });
          } else if (event.type === "done") {
            setProposals((p) => {
              const current = p[key];
              return current ? { ...p, [key]: { ...current, status: "ready" } } : p;
            });
          } else if (event.type === "error") {
            setProposals(({ [key]: _failed, ...rest }) => rest);
          }
        },
        () => revise(key, instruction),
      );
    },
    [documentId, run],
  );

  const stop = useCallback(() => controller.current?.abort(), []);

  const clearProposal = useCallback((key: string) => {
    setProposals(({ [key]: _gone, ...rest }) => rest);
  }, []);

  return {
    running,
    pendingUser,
    reply,
    stopped,
    draft,
    streaming,
    proposals,
    notice,
    dismissNotice: () => setNotice(null),
    sendChat,
    draftSections,
    revise,
    stop,
    clearProposal,
  };
}

export type Assistant = ReturnType<typeof useAssistant>;
