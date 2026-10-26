import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type BlockType,
  blockAt,
  blockTypeLabels,
  blockTypes,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  turnInto,
} from "@/lib/block-commands";
import { useMediaQuery } from "@/lib/use-media-query";

const BUTTON = 24;
const CONVERTIBLE = new Set(["paragraph", "heading", "bulletList", "orderedList", "blockquote"]);

type Hovered = { index: number; top: number };

/** Top of the button row: centred on the block's first line. */
function firstLineTop(dom: HTMLElement, containerTop: number): number {
  const rect = dom.getBoundingClientRect();
  const style = getComputedStyle(dom);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const padding = Number.parseFloat(style.paddingTop) || 0;
  const offset = Number.isNaN(lineHeight) ? 4 : padding + (lineHeight - BUTTON) / 2;
  return rect.top - containerTop + Math.max(0, offset);
}

function blockDom(editor: Editor, index: number): HTMLElement | null {
  const block = blockAt(editor.state, index);
  const dom = block ? editor.view.nodeDOM(block.pos) : null;
  return dom instanceof HTMLElement ? dom : null;
}

/**
 * Notion-style handle beside the hovered block: `+` inserts below, `⋮⋮` deletes, moves,
 * duplicates or converts it. Follows the selection on touch screens, where nothing hovers.
 */
export function BlockGutter({ editor, container }: { editor: Editor; container: HTMLElement }) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const touch = useMediaQuery("(hover: none)");

  const show = useCallback(
    (index: number) => {
      const dom = blockDom(editor, index);
      if (!dom) return setHovered(null);
      setHovered({ index, top: firstLineTop(dom, container.getBoundingClientRect().top) });
    },
    [editor, container],
  );

  useEffect(() => {
    if (menuOpen) return;
    const onMove = (event: MouseEvent) => {
      const { doc } = editor.state;
      let index = 0;
      for (let i = 0; i < doc.childCount; i++) {
        const dom = blockDom(editor, i);
        if (dom && dom.getBoundingClientRect().top <= event.clientY + 4) index = i;
      }
      show(index);
    };
    const hide = () => setHovered(null);
    const followSelection = () => {
      if (editor.isFocused) show(editor.state.selection.$from.index(0));
    };
    if (touch) {
      editor.on("selectionUpdate", followSelection);
      editor.on("focus", followSelection);
      return () => {
        editor.off("selectionUpdate", followSelection);
        editor.off("focus", followSelection);
      };
    }
    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", hide);
    // Typing hides the handle, as in Notion; the next mouse move brings it back.
    editor.on("update", hide);
    return () => {
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", hide);
      editor.off("update", hide);
    };
  }, [editor, container, menuOpen, touch, show]);

  if (!hovered) return null;
  const node = editor.state.doc.maybeChild(hovered.index);
  if (!node) return null;
  const { index } = hovered;
  const last = editor.state.doc.childCount - 1;

  function apply(tr: ReturnType<typeof deleteBlock>) {
    if (!tr) return;
    editor.view.dispatch(tr);
    editor.commands.focus();
    setHovered(null);
  }

  function insertBelow() {
    const block = blockAt(editor.state, index);
    if (!block || !node) return;
    if (node.type.name === "paragraph" && node.content.size === 0) {
      editor
        .chain()
        .focus()
        .setTextSelection(block.pos + 1)
        .insertContent("/")
        .run();
      return;
    }
    const end = block.pos + node.nodeSize;
    editor
      .chain()
      .focus()
      .insertContentAt(end, { type: "paragraph" })
      .setTextSelection(end + 1)
      .insertContent("/")
      .run();
  }

  function convert(type: BlockType) {
    const block = blockAt(editor.state, index);
    if (!block || !node) return;
    const { doc } = editor.state;
    const selection = TextSelection.between(
      doc.resolve(block.pos + 1),
      doc.resolve(block.pos + node.nodeSize - 1),
    );
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    turnInto(editor, type);
    setHovered(null);
  }

  return (
    // Fits the article's left padding: `+` from `sm`, where the padding makes room for both.
    <div className="absolute left-0 z-10 flex items-center gap-0.5" style={{ top: hovered.top }}>
      <button
        type="button"
        aria-label="Insert block below"
        title="Insert below"
        onMouseDown={(event) => event.preventDefault()}
        onClick={insertBelow}
        className="hidden h-6 w-5 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-secondary hover:text-foreground sm:flex"
      >
        <Plus className="size-4" aria-hidden />
      </button>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          const block = blockAt(editor.state, index);
          // The block reads as selected while its menu is open.
          if (open && block) editor.commands.setNodeSelection(block.pos);
        }}
      >
        <DropdownMenuTrigger
          aria-label="Block actions"
          title="Block actions"
          className="flex h-6 w-5 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary"
        >
          <GripVertical className="size-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          side="left"
          className="w-48 text-[13px]"
          // Actions refocus the editor; the trigger must not take focus back.
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {CONVERTIBLE.has(node.type.name) && (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="text-[13px]">Turn into</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="text-[13px]">
                  {blockTypes.map((type) => (
                    <DropdownMenuItem
                      key={type}
                      className="text-[13px]"
                      onSelect={() => convert(type)}
                    >
                      {blockTypeLabels[type]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            className="text-[13px]"
            onSelect={() => apply(duplicateBlock(editor.state, index))}
          >
            <Copy aria-hidden />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-[13px]"
            disabled={index === 0}
            onSelect={() => apply(moveBlock(editor.state, index, -1))}
          >
            <ArrowUp aria-hidden />
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-[13px]"
            disabled={index === last}
            onSelect={() => apply(moveBlock(editor.state, index, 1))}
          >
            <ArrowDown aria-hidden />
            Move down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            className="text-[13px]"
            onSelect={() => apply(deleteBlock(editor.state, index))}
          >
            <Trash2 aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
