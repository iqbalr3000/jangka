import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { type ChipIndex, EMPTY_CHIPS, findCodes } from "./requirement-chips";

/** Transaction meta carrying a new chip index (the trace data changed). */
export const requirementChipsKey = new PluginKey<{ index: ChipIndex; decorations: DecorationSet }>(
  "requirementChips",
);

function decorate(doc: ProseMirrorNode, index: ChipIndex): DecorationSet {
  if (index.size === 0) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    // Code is code: no chips in code blocks or inline code (diagrams are atoms without text).
    if (node.type.name === "codeBlock") return false;
    if (!node.isText || !node.text || node.marks.some((m) => m.type.name === "code")) return;
    for (const { code, from, to } of findCodes(node.text)) {
      const chip = index.get(code);
      if (!chip) continue;
      decorations.push(
        Decoration.inline(pos + from, pos + to, {
          class: `req-chip req-chip-${chip.kind}${chip.kind === "own" && chip.needsReview ? " req-chip-review" : ""}`,
          "data-req": code,
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Requirement codes as chips. Decorations only: the document, its markdown and its exports are
 * unchanged. The index arrives through `requirementChipsKey` meta.
 */
export const RequirementChips = Extension.create({
  name: "requirementChips",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: requirementChipsKey,
        state: {
          init: (_, state) => ({
            index: EMPTY_CHIPS,
            decorations: decorate(state.doc, EMPTY_CHIPS),
          }),
          apply(tr, value, _old, state) {
            const index: ChipIndex | undefined = tr.getMeta(requirementChipsKey);
            if (index) return { index, decorations: decorate(state.doc, index) };
            if (tr.docChanged)
              return { index: value.index, decorations: decorate(state.doc, value.index) };
            return value;
          },
        },
        props: {
          decorations: (state) => requirementChipsKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});
