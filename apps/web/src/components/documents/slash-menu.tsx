import type { SuggestionProps } from "@tiptap/suggestion";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { SlashItem } from "@/lib/slash-command";
import { cn } from "@/lib/utils";

export type SlashMenuHandle = { onKeyDown: (event: KeyboardEvent) => boolean };

type SlashMenuProps = SuggestionProps<SlashItem, SlashItem> & { ref?: Ref<SlashMenuHandle> };

/** The `/` block menu; keys are forwarded from the editor while it is open. */
export function SlashMenu({ items, command, ref }: SlashMenuProps) {
  const [highlight, setHighlight] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new filter starts at the top
  useEffect(() => setHighlight(0), [items]);

  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setHighlight((h) => (h + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setHighlight((h) => (h - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        const item = items[highlight];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  return (
    <div
      ref={list}
      role="listbox"
      aria-label="Insert block"
      className="z-50 max-h-72 w-56 overflow-y-auto rounded-md border border-border bg-card p-1 text-[13px] shadow-[0_4px_16px_rgb(0_0_0/0.08)]"
    >
      {items.length === 0 ? (
        <p className="px-2 py-1.5 text-muted-foreground">No matching blocks</p>
      ) : (
        items.map((item, i) => (
          <button
            key={item.title}
            type="button"
            role="option"
            data-index={i}
            aria-selected={i === highlight}
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setHighlight(i)}
            onClick={() => command(item)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left",
              i === highlight && "bg-secondary",
            )}
          >
            <span className="flex size-6 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground">
              <item.icon className="size-3.5" aria-hidden />
            </span>
            {item.title}
          </button>
        ))
      )}
    </div>
  );
}
