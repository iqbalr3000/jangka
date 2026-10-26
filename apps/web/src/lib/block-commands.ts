import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";

/** A top-level block of the document: its index among the doc's children and its start position. */
export type BlockRef = { index: number; pos: number };

export function blockAt(state: EditorState, index: number): BlockRef | null {
  const { doc } = state;
  if (index < 0 || index >= doc.childCount) return null;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return { index, pos };
}

/** Swaps the block with its neighbour above (-1) or below (1); null at the edges. */
export function moveBlock(
  state: EditorState,
  index: number,
  direction: -1 | 1,
): Transaction | null {
  const block = blockAt(state, index);
  const other = blockAt(state, index + direction);
  if (!block || !other) return null;
  const node = state.doc.child(index);
  const tr = state.tr.delete(block.pos, block.pos + node.nodeSize);
  // Below: the neighbour shifted up into the deleted block's place.
  const target = direction === -1 ? other.pos : block.pos + state.doc.child(index + 1).nodeSize;
  return tr.insert(target, node).scrollIntoView();
}

export function duplicateBlock(state: EditorState, index: number): Transaction | null {
  const block = blockAt(state, index);
  if (!block) return null;
  const node = state.doc.child(index);
  return state.tr.insert(block.pos + node.nodeSize, node.copy(node.content));
}

/** Removes the block; the last remaining block becomes an empty paragraph instead. */
export function deleteBlock(state: EditorState, index: number): Transaction | null {
  const block = blockAt(state, index);
  if (!block) return null;
  const node = state.doc.child(index);
  const end = block.pos + node.nodeSize;
  if (state.doc.childCount === 1) {
    const paragraph = state.schema.nodes.paragraph;
    return paragraph ? state.tr.replaceWith(block.pos, end, paragraph.create()) : null;
  }
  return state.tr.delete(block.pos, end);
}

export const blockTypes = [
  "paragraph",
  "heading3",
  "heading4",
  "bulletList",
  "orderedList",
  "blockquote",
] as const;
export type BlockType = (typeof blockTypes)[number];

export const blockTypeLabels: Record<BlockType, string> = {
  paragraph: "Text",
  heading3: "Heading 3",
  heading4: "Heading 4",
  bulletList: "Bulleted list",
  orderedList: "Numbered list",
  blockquote: "Quote",
};

/** The type of the block holding the selection, when it is one `turnInto` handles. */
export function currentBlockType(editor: Editor): BlockType | null {
  if (editor.isActive("bulletList")) return "bulletList";
  if (editor.isActive("orderedList")) return "orderedList";
  if (editor.isActive("blockquote")) return "blockquote";
  if (editor.isActive("heading", { level: 3 })) return "heading3";
  if (editor.isActive("heading", { level: 4 })) return "heading4";
  if (editor.isActive("paragraph")) return "paragraph";
  return null;
}

/**
 * Converts the blocks in the selection. Lists and quotes are unwrapped first, so a list turns into
 * flat paragraphs or headings rather than nesting them.
 */
export function turnInto(editor: Editor, target: BlockType): void {
  const current = currentBlockType(editor);
  if (current === target) return;
  let chain = editor.chain().focus();
  if (current === "bulletList") chain = chain.toggleBulletList();
  if (current === "orderedList") chain = chain.toggleOrderedList();
  if (current === "blockquote") chain = chain.unsetBlockquote();
  switch (target) {
    case "paragraph":
      chain = chain.setParagraph();
      break;
    case "heading3":
      chain = chain.setHeading({ level: 3 });
      break;
    case "heading4":
      chain = chain.setHeading({ level: 4 });
      break;
    case "bulletList":
      chain = chain.setParagraph().toggleBulletList();
      break;
    case "orderedList":
      chain = chain.setParagraph().toggleOrderedList();
      break;
    case "blockquote":
      chain = chain.setParagraph().setBlockquote();
      break;
  }
  chain.run();
}
