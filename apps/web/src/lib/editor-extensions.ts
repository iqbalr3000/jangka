import { Node } from "@tiptap/core";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { ReactNodeViewRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { MermaidBlockView } from "@/components/documents/mermaid-block-view";
import { SlashCommand } from "./slash-command";

/** Mermaid diagram as an atom node holding its source (SPEC §8). */
export const MermaidBlock = Node.create({
  name: "mermaidBlock",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { source: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-mermaid]", getAttrs: (el) => ({ source: el.textContent ?? "" }) }];
  },
  renderHTML({ node }) {
    return ["div", { "data-mermaid": "" }, String(node.attrs.source ?? "")];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MermaidBlockView);
  },
});

/** Text for an empty section: an invitation while editing, a plain statement when read-only. */
export type EmptyPlaceholder = { editable: string; readOnly: string };

/**
 * Exactly the nodes and marks `packages/shared/document` accepts; anything else would fail to save.
 */
export function sectionExtensions(placeholder: EmptyPlaceholder | null) {
  return [
    StarterKit.configure({
      heading: { levels: [3, 4] },
      // It forced an undeletable empty line after a closing table or diagram.
      trailingNode: false,
      strike: false,
      underline: false,
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
        protocols: ["http", "https", "mailto"],
      },
    }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    MermaidBlock,
    SlashCommand,
    ...(placeholder
      ? [
          Placeholder.configure({
            // Read-only sections (viewers, approved documents) show it too (DESIGN §6.3).
            showOnlyWhenEditable: false,
            placeholder: ({ editor, node }) => {
              if (editor.isEmpty)
                return editor.isEditable ? placeholder.editable : placeholder.readOnly;
              return editor.isEditable && node.type.name === "paragraph"
                ? "Type '/' for commands"
                : "";
            },
          }),
        ]
      : []),
  ];
}
