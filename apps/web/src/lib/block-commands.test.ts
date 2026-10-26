import { getSchema, type JSONContent } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { deleteBlock, duplicateBlock, moveBlock } from "./block-commands";

const schema = getSchema([StarterKit]);

const p = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

function state(...blocks: JSONContent[]) {
  return EditorState.create({ doc: Node.fromJSON(schema, { type: "doc", content: blocks }) });
}

function texts(tr: Transaction | null) {
  if (!tr) throw new Error("expected a transaction");
  const out: string[] = [];
  tr.doc.forEach((node) => {
    out.push(node.type.name === "paragraph" ? node.textContent : node.type.name);
  });
  return out;
}

describe("moveBlock", () => {
  it("swaps with the block above or below", () => {
    const s = state(p("a"), { type: "horizontalRule" }, p("c"));
    expect(texts(moveBlock(s, 1, -1))).toEqual(["horizontalRule", "a", "c"]);
    expect(texts(moveBlock(s, 1, 1))).toEqual(["a", "c", "horizontalRule"]);
    expect(texts(moveBlock(s, 0, 1))).toEqual(["horizontalRule", "a", "c"]);
  });

  it("does nothing past the edges", () => {
    const s = state(p("a"), p("b"));
    expect(moveBlock(s, 0, -1)).toBeNull();
    expect(moveBlock(s, 1, 1)).toBeNull();
  });
});

describe("duplicateBlock", () => {
  it("inserts a copy right after the block", () => {
    expect(texts(duplicateBlock(state(p("a"), p("b")), 0))).toEqual(["a", "a", "b"]);
  });
});

describe("deleteBlock", () => {
  it("removes the block", () => {
    expect(texts(deleteBlock(state(p("a"), { type: "horizontalRule" }), 1))).toEqual(["a"]);
  });

  it("leaves an empty paragraph when the last block goes", () => {
    const tr = deleteBlock(state({ type: "horizontalRule" }), 0);
    expect(texts(tr)).toEqual([""]);
    expect(tr?.doc.firstChild?.type.name).toBe("paragraph");
  });
});
