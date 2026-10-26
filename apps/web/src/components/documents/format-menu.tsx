import { NodeSelection } from "@tiptap/pm/state";
import { type Editor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, ChevronDown, Code, Italic, Link2, type LucideIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  type BlockType,
  blockTypeLabels,
  blockTypes,
  currentBlockType,
  turnInto,
} from "@/lib/block-commands";
import { normalizeHref } from "@/lib/link-href";
import { cn } from "@/lib/utils";

function MenuButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary hover:text-foreground",
        active && "bg-secondary text-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

/** Formatting for the selected text, floating above it (replaces the heading-row toolbar). */
export function FormatMenu({ editor }: { editor: Editor }) {
  const [mode, setMode] = useState<"buttons" | "types" | "link">("buttons");
  const [href, setHref] = useState("");
  const [linkError, setLinkError] = useState(false);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      href: String(e.getAttributes("link").href ?? ""),
      type: currentBlockType(e),
    }),
  });
  const chain = () => editor.chain().focus();

  // A new selection starts from the buttons again.
  useEffect(() => {
    const reset = () => setMode("buttons");
    editor.on("selectionUpdate", reset);
    return () => {
      editor.off("selectionUpdate", reset);
    };
  }, [editor]);

  function openLink() {
    setHref(state.href);
    setLinkError(false);
    setMode("link");
  }

  function applyLink(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeHref(href);
    if (!normalized) return setLinkError(true);
    chain().extendMarkRange("link").setLink({ href: normalized }).run();
    setMode("buttons");
  }

  function pickType(type: BlockType) {
    turnInto(editor, type);
    setMode("buttons");
  }

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor: e, state: s, from, to }) => {
        if (!e.isEditable || from === to) return false;
        if (s.selection instanceof NodeSelection) return false;
        return !e.isActive("codeBlock");
      }}
      onMouseDown={(event) => {
        // Keep the selection, except for the link field, which needs focus.
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
      className="z-40 rounded-md border border-border bg-card p-0.5 text-[13px] shadow-[0_4px_16px_rgb(0_0_0/0.08)]"
    >
      {mode === "link" ? (
        <form onSubmit={applyLink} className="flex items-center gap-1 p-0.5">
          <input
            // biome-ignore lint/a11y/noAutofocus: the field opens on demand from the Link button
            autoFocus
            aria-label="Link URL"
            aria-invalid={linkError}
            placeholder="Paste a link…"
            value={href}
            onChange={(event) => {
              setHref(event.target.value);
              setLinkError(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setMode("buttons");
                editor.commands.focus();
              }
            }}
            className={cn(
              "h-7 w-56 rounded-sm border border-input bg-background px-2 outline-none focus:border-ring",
              linkError && "border-destructive focus:border-destructive",
            )}
          />
          {state.link && (
            <button
              type="button"
              onClick={() => {
                chain().extendMarkRange("link").unsetLink().run();
                setMode("buttons");
              }}
              className="h-7 rounded-sm px-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Remove
            </button>
          )}
          <button
            type="submit"
            className="h-7 rounded-sm px-2 font-medium text-primary hover:bg-secondary"
          >
            Apply
          </button>
        </form>
      ) : mode === "types" ? (
        <div role="menu" aria-label="Turn into" className="flex w-44 flex-col p-0.5">
          {blockTypes.map((type) => (
            <button
              key={type}
              type="button"
              role="menuitem"
              onClick={() => pickType(type)}
              className={cn(
                "rounded-sm px-2 py-1.5 text-left hover:bg-secondary",
                state.type === type && "font-medium text-primary",
              )}
            >
              {blockTypeLabels[type]}
            </button>
          ))}
        </div>
      ) : (
        <div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setMode("types")}
            aria-haspopup="menu"
            className="flex h-7 items-center gap-1 rounded-sm px-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            {state.type ? blockTypeLabels[state.type] : "Turn into"}
            <ChevronDown className="size-3" aria-hidden />
          </button>
          <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
          <MenuButton
            label="Bold"
            icon={Bold}
            active={state.bold}
            onClick={() => chain().toggleBold().run()}
          />
          <MenuButton
            label="Italic"
            icon={Italic}
            active={state.italic}
            onClick={() => chain().toggleItalic().run()}
          />
          <MenuButton
            label="Inline code"
            icon={Code}
            active={state.code}
            onClick={() => chain().toggleCode().run()}
          />
          <MenuButton label="Link" icon={Link2} active={state.link} onClick={openLink} />
        </div>
      )}
    </BubbleMenu>
  );
}
