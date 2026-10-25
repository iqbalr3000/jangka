import type { Section } from "@jangka/shared/document";
import type { CommentThread, CommentView } from "@jangka/shared/review";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { z } from "zod";
import { ErrorBanner } from "@/components/error-banner";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { errorMessage } from "@/lib/form-errors";
import { timeAgo } from "@/lib/llm";
import { commentsKey, commentsQuery } from "@/lib/review";
import { cn } from "@/lib/utils";

type CommentsPanelProps = {
  documentId: string;
  sections: Section[];
  /** The section in focus (from its header badge), or "" for all. */
  sectionKey: string;
  onSectionChange: (key: string) => void;
};

const ALL = "";
const textarea = "w-full rounded-sm border border-input bg-card px-2 py-1.5 text-[13px]";

function Composer({
  placeholder,
  initial = "",
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  initial?: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState(initial);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (body.trim()) onSubmit(body.trim());
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <textarea
        aria-label={placeholder}
        placeholder={placeholder}
        rows={2}
        maxLength={4000}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(event);
        }}
        className={textarea}
      />
      <span className="flex justify-end gap-1.5">
        {onCancel && (
          <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="xs" disabled={pending || !body.trim()}>
          {submitLabel}
        </Button>
      </span>
    </form>
  );
}

type CommentActions = {
  editing: string | null;
  pending: boolean;
  onReply: (rootId: string) => void;
  onEdit: (id: string | null) => void;
  onRequest: (request: { path: string; method: string; body?: unknown }) => void;
};

