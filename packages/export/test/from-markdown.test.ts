import type { BlockNode, DocNode } from "@jangka/shared/document";
import { describe, expect, it } from "vitest";
import { fromMarkdown, toMarkdown } from "../src/index";

const blocks = (md: string) => fromMarkdown(md).content ?? [];
const p = (text: string): BlockNode => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("fromMarkdown", () => {
  it("returns an empty paragraph for blank input", () => {
    expect(fromMarkdown("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("maps inline marks and safe links, dropping unsafe ones", () => {
    expect(blocks("a **b** _c_ `d<e>` [x](https://e.com) [y](javascript:alert(1))")).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a " },
          { type: "text", text: "b", marks: [{ type: "bold" }] },
          { type: "text", text: " " },
          { type: "text", text: "c", marks: [{ type: "italic" }] },
          { type: "text", text: " " },
          { type: "text", text: "d<e>", marks: [{ type: "code" }] },
          { type: "text", text: " " },
          { type: "text", text: "x", marks: [{ type: "link", attrs: { href: "https://e.com" } }] },
          { type: "text", text: " y" },
        ],
      },
    ]);
  });

  it("demotes headings into the 3–4 range", () => {
    expect(
      blocks("# A\n\n## B\n\n### C\n\n##### D").map((b) => b.type === "heading" && b.attrs.level),
    ).toEqual([3, 3, 3, 4]);
  });

  it("maps nested and ordered lists", () => {
    expect(blocks("3. one\n4. two\n   - nested")).toEqual([
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [
          { type: "listItem", content: [p("one")] },
          {
            type: "listItem",
            content: [
              p("two"),
              { type: "bulletList", content: [{ type: "listItem", content: [p("nested")] }] },
            ],
          },
        ],
      },
    ]);
  });

  it("turns ```mermaid fences into diagram blocks and others into code blocks", () => {
    expect(blocks("```mermaid\nflowchart TD\n  A --> B\n```\n\n```ts\nx()\n```")).toEqual([
      { type: "mermaidBlock", attrs: { source: "flowchart TD\n  A --> B" } },
      { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "x()" }] },
    ]);
  });

  it("maps GFM tables with a header row", () => {
    const [table] = blocks("| ID | Title |\n| --- | --- |\n| FR-001 | Refund |");
    expect(table).toEqual({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [p("ID")] },
            { type: "tableHeader", content: [p("Title")] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [p("FR-001")] },
            { type: "tableCell", content: [p("Refund")] },
          ],
        },
      ],
    });
  });

  it("keeps raw HTML as text, never as markup", () => {
    expect(blocks("<script>alert(1)</script>")).toEqual([p("<script>alert(1)</script>")]);
  });

  it("round-trips toMarkdown output", () => {
    const doc: DocNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Refund a*b " },
            { type: "text", text: "now", marks: [{ type: "bold" }] },
          ],
        },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Scope" }] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [p("a")] },
            { type: "listItem", content: [p("b")] },
          ],
        },
        { type: "blockquote", content: [p("quote")] },
        { type: "horizontalRule" },
        { type: "mermaidBlock", attrs: { source: "flowchart TD\n  A --> B" } },
      ],
    };
    expect(fromMarkdown(toMarkdown(doc))).toEqual(doc);
  });
});
