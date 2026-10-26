import { type Editor, Extension, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import {
  GitFork,
  Heading3,
  Heading4,
  List,
  ListOrdered,
  type LucideIcon,
  Minus,
  Pilcrow,
  Quote,
  SquareCode,
  Table2,
} from "lucide-react";
import { SlashMenu, type SlashMenuHandle } from "@/components/documents/slash-menu";

const NEW_DIAGRAM = "flowchart TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Done]\n  B -->|No| A";

export type SlashItem = {
  title: string;
  aliases: string[];
  icon: LucideIcon;
  run: (editor: Editor, range: Range) => void;
};

const at = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);

export const slashItems: SlashItem[] = [
  {
    title: "Text",
    aliases: ["paragraph", "p"],
    icon: Pilcrow,
    run: (e, r) => at(e, r).setParagraph().run(),
  },
  {
    title: "Heading 3",
    aliases: ["h3", "title"],
    icon: Heading3,
    run: (e, r) => at(e, r).setHeading({ level: 3 }).run(),
  },
  {
    title: "Heading 4",
    aliases: ["h4", "subtitle"],
    icon: Heading4,
    run: (e, r) => at(e, r).setHeading({ level: 4 }).run(),
  },
  {
    title: "Bulleted list",
    aliases: ["ul", "bullet", "list"],
    icon: List,
    run: (e, r) => at(e, r).toggleBulletList().run(),
  },
  {
    title: "Numbered list",
    aliases: ["ol", "ordered", "number"],
    icon: ListOrdered,
    run: (e, r) => at(e, r).toggleOrderedList().run(),
  },
  {
    title: "Quote",
    aliases: ["blockquote"],
    icon: Quote,
    run: (e, r) => at(e, r).setBlockquote().run(),
  },
  {
    title: "Code block",
    aliases: ["code", "pre"],
    icon: SquareCode,
    run: (e, r) => at(e, r).setCodeBlock().run(),
  },
  {
    title: "Table",
    aliases: ["grid"],
    icon: Table2,
    run: (e, r) => at(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    title: "Diagram",
    aliases: ["mermaid", "flowchart", "chart"],
    icon: GitFork,
    run: (e, r) =>
      at(e, r)
        .insertContent({ type: "mermaidBlock", attrs: { source: NEW_DIAGRAM } })
        .run(),
  },
  {
    title: "Divider",
    aliases: ["hr", "line", "separator"],
    icon: Minus,
    run: (e, r) => at(e, r).setHorizontalRule().run(),
  },
];

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return slashItems;
  return slashItems.filter(
    (item) =>
      item.title.toLowerCase().includes(q) || item.aliases.some((alias) => alias.startsWith(q)),
  );
}

export const slashCommandKey = new PluginKey("slashCommand");

/** `/` at the start of a line or after a space opens the block menu. */
export const SlashCommand = Extension.create({
  name: "slashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        pluginKey: slashCommandKey,
        editor: this.editor,
        char: "/",
        // Tables and code blocks can't hold the blocks this menu inserts.
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          for (let depth = $from.depth; depth > 0; depth--) {
            const name = $from.node(depth).type.name;
            if (name === "codeBlock" || name === "tableCell" || name === "tableHeader") {
              return false;
            }
          }
          return true;
        },
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<
            SlashMenuHandle,
            SuggestionProps<SlashItem, SlashItem>
          > | null = null;
          let unmount: (() => void) | null = null;
          return {
            onStart: (props) => {
              renderer = new ReactRenderer(SlashMenu, { props, editor: props.editor });
              unmount = props.mount(renderer.element);
            },
            onUpdate: (props) => renderer?.updateProps(props),
            onKeyDown: ({ event }) => {
              if (event.key === "Escape") return false;
              return renderer?.ref?.onKeyDown(event) ?? false;
            },
            onExit: () => {
              unmount?.();
              renderer?.destroy();
              renderer = null;
              unmount = null;
            },
          };
        },
      }),
    ];
  },
});
