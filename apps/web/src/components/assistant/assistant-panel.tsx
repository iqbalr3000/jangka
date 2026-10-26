import type { ChatMessage } from "@jangka/shared/assistant";
import type { Section } from "@jangka/shared/document";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { CommentsPanel } from "@/components/documents/comments-panel";
import { HistoryPanel } from "@/components/documents/history-panel";
import { TracePanel } from "@/components/documents/trace-panel";
import { LoadingRows } from "@/components/loading-rows";
import { Button } from "@/components/ui/button";
import { chatQuery } from "@/lib/assistant";
import { docTypeLabels } from "@/lib/trace";
import type { Assistant } from "@/lib/use-assistant";
import { useSmoothText } from "@/lib/use-smooth-text";
import { cn } from "@/lib/utils";
import { ChatComposer } from "./chat-composer";
import { CoverageChecklist } from "./coverage-checklist";
import { ThinkingIndicator } from "./thinking-indicator";

export const panelTabs = ["chat", "history", "trace", "comments"] as const;
export type PanelTab = (typeof panelTabs)[number];

type AssistantPanelProps = {
  documentId: string;
  documentTitle: string;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  historyKey: string;
  onHistoryKeyChange: (key: string) => void;
  onRestored: (section: Section) => void;
  commentsKey: string;
  onCommentsKeyChange: (key: string) => void;
  sections: Section[];
  assistant: Assistant;
  editable: boolean;
  llmConfigured: boolean;
  isAdmin: boolean;
  composer: string;
  onComposerChange: (value: string) => void;
  /** `@Section instruction` messages revise that section instead of chatting. */
  onRevise: (key: string, instruction: string) => void;
  /** Visibility per breakpoint, set by the document layout. */
  className?: string;
};

/** "@Non-Functional Requirements make it measurable" → section + instruction. */
function parseMention(message: string, sections: Section[]) {
  const lower = message.toLowerCase();
  const section = [...sections]
    .sort((a, b) => b.title.length - a.title.length)
    .find((s) => lower.startsWith(`@${s.title.toLowerCase()} `));
  if (!section) return null;
  const instruction = message.slice(section.title.length + 2).trim();
  return instruction ? { key: section.key, instruction } : null;
}

type DisplayMessage = Pick<ChatMessage, "id" | "role" | "content" | "author" | "interrupted"> &
  Partial<Pick<ChatMessage, "references">>;

function Message({
  message,
  live = false,
  streaming = false,
  referenceCount = 0,
}: {
  message: DisplayMessage;
  /** The latest reply: typed out instead of shown whole. */
  live?: boolean;
  /** More text is still on its way. */
  streaming?: boolean;
  referenceCount?: number;
}) {
  const assistant = message.role === "assistant";
  const text = useSmoothText(message.content, live);
  const typing = streaming || text.length < message.content.length;
  return (
    <li className={cn("flex flex-col gap-1", !assistant && "items-end")}>
      <span className="font-mono text-[11px] text-muted-foreground">
        {assistant ? "AI" : (message.author?.name ?? "You")}
      </span>
      <p
        className={cn(
          "max-w-[95%] rounded-md px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap",
          assistant ? "bg-secondary" : "border border-border bg-card",
        )}
      >
        {assistant && message.content === "" && streaming ? (
          <ThinkingIndicator referenceCount={referenceCount} />
        ) : (
          text || "…"
        )}
        {typing && text !== "" && (
          <span className="ml-0.5 animate-pulse text-primary" aria-hidden>
            ▍
          </span>
        )}
        {message.interrupted && (
          <span className="ml-1 text-xs text-muted-foreground">(interrupted)</span>
        )}
      </p>
      {message.references && message.references.length > 0 && (
        <span className="flex max-w-[95%] flex-wrap gap-x-2 text-[11px] text-muted-foreground">
          Referenced:
          {message.references.map((ref) => (
            <Link
              key={`${ref.documentId}:${ref.sectionKey}`}
              to="/d/$documentId"
              params={{ documentId: ref.documentId }}
              className="text-primary hover:underline"
            >
              {docTypeLabels[ref.docType]} {ref.title} › {ref.sectionTitle}
            </Link>
          ))}
        </span>
      )}
    </li>
  );
}

