import { describe, expect, it } from "vitest";
import { type DocNode, docContent, isBlankDoc, MAX_SECTION_BYTES } from "./document";

/** Every whitelisted node and mark, with the attrs TipTap emits by default. */
const kitchenSink: DocNode = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Plain " },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: " " },
        { type: "text", text: "it", marks: [{ type: "italic" }] },
        { type: "hardBreak" },
        { type: "text", text: "code", marks: [{ type: "code" }] },
        {
          type: "text",
          text: "link",
          marks: [
            {
              type: "link",
              attrs: {
                href: "https://example.com",
                target: "_blank",
                rel: "noopener noreferrer nofollow",
                class: null,
              },
            },
          ],
        },
      ],
    },
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Sub" }] },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
        },
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 1, type: null },
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }],
        },
      ],
    },
    {
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: "q" }] }],
    },
    { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "x = 1" }] },
    { type: "horizontalRule" },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [{ type: "paragraph", content: [{ type: "text", text: "ID" }] }],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              attrs: { colspan: 1, rowspan: 1, colwidth: null },
              content: [{ type: "paragraph", content: [{ type: "text", text: "FR-001" }] }],
            },
          ],
        },
      ],
    },
    { type: "mermaidBlock", attrs: { source: "flowchart TD\n  A --> B" } },
  ],
};

describe("docContent", () => {
  it("accepts every whitelisted node and mark", () => {
    expect(docContent.safeParse(kitchenSink).success).toBe(true);
    expect(docContent.safeParse({ type: "doc", content: [{ type: "paragraph" }] }).success).toBe(
      true,
    );
  });

  it("rejects unknown nodes, marks and attrs", () => {
    const bad: unknown[] = [
      { type: "doc", content: [{ type: "image", attrs: { src: "x" } }] },
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "s", marks: [{ type: "strike" }] }],
          },
        ],
      },
      { type: "doc", content: [{ type: "paragraph", attrs: { onclick: "x" } }] },
      { type: "doc", content: [{ type: "heading", attrs: { level: 1 } }] },
    ];
    for (const doc of bad) expect(docContent.safeParse(doc).success).toBe(false);
  });

  it("rejects javascript: links", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    };
    expect(docContent.safeParse(doc).success).toBe(false);
  });

  it("rejects oversize sections", () => {
    const big = "x".repeat(MAX_SECTION_BYTES);
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: big }] }],
    };
    expect(docContent.safeParse(doc).success).toBe(false);
  });
});

describe("isBlankDoc", () => {
  it("treats whitespace-only content as blank", () => {
    expect(isBlankDoc({ type: "doc" })).toBe(true);
    expect(isBlankDoc({ type: "doc", content: [{ type: "paragraph" }] })).toBe(true);
    expect(
      isBlankDoc({
        type: "doc",
        content: [
          { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
        ],
      }),
    ).toBe(true);
    expect(isBlankDoc(kitchenSink)).toBe(false);
    expect(
      isBlankDoc({ type: "doc", content: [{ type: "mermaidBlock", attrs: { source: "a" } }] }),
    ).toBe(false);
  });
});
