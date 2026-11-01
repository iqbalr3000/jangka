import type { CommentAnchor } from "@jangka/shared/review";
import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { anchorRange, flatten } from "./text-anchor";

/** Open threads of one section that point at text. */
export type AnchoredThreads = readonly { thread: string; anchor: CommentAnchor }[];

export const NO_ANCHORS: AnchoredThreads = [];

/** Transaction meta carrying the section's anchored threads. */
export const commentAnchorsKey = new PluginKey<{
  threads: AnchoredThreads;
  decorations: DecorationSet;
}>("commentAnchors");

function decorate(doc: ProseMirrorNode, threads: AnchoredThreads): DecorationSet {
  if (threads.length === 0) return DecorationSet.empty;
  const flat = flatten(doc);
  const decorations = threads.flatMap(({ thread, anchor }) => {
    const range = anchorRange(flat, anchor);
    return range
      ? [
          Decoration.inline(range.from, range.to, {
            class: "comment-anchor",
            "data-thread": thread,
          }),
        ]
      : [];
  });
  return DecorationSet.create(doc, decorations);
}

/** Highlights the words open threads point at. Decorations only: the content is unchanged. */
export const CommentAnchors = Extension.create({
  name: "commentAnchors",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: commentAnchorsKey,
        state: {
          init: () => ({ threads: NO_ANCHORS, decorations: DecorationSet.empty }),
          apply(tr, value, _old, state) {
            const threads: AnchoredThreads | undefined = tr.getMeta(commentAnchorsKey);
            if (threads) return { threads, decorations: decorate(state.doc, threads) };
            if (tr.docChanged)
              return { threads: value.threads, decorations: decorate(state.doc, value.threads) };
            return value;
          },
        },
        props: {
          decorations: (state) => commentAnchorsKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});
