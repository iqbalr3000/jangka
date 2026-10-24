import type { BlockNode } from "@jangka/shared/document";
import { describe, expect, it } from "vitest";
import { toMarkdown } from "../src/index";

const p = (text: string): BlockNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const md = (...content: BlockNode[]) => toMarkdown({ type: "doc", content });

describe("toMarkdown", () => {
  it("returns an empty string for a blank section", () => {
    expect(toMarkdown({ type: "doc" })).toBe("");
    expect(md({ type: "paragraph" })).toBe("");
  });

  it("renders inline marks, links and hard breaks", () => {
    expect(
      md({
        type: "paragraph",
        content: [
          { type: "text", text: "a*b " },
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: " " },
          { type: "text", text: "both", marks: [{ type: "italic" }, { type: "bold" }] },
          { type: "hardBreak" },
          { type: "text", text: "x_y", marks: [{ type: "code" }] },
          { type: "text", text: " " },
          {
            type: "text",
            text: "site",
            marks: [{ type: "link", attrs: { href: "https://example.com" } }],
          },
        ],
      }),
    ).toBe("a\\*b **bold** **_both_**  \n`x_y` [site](https://example.com)");
  });

  it("renders headings, quotes, code blocks and rules", () => {
    expect(
      md(
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Scope" }] },
        { type: "blockquote", content: [p("one"), p("two")] },
        { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "x()" }] },
        { type: "horizontalRule" },
      ),
    ).toBe("### Scope\n\n> one\n>\n> two\n\n```ts\nx()\n```\n\n---");
  });

  it("renders nested and ordered lists", () => {
    expect(
      md(
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                p("parent"),
                { type: "bulletList", content: [{ type: "listItem", content: [p("child")] }] },
              ],
            },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            { type: "listItem", content: [p("c")] },
            { type: "listItem", content: [p("d")] },
          ],
        },
      ),
    ).toBe("- parent\n\n  - child\n\n3. c\n4. d");
  });

  it("renders tables as GFM, escaping pipes", () => {
    const cell = (type: "tableCell" | "tableHeader", text: string) => ({
      type,
      content: [p(text)],
    });
    expect(
      md({
        type: "table",
        content: [
          { type: "tableRow", content: [cell("tableHeader", "ID"), cell("tableHeader", "Title")] },
          { type: "tableRow", content: [cell("tableCell", "FR-001"), cell("tableCell", "a|b")] },
        ],
      }),
    ).toBe("| ID | Title |\n| --- | --- |\n| FR-001 | a\\|b |");
  });

  it("renders mermaid blocks as fenced code", () => {
    expect(md({ type: "mermaidBlock", attrs: { source: "flowchart TD\n  A --> B" } })).toBe(
      "```mermaid\nflowchart TD\n  A --> B\n```",
    );
  });
});