function Comment({
  comment,
  thread,
  actions,
}: {
  comment: CommentView;
  thread?: CommentThread;
  actions: CommentActions;
}) {
  if (actions.editing === comment.id) {
    return (
      <Composer
        placeholder="Edit comment"
        initial={comment.body ?? ""}
        submitLabel="Save"
        pending={actions.pending}
        onCancel={() => actions.onEdit(null)}
        onSubmit={(body) =>
          actions.onRequest({ path: `/comments/${comment.id}`, method: "PATCH", body: { body } })
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{comment.author?.name ?? "Someone"}</span>
        {timeAgo(comment.createdAt)}
        {comment.editedAt && <span>· edited</span>}
      </span>
      <p className={cn("whitespace-pre-wrap", comment.deleted && "text-muted-foreground italic")}>
        {comment.deleted ? "Comment deleted" : comment.body}
      </p>
      <span className="flex gap-2 text-xs">
        {thread && !thread.resolvedAt && (
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => actions.onReply(thread.root.id)}
          >
            Reply
          </button>
        )}
        {comment.canEdit && (
          <>
            <button
              type="button"
              className="text-muted-foreground hover:underline"
              onClick={() => actions.onEdit(comment.id)}
            >
              Edit
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive hover:underline"
              onClick={() =>
                window.confirm("Delete this comment?") &&
                actions.onRequest({ path: `/comments/${comment.id}`, method: "DELETE" })
              }
            >
              Delete
            </button>
          </>
        )}
        {thread?.canResolve && (
          <button
            type="button"
            className="ml-auto text-muted-foreground hover:underline"
            onClick={() =>
              actions.onRequest({
                path: `/comments/${thread.root.id}/${thread.resolvedAt ? "reopen" : "resolve"}`,
                method: "POST",
              })
            }
          >
            {thread.resolvedAt ? "Reopen" : "Resolve"}
          </button>
        )}
      </span>
    </div>
  );
}

/** Review threads per section: readers comment, editors reply and resolve (feature `review`). */
export function CommentsPanel({
  documentId,
  sections,
  sectionKey,
  onSectionChange,
}: CommentsPanelProps) {
  const queryClient = useQueryClient();
  const [showResolved, setShowResolved] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  // Bumped after each successful request so the new-comment box starts empty again.
  const [round, setRound] = useState(0);
  const list = useQuery(commentsQuery(documentId, showResolved ? "all" : "open"));
  const titles = new Map(sections.map((s) => [s.key, s.title]));
  const target = sectionKey || sections[0]?.key || "";

  const run = useMutation({
    mutationFn: (request: { path: string; method: string; body?: unknown }) =>
      apiFetch(request.path, {
        method: request.method,
        body: request.body,
        schema: z.unknown(),
      }),
    onSuccess: async () => {
      setReplyTo(null);
      setEditing(null);
      setRound((n) => n + 1);
      await queryClient.invalidateQueries({ queryKey: commentsKey(documentId) });
    },
  });

  const actions: CommentActions = {
    editing,
    pending: run.isPending,
    onReply: setReplyTo,
    onEdit: setEditing,
    onRequest: (request) => run.mutate(request),
  };
  const threads = (list.data?.threads ?? []).filter(
    (t) => sectionKey === ALL || t.root.sectionKey === sectionKey,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[13px]">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <label className="sr-only" htmlFor="comments-section">
          Section
        </label>
        <select
          id="comments-section"
          value={sectionKey}
          onChange={(event) => onSectionChange(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-sm border border-input bg-card px-2"
        >
          <option value={ALL}>All sections</option>
          {sections.map((s) => (
            <option key={s.key} value={s.key}>
              {s.title}
              {list.data?.openCountBySection[s.key]
                ? ` (${list.data.openCountBySection[s.key]})`
                : ""}
            </option>
          ))}
        </select>
        <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="accent-primary"
            checked={showResolved}
            onChange={(event) => setShowResolved(event.target.checked)}
          />
          Resolved
        </label>
      </div>

      {run.error && (
        <div className="px-4 pt-3">
          <ErrorBanner>{errorMessage(run.error)}</ErrorBanner>
        </div>
      )}
      <ol
        aria-label="Comment threads"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-3"
      >
        {list.isPending && <li className="text-muted-foreground">Loading…</li>}
        {list.data && threads.length === 0 && (
          <li className="text-muted-foreground">
            {showResolved ? "No comments yet." : "No open comments."}
          </li>
        )}
        {threads.map((thread) => (
          <li
            key={thread.root.id}
            aria-label={`Thread on ${titles.get(thread.root.sectionKey) ?? thread.root.sectionKey}`}
            className={cn(
              "flex flex-col gap-2 rounded-md border border-border p-3",
              thread.resolvedAt && "opacity-70",
            )}
          >
            {sectionKey === ALL && (
              <span className="font-mono text-[11px] text-muted-foreground uppercase">
                {titles.get(thread.root.sectionKey) ?? thread.root.sectionKey}
              </span>
            )}
            <Comment comment={thread.root} thread={thread} actions={actions} />
            {thread.replies.length > 0 && (
              <ol className="flex flex-col gap-2 border-l-2 border-border pl-3">
                {thread.replies.map((reply) => (
                  <li key={reply.id}>
                    <Comment comment={reply} actions={actions} />
                  </li>
                ))}
              </ol>
            )}
            {thread.resolvedAt && (
              <span className="text-xs text-muted-foreground">
                Resolved by {thread.resolvedBy?.name ?? "someone"} · {timeAgo(thread.resolvedAt)}
              </span>
            )}
            {replyTo === thread.root.id && (
              <Composer
                placeholder="Reply"
                submitLabel="Reply"
                pending={run.isPending}
                onCancel={() => setReplyTo(null)}
                onSubmit={(body) =>
                  run.mutate({
                    path: `/documents/${documentId}/comments`,
                    method: "POST",
                    body: { sectionKey: thread.root.sectionKey, parentId: thread.root.id, body },
                  })
                }
              />
            )}
          </li>
        ))}
      </ol>

      {target && (
        <div className="border-t border-border px-4 py-3">
          <Composer
            key={`${target}:${round}`}
            placeholder={`Comment on ${titles.get(target) ?? target}`}
            submitLabel="Comment"
            pending={run.isPending}
            onSubmit={(body) =>
              run.mutate({
                path: `/documents/${documentId}/comments`,
                method: "POST",
                body: { sectionKey: target, body },
              })
            }
          />
        </div>
      )}
    </div>
  );
}
