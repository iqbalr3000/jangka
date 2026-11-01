import { type CommentAnchor, QUOTE_CONTEXT, QUOTE_MAX } from "@jangka/shared/review";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/** A section's readable text and, per character, its document position (-1 for block breaks). */
export type FlatText = { text: string; positions: number[] };

/** Text nodes in order, `\n` between textblocks; code blocks and atoms (diagrams) are skipped. */
export function flatten(doc: ProseMirrorNode): FlatText {
  let text = "";
  const positions: number[] = [];
  let blockOpen = false;
  doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") return false;
    if (node.isTextblock) {
      if (blockOpen) {
        text += "\n";
        positions.push(-1);
      }
      blockOpen = true;
      return true;
    }
    if (node.type.name === "hardBreak") {
      text += "\n";
      positions.push(-1);
      return false;
    }
    if (node.isText && node.text) {
      text += node.text;
      for (let i = 0; i < node.text.length; i++) positions.push(pos + i);
    }
    return true;
  });
  return { text, positions };
}

/** The anchor for a selection (document positions); null when it holds no anchorable text. */
export function anchorFor(flat: FlatText, from: number, to: number): CommentAnchor | null {
  const { text, positions } = flat;
  let start = positions.findIndex((p) => p >= from);
  let end = positions.findLastIndex((p) => p !== -1 && p < to) + 1;
  if (start === -1 || end <= start) return null;
  while (start < end && /\s/.test(text.charAt(start))) start++;
  while (end > start && /\s/.test(text.charAt(end - 1))) end--;
  if (end <= start) return null;
  end = Math.min(end, start + QUOTE_MAX);
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - QUOTE_CONTEXT), start),
    suffix: text.slice(end, end + QUOTE_CONTEXT),
  };
}

function sharedEnd(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function sharedStart(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Text offsets of the quote's best occurrence (most matching context); null when it's gone. */
export function findAnchor(
  text: string,
  anchor: CommentAnchor,
): { start: number; end: number } | null {
  let best: { start: number; score: number } | null = null;
  for (let at = text.indexOf(anchor.quote); at !== -1; at = text.indexOf(anchor.quote, at + 1)) {
    const end = at + anchor.quote.length;
    const score =
      sharedEnd(text.slice(Math.max(0, at - QUOTE_CONTEXT), at), anchor.prefix) +
      sharedStart(text.slice(end, end + QUOTE_CONTEXT), anchor.suffix);
    if (!best || score > best.score) best = { start: at, score };
  }
  return best ? { start: best.start, end: best.start + anchor.quote.length } : null;
}

/** Document range of an anchor in the flattened text; null when detached. */
export function anchorRange(
  flat: FlatText,
  anchor: CommentAnchor,
): { from: number; to: number } | null {
  const found = findAnchor(flat.text, anchor);
  if (!found) return null;
  const from = flat.positions[found.start];
  const last = flat.positions[found.end - 1];
  if (from === undefined || last === undefined || from === -1 || last === -1) return null;
  return { from, to: last + 1 };
}
