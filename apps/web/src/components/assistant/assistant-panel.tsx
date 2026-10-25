import type { ChatMessage } from "@jangka/shared/assistant";
import type { Section } from "@jangka/shared/document";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { TracePanel } from "@/components/documents/trace-panel";
import { Button } from "@/components/ui/button";
import { chatQuery } from "@/lib/assistant";
import type { Assistant } from "@/lib/use-assistant";
import { cn } from "@/lib/utils";
import { ChatComposer } from "./chat-composer";
import { CoverageChecklist } from "./coverage-checklist";

export const panelTabs = ["chat", "trace"] as const;
export type PanelTab = (typeof panelTabs)[number];

type AssistantPanelProps = {
  documentId: string;
  documentTitle: string;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  sections: Section[];
  assistant: Assistant;
  editable: boolean;
  llmConfigured: boolean;
  isAdmin: boolean;
  composer: string;
  onComposerChange: (value: string) => void;
  /** `@Section instruction` messages revise that section instead of chatting. */
  onRevise: (key: string, instruction: string) => void;
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

function Message({
  message,
}: {
  message: Pick<ChatMessage, "role" | "content" | "author" | "interrupted">;
}) {
  const assistant = message.role === "assistant";
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
        {message.content || "…"}
        {message.interrupted && (
          <span className="ml-1 text-xs text-muted-foreground">(interrupted)</span>
        )}
      </p>
    </li>
  );
}

export function AssistantPanel({
  documentId,
  documentTitle,
  tab,
  onTabChange,
  sections,
  assistant,
  editable,
  llmConfigured,
  isAdmin,
  composer,
  onComposerChange,
  onRevise,
}: AssistantPanelProps) {
  const chat = useQuery(chatQuery(documentId));
  const end = useRef<HTMLLIElement>(null);
  const messages = chat.data?.messages ?? [];
  const hasDrafted = messages.some((m) => m.kind === "draft");

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the conversation grows
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, assistant.reply, assistant.pendingUser]);

  function send(message: string) {
    const mention = parseMention(message, sections);
    if (mention) onRevise(mention.key, mention.instruction);
    else assistant.sendChat(message);
  }

  return (
    <aside
      aria-label="Assistant"
      className="hidden w-[360px] shrink-0 flex-col border-l border-border bg-card xl:flex"
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
        <TracePanel documentId={documentId} title={documentTitle} />
      ) : (
        <>
          {chat.data && (
            <CoverageChecklist
              key={hasDrafted ? "drafted" : "interview"}
              state={chat.data.state}
              sections={sections}
              defaultOpen={!hasDrafted}
            />
          )}
          <ol className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-3">
            {chat.isPending && <li className="text-[13px] text-muted-foreground">Loading…</li>}
            {chat.data && messages.length === 0 && !assistant.pendingUser && (
              <li className="text-[13px] text-muted-foreground">
                Start by describing the problem this document should solve. The assistant asks
                follow-up questions before drafting anything.
              </li>
            )}
            {messages.map((m) => (
              <Message key={m.id} message={m} />
            ))}
            {assistant.stopped && !messages.some((m) => m.id === assistant.stopped?.id) && (
              <Message
                message={{
                  role: "assistant",
                  content: assistant.stopped.content,
                  author: null,
                  interrupted: true,
                }}
              />
            )}
            {assistant.pendingUser && (
              <Message
                message={{
                  role: "user",
                  content: assistant.pendingUser,
                  author: null,
                  interrupted: false,
                }}
              />
            )}
            {assistant.reply !== null && (
              <Message
                message={{
                  role: "assistant",
                  content: assistant.reply,
                  author: null,
                  interrupted: false,
                }}
              />
            )}
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
