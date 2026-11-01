import { getSchema } from "@tiptap/core";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { anchorFor, anchorRange, findAnchor, flatten } from "./text-anchor";

const schema = getSchema([StarterKit, Table, TableRow, TableHeader, TableCell]);
type Json = Record<string, unknown>;
const doc = (...content: Json[]) => ProseMirrorNode.fromJSON(schema, { type: "doc", content });
const text = (value: string, marks?: Json[]) => ({
  type: "text",
  text: value,
  ...(marks && { marks }),
});
const p = (...content: Json[]) => ({ type: "paragraph", content });
const cell = (value: string) => ({ type: "tableCell", content: [p(text(value))] });

/** The text a range covers, for checking positions. */
const covered = (node: ProseMirrorNode, range: { from: number; to: number } | null) =>
  range ? node.textBetween(range.from, range.to, "\n") : null;

describe("flatten", () => {
  it("joins text across marks, breaks between blocks, skips code blocks", () => {
    const node = doc(
      p(text("Refunds within "), text("14 days", [{ type: "bold" }]), text(".")),
      { type: "bulletList", content: [{ type: "listItem", content: [p(text("Use `cli`"))] }] },
      { type: "codeBlock", content: [text("SELECT 1")] },
      {
        type: "table",
        content: [{ type: "tableRow", content: [cell("Market"), cell("ID")] }],
      },
    );
    const flat = flatten(node);
    expect(flat.text).toBe("Refunds within 14 days.\nUse `cli`\nMarket\nID");
    expect(flat.positions).toHaveLength(flat.text.length);
    expect(node.textBetween(flat.positions[15] ?? 0, (flat.positions[21] ?? 0) + 1)).toBe(
      "14 days",
    );
  });
});

describe("anchors", () => {
  const node = doc(
    p(text("The refund window is 14 days for cards.")),
    p(text("For transfers the refund window is 30 days.")),
  );
  const flat = flatten(node);

  function select(quote: string, occurrence = 0) {
    let at = -1;
    for (let i = 0; i <= occurrence; i++) at = flat.text.indexOf(quote, at + 1);
    const from = flat.positions[at] ?? 0;
    const to = (flat.positions[at + quote.length - 1] ?? 0) + 1;
    return anchorFor(flat, from, to);
  }

  it("builds a trimmed quote with context and finds it again", () => {
    const anchor = select(" refund window ", 1);
    expect(anchor?.quote).toBe("refund window");
    expect(anchor?.prefix).toHaveLength(32);
    expect(anchor?.prefix.endsWith("cards.\nFor transfers the ")).toBe(true);
    expect(anchor?.suffix).toBe(" is 30 days.");
    if (!anchor) throw new Error("no anchor");
    expect(covered(node, anchorRange(flat, anchor))).toBe("refund window");
    expect(anchorRange(flat, anchor)?.from).toBeGreaterThan(node.child(0).nodeSize);
  });

  it("picks the repeated phrase by its context", () => {
    const first = select("refund window", 0);
    const second = select("refund window", 1);
    if (!first || !second) throw new Error("no anchor");
    expect(findAnchor(flat.text, first)?.start).toBe(flat.text.indexOf("refund window"));
    expect(findAnchor(flat.text, second)?.start).toBe(flat.text.lastIndexOf("refund window"));
  });

  it("keeps matching after edits around the quote, and spans blocks", () => {
    const anchor = select("cards.\nFor transfers");
    if (!anchor) throw new Error("no anchor");
    const edited = doc(
      p(text("Updated: the refund window is 14 days for cards.")),
      p(text("For transfers it is longer.")),
    );
    expect(covered(edited, anchorRange(flatten(edited), anchor))).toBe("cards.\nFor transfers");
  });

  it("is detached once the words are gone, and ignores empty selections", () => {
    const anchor = select("14 days");
    if (!anchor) throw new Error("no anchor");
    const rewritten = doc(p(text("The refund window is two weeks.")));
    expect(anchorRange(flatten(rewritten), anchor)).toBeNull();
    expect(anchorFor(flat, 1, 1)).toBeNull();
    const spaces = doc(p(text("a   b")));
    expect(anchorFor(flatten(spaces), 2, 4)).toBeNull();
  });

  it("caps the quote length", () => {
    const long = doc(p(text("x".repeat(600))));
    expect(anchorFor(flatten(long), 1, 601)?.quote).toHaveLength(500);
  });
});
