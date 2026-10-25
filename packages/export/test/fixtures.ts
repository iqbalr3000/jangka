import type { BlockNode, DocNode, TableRowNode } from "@jangka/shared/document";
import { diagramHash, type ExportInput } from "../src/render/index";

/** 1×1 transparent PNG. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const p = (text: string): BlockNode => ({ type: "paragraph", content: [{ type: "text", text }] });

export const VALID_DIAGRAM = "flowchart TD\n  A[Request] --> B[Refund]";
export const BROKEN_DIAGRAM = "flowchart TD\n  A -->";

function row(cells: string[], header = false): TableRowNode {
  return {
    type: "tableRow",
    content: cells.map((text) => ({
      type: header ? "tableHeader" : "tableCell",
      content: [p(text)],
    })),
  };
}

export const everyNode: DocNode = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Plain <b>escaped</b> & " },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: " " },
        { type: "text", text: "italic", marks: [{ type: "italic" }] },
        { type: "hardBreak" },
        { type: "text", text: "code", marks: [{ type: "code" }] },
        { type: "text", text: " " },
        {
          type: "text",
          text: "link",
          marks: [{ type: "link", attrs: { href: 'https://example.com/?a="1"' } }],
        },
      ],
    },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Sub heading" }] },
    { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Minor heading" }] },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            p("One"),
            {
              type: "orderedList",
              content: [{ type: "listItem", content: [p("Nested")] }],
            },
          ],
        },
        { type: "listItem", content: [p("Two")] },
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 3 },
      content: [{ type: "listItem", content: [p("Third")] }],
    },
    { type: "blockquote", content: [p("Quoted")] },
    { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "a < b\nc" }] },
    { type: "horizontalRule" },
    {
      type: "table",
      content: [row(["ID", "Name"], true), row(["1", "Alpha"]), row(["2", "Beta"])],
    },
    { type: "mermaidBlock", attrs: { source: VALID_DIAGRAM } },
    { type: "mermaidBlock", attrs: { source: BROKEN_DIAGRAM } },
  ],
};

export function input(overrides: Partial<ExportInput> = {}): ExportInput {
  return {
    document: {
      title: "Refunds <self-service>",
      docType: "prd",
      status: "draft",
      author: "Ada Admin",
      updatedAt: new Date("2026-10-25T09:00:00Z"),
      orgName: "Acme",
    },
    sections: [
      { title: "Overview", content: everyNode, empty: false },
      { title: "Risks", content: { type: "doc", content: [{ type: "paragraph" }] }, empty: true },
    ],
    diagrams: new Map([
      [diagramHash(VALID_DIAGRAM), { svg: '<svg id="d1"><g></g></svg>', png: TINY_PNG }],
      [diagramHash(BROKEN_DIAGRAM), { error: "Parse error on line 2" }],
    ]),
    includeCover: true,
    ...overrides,
  };
}
