import { bodyParts, type MentionableUser, mentionToken } from "@jangka/shared/notifications";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  type FormEvent,
  type KeyboardEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { mentionAt } from "@/lib/mentions";
import { mentionableQuery } from "@/lib/notifications";
import { cn } from "@/lib/utils";

type Picked = { id: string; name: string };

/** Stored body → what the textarea shows (`@Name`) plus the people mentioned in it. */
function editable(body: string): { text: string; picked: Picked[] } {
  const parts = bodyParts(body);
  return {
    text: parts.map((p) => ("mention" in p ? `@${p.mention.name}` : p.text)).join(""),
    picked: parts.flatMap((p) => ("mention" in p ? [p.mention] : [])),
  };
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `@Name` of people picked from the list → stored tokens; longest names first. */
function withTokens(text: string, picked: Picked[]): string {
  let out = text;
  for (const user of [...picked].sort((a, b) => b.name.length - a.name.length)) {
    const pattern = new RegExp(`@${escapeRegExp(user.name)}(?![\\p{L}\\p{N}])`, "gu");
    out = out.replace(pattern, () => mentionToken(user));
  }
  return out;
}

type CommentComposerProps = {
  documentId: string;
  placeholder: string;
  initial?: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
};

/** Comment box; `@` suggests people who can view the document. */
export function CommentComposer({
  documentId,
  placeholder,
  initial = "",
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: CommentComposerProps) {
  const [start] = useState(() => editable(initial));
  const [text, setText] = useState(start.text);
  const [picked, setPicked] = useState<Picked[]>(start.picked);
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const placeCaret = useRef<number | null>(null);
  const listId = useId();

  const mention = caret === null ? null : mentionAt(text, caret);
  const open = mention !== null && dismissed !== mention.from;
  const suggestions = useQuery({
    ...mentionableQuery(documentId, mention?.query ?? ""),
    enabled: open,
    placeholderData: keepPreviousData,
  });
  const people = open ? (suggestions.data?.items ?? []) : [];
  const showList = open && people.length > 0;

  function track() {
    const el = ref.current;
    setCaret(el && el.selectionStart === el.selectionEnd ? el.selectionStart : null);
  }

  function pick(user: MentionableUser) {
    if (!mention || caret === null) return;
    const inserted = `@${user.name} `;
    const next = text.slice(0, mention.from) + inserted + text.slice(caret);
    const at = mention.from + inserted.length;
    setText(next);
    setPicked((list) => (list.some((p) => p.id === user.id) ? list : [...list, user]));
    setCaret(at);
    setActive(0);
    placeCaret.current = at;
  }

  // Right after the picked name renders, before the next keystroke lands.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after each text change; a pick sets the caret to place
  useLayoutEffect(() => {
    const at = placeCaret.current;
    if (at === null || !ref.current) return;
    placeCaret.current = null;
    ref.current.focus();
    ref.current.setSelectionRange(at, at);
  }, [text]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (body) onSubmit(withTokens(body, picked));
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (showList) {
      const count = people.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActive((i) => (i + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const user = people[Math.min(active, count - 1)];
        if (user && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          pick(user);
          return;
        }
      }
      if (event.key === "Escape" && mention) {
        event.preventDefault();
        event.stopPropagation();
        setDismissed(mention.from);
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(event);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <div className="relative">
        <textarea
          ref={ref}
          aria-label={placeholder}
          placeholder={placeholder}
          rows={2}
          maxLength={4000}
          value={text}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            setDismissed(null);
            setCaret(event.target.selectionStart);
          }}
          onSelect={track}
          onBlur={() => setCaret(null)}
          onKeyDown={onKeyDown}
          className="w-full rounded-sm border border-input bg-card px-2 py-1.5 text-[13px]"
        />
        {showList && (
          <div
            id={listId}
            role="listbox"
            aria-label="People"
            className="absolute bottom-full left-0 z-20 mb-1 flex max-h-64 w-full flex-col overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-float"
          >
            {people.map((user, i) => (
              <button
                key={user.id}
                type="button"
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                // Keep the textarea focused (and its caret) while picking with the mouse.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(user)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex items-baseline gap-2 rounded-sm px-2 py-1.5 text-left",
                  i === active && "bg-secondary",
                )}
              >
                <span className="shrink-0 font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="flex items-center justify-end gap-1.5">
        <span className="mr-auto text-xs text-muted-foreground">@ to mention</span>
        {onCancel && (
          <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="xs" disabled={pending || !text.trim()}>
          {submitLabel}
        </Button>
      </span>
    </form>
  );
}