export function AssistantPanel({
  documentId,
  documentTitle,
  tab,
  onTabChange,
  historyKey,
  onHistoryKeyChange,
  onRestored,
  commentsKey,
  onCommentsKeyChange,
  sections,
  assistant,
  editable,
  llmConfigured,
  isAdmin,
  composer,
  onComposerChange,
  onRevise,
  className,
}: AssistantPanelProps) {
  const chat = useQuery(chatQuery(documentId));
  const end = useRef<HTMLLIElement>(null);
  const messages = chat.data?.messages ?? [];
  const hasDrafted = messages.some((m) => m.kind === "draft");

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the conversation grows
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, assistant.reply, assistant.pendingUser]);

  // One keyed list: the live reply keeps its typing state when its saved copy (same id) arrives.
  const saved = new Set(messages.map((m) => m.id));
  const display: DisplayMessage[] = [...messages];
  const { stopped, pendingUser, reply, replyId } = assistant;
  if (stopped && !saved.has(stopped.id)) {
    display.push({
      id: stopped.id,
      role: "assistant",
      content: stopped.content,
      author: null,
      interrupted: true,
    });
  }
  if (pendingUser) {
    display.push({
      id: "pending-user",
      role: "user",
      content: pendingUser,
      author: null,
      interrupted: false,
    });
  }
  if (reply !== null) {
    const id = replyId ?? "pending-reply";
    if (!saved.has(id) && stopped?.id !== id) {
      display.push({ id, role: "assistant", content: reply, author: null, interrupted: false });
    }
  }
  const replyStreaming = assistant.running === "chat";

  function send(message: string) {
    const mention = parseMention(message, sections);
    if (mention) onRevise(mention.key, mention.instruction);
    else assistant.sendChat(message);
  }

  return (
    <aside
      aria-label="Assistant"
      className={cn(
        "shrink-0 flex-col border-border bg-card lg:w-[320px] lg:border-l xl:w-[360px]",
        className,
      )}
    >
      <div role="tablist" className="flex gap-4 border-b border-border px-4 text-[13px]">
        {panelTabs.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => onTabChange(name)}
            className={cn(
              "-mb-px border-b-2 py-2.5 font-medium capitalize",
              tab === name
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === "trace" ? (
        <TracePanel documentId={documentId} title={documentTitle} editable={editable} />
      ) : tab === "comments" ? (
        <CommentsPanel
          documentId={documentId}
          sections={sections}
          sectionKey={commentsKey}
          onSectionChange={onCommentsKeyChange}
        />
      ) : tab === "history" ? (
        <HistoryPanel
          documentId={documentId}
          sections={sections}
          editable={editable}
          sectionKey={historyKey}
          onSectionChange={onHistoryKeyChange}
          onRestored={onRestored}
        />
      ) : (
        <>
          {chat.data && (
            <CoverageChecklist
              key={hasDrafted ? "drafted" : "interview"}
              state={chat.data.state}
              sections={sections}
              defaultOpen={!hasDrafted}
              updating={assistant.coverageUpdating}
            />
          )}
          <ol className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-3">
            {chat.isPending && (
              <li>
                <LoadingRows />
              </li>
            )}
            {chat.data && messages.length === 0 && !assistant.pendingUser && (
              <li className="text-[13px] text-muted-foreground">
                Start by describing the problem this document should solve. The assistant asks
                follow-up questions before drafting anything.
              </li>
            )}
            {display.map((m) => {
              const live = m.role === "assistant" && (m.id === replyId || m.id === "pending-reply");
              return (
                <Message
                  key={m.id}
                  message={m}
                  live={live && !m.interrupted}
                  streaming={live && replyStreaming}
                  referenceCount={assistant.referenceCount}
                />
              );
            })}
            {assistant.notice && (
              <li
                role="alert"
                className="flex flex-col gap-2 rounded-sm bg-diff-del px-3 py-2 text-[13px] text-destructive"
              >
                {assistant.notice.message}
                <span className="flex gap-2">
                  {assistant.notice.retry && (
                    <Button size="xs" variant="outline" onClick={assistant.notice.retry}>
                      Retry
                    </Button>
                  )}
                  <Button size="xs" variant="ghost" onClick={assistant.dismissNotice}>
                    Dismiss
                  </Button>
                </span>
              </li>
            )}
            <li ref={end} aria-hidden />
          </ol>
          {!llmConfigured && editable && (
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              No LLM provider is configured.{" "}
              {isAdmin && (
                <Link to="/admin/llm" className="text-primary hover:underline">
                  Set one up
                </Link>
              )}
            </p>
          )}
          {editable && (
            <ChatComposer
              sections={sections}
              value={composer}
              onChange={onComposerChange}
              running={assistant.running !== null}
              disabled={!llmConfigured}
              onSend={send}
              onStop={assistant.stop}
            />
          )}
        </>
      )}
    </aside>
  );
}
