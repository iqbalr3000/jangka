import {
  type BlockNode,
  type DocNode,
  docContent,
  type InlineNode,
  type ListItemNode,
  type Mark,
  type TableCellNode,
} from "@jangka/shared/document";
import { type MarkedToken, marked, type Token, type Tokens } from "marked";

const KNOWN = new Set<string>([
  "blockquote",
  "br",
  "checkbox",
  "code",
  "codespan",
  "def",
  "del",
  "em",
  "escape",
  "heading",
  "hr",
  "html",
  "image",
  "link",
  "list",
  "list_item",
  "paragraph",
  "space",
  "strong",
  "table",
  "text",
]);

/** Narrows marked's open `Token` (it includes a loose generic) to its known token union. */
function known(token: Token): MarkedToken | null {
  return KNOWN.has(token.type) ? (token as MarkedToken) : null;
}

const SAFE_HREF = /^(https?:|mailto:)/i;

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function textNode(text: string, marks: Mark[]): InlineNode[] {
  if (text === "") return [];
  return [{ type: "text", text, ...(marks.length > 0 && { marks: [...marks] }) }];
}

function inline(tokens: Token[] | undefined, marks: Mark[] = []): InlineNode[] {
  const out: InlineNode[] = [];
  for (const raw of tokens ?? []) {
    const token = known(raw);
    if (!token) {
      out.push(...textNode(raw.raw, marks));
      continue;
    }
    switch (token.type) {
      case "strong":
        out.push(...inline(token.tokens, [...marks, { type: "bold" }]));
        break;
      case "em":
        out.push(...inline(token.tokens, [...marks, { type: "italic" }]));
        break;
      case "codespan":
        out.push(...textNode(decodeEntities(token.text), [...marks, { type: "code" }]));
        break;
      case "link":
        out.push(
          ...(SAFE_HREF.test(token.href)
            ? inline(token.tokens, [...marks, { type: "link", attrs: { href: token.href } }])
            : inline(token.tokens, marks)),
        );
        break;
      case "br":
        out.push({ type: "hardBreak" });
        break;
      case "text":
        out.push(
          ...(token.tokens
            ? inline(token.tokens, marks)
            : textNode(decodeEntities(token.text), marks)),
        );
        break;
      case "del":
        out.push(...inline(token.tokens, marks));
        break;
      case "image":
        out.push(...textNode(token.text, marks));
        break;
      case "escape":
      case "html":
        out.push(...textNode(decodeEntities(token.text), marks));
        break;
      default:
        out.push(...textNode(token.raw, marks));
    }
  }
  return mergeText(out);
}

/** Joins adjacent text nodes with identical marks (what TipTap would do on load). */
function mergeText(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const node of nodes) {
    const last = out.at(-1);
    if (
      node.type === "text" &&
      last?.type === "text" &&
      JSON.stringify(last.marks ?? []) === JSON.stringify(node.marks ?? [])
    ) {
      out[out.length - 1] = { ...last, text: last.text + node.text };
    } else {
      out.push(node);
    }
  }
  return out;
}

function paragraph(content: InlineNode[]): BlockNode {
  return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
}

function listItem(item: Tokens.ListItem): ListItemNode {
  const content = blocks(item.tokens);
  return { type: "listItem", content: content.length > 0 ? content : [{ type: "paragraph" }] };
}

function cell(type: "tableHeader" | "tableCell", source: Tokens.TableCell): TableCellNode {
  return { type, content: [paragraph(inline(source.tokens))] };
}

function blocks(tokens: Token[]): BlockNode[] {
  const out: BlockNode[] = [];
  for (const raw of tokens) {
    const token = known(raw);
    if (!token) {
      if (raw.raw.trim()) out.push(paragraph(textNode(raw.raw.trim(), [])));
      continue;
    }
    switch (token.type) {
      case "space":
      case "def":
        break;
      case "paragraph":
        out.push(paragraph(inline(token.tokens)));
        break;
      // Tight list items hold their inline content in a "text" token.
      case "text":
        out.push(
          paragraph(token.tokens ? inline(token.tokens) : textNode(decodeEntities(token.text), [])),
        );
        break;
      case "heading":
        // Section titles are level 2 outside the editor; content headings are 3–4.
        out.push({
          type: "heading",
          attrs: { level: token.depth >= 4 ? 4 : 3 },
          content: inline(token.tokens),
        });
        break;
      case "code":
        if (token.lang?.trim().toLowerCase() === "mermaid") {
          out.push({ type: "mermaidBlock", attrs: { source: token.text } });
        } else {
          out.push({
            type: "codeBlock",
            attrs: { language: token.lang?.trim() || null },
            ...(token.text && { content: [{ type: "text", text: token.text }] }),
          });
        }
        break;
      case "blockquote": {
        const content = blocks(token.tokens);
        out.push({
          type: "blockquote",
          content: content.length ? content : [{ type: "paragraph" }],
        });
        break;
      }
      case "list":
        out.push(
          token.ordered
            ? {
                type: "orderedList",
                attrs: { start: typeof token.start === "number" ? token.start : 1 },
                content: token.items.map(listItem),
              }
            : { type: "bulletList", content: token.items.map(listItem) },
        );
        break;
      case "hr":
        out.push({ type: "horizontalRule" });
        break;
      case "table":
        out.push({
          type: "table",
          content: [
            { type: "tableRow", content: token.header.map((c) => cell("tableHeader", c)) },
            ...token.rows.map((row) => ({
              type: "tableRow" as const,
              content: row.map((c) => cell("tableCell", c)),
            })),
          ],
        });
        break;
      case "html":
        if (token.text.trim()) out.push(paragraph(textNode(decodeEntities(token.text.trim()), [])));
        break;
      default:
        if (token.raw.trim()) out.push(paragraph(textNode(token.raw.trim(), [])));
    }
  }
  return out;
}

/**
 * Markdown (LLM output, so untrusted) → section content limited to the whitelist. The result is
 * validated; anything the whitelist can't hold is degraded to plain text, never passed through.
 */
export function fromMarkdown(markdown: string): DocNode {
  const content = blocks(marked.lexer(markdown, { gfm: true }));
  return docContent.parse({
    type: "doc",
    content: content.length ? content : [{ type: "paragraph" }],
  });
}
