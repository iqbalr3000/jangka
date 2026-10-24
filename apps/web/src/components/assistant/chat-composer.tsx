import type { Section } from "@jangka/shared/document";
import { type KeyboardEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { modKeyLabel } from "@/lib/keyboard";
import { cn } from "@/lib/utils";

type ChatComposerProps = {
  sections: Section[];
  value: string;
  onChange: (value: string) => void;
  running: boolean;
  disabled: boolean;
  onSend: (message: string) => void;
  onStop: () => void;
};

/** Text after the last "@" up to the caret, when it looks like a mention being typed. */
function mentionQuery(text: string, caret: number): string | null {
  const match = /@([^@\n]{0,40})$/.exec(text.slice(0, caret));
  return match ? (match[1] ?? "") : null;
}

/** Composer with `@` section mentions; ⌘↵ sends, Esc stops a running generation. */
export function ChatComposer({
  sections,
  value,
  onChange,
  running,
  disabled,
  onSend,
  onStop,
}: ChatComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const query = mentionQuery(value, caret);
  const suggestions =
    query === null
      ? []
      : sections.filter((s) => s.title.toLowerCase().startsWith(query.toLowerCase())).slice(0, 6);

  function insert(title: string) {
    const before = value.slice(0, caret).replace(/@[^@\n]*$/, `@${title} `);
    const next = before + value.slice(caret);
    onChange(next);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(before.length, before.length);
      setCaret(before.length);
    });
  }

  function submit() {
    if (running || disabled || value.trim() === "") return;
    onSend(value.trim());
    onChange("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setHighlight((h) => (h + step + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.metaKey && !event.ctrlKey)) {
        event.preventDefault();
        const choice = suggestions[highlight] ?? suggestions[0];
        if (choice) insert(choice.title);
        return;
      }
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
    if (event.key === "Escape" && running) {
      event.preventDefault();
      onStop();
    }
  }

  return (
    <div className="relative border-t border-border p-3">
      {suggestions.length > 0 && (
        <div
          role="listbox"
          aria-label="Sections"
          className="absolute right-3 bottom-full left-3 mb-1 flex flex-col rounded-md border border-border bg-popover py-1 text-[13px] shadow-float"
        >
          {suggestions.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="option"
              aria-selected={i === highlight}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insert(s.title)}
              className={cn(
                "w-full px-3 py-1.5 text-left hover:bg-secondary",
                i === highlight && "bg-secondary",
              )}
            >
              {s.title}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={input}
        aria-label="Message the assistant"
        value={value}
        disabled={disabled}
        rows={3}
        placeholder="Type a reply… @ to mention a section"
        onChange={(event) => {
          onChange(event.target.value);
          setCaret(event.target.selectionStart);
          setHighlight(0);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        className="block w-full resize-none rounded-sm border border-input bg-card px-3 py-2 text-[13px] outline-none focus:border-ring disabled:opacity-60"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{modKeyLabel}↵ send · Esc stop</span>
        {running ? (
          <Button size="sm" variant="outline" onClick={onStop}>
            ■ Stop
          </Button>
        ) : (
          <Button size="sm" onClick={submit} disabled={disabled || value.trim() === ""}>
            ↑ Send
          </Button>
        )}
      </div>
    </div>
  );
}
