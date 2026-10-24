import type {
  BlockNode,
  DocNode,
  InlineNode,
  ListItemNode,
  Mark,
  TableNode,
} from "@jangka/shared/document";

const MARK_ORDER: Mark["type"][] = ["link", "bold", "italic", "code"];

function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]])/g, "\\$1");
}

function inlineText(nodes: InlineNode[] = []): string {
  return nodes
    .map((node) => {
      if (node.type === "hardBreak") return "  \n";
      const marks = [...(node.marks ?? [])].sort(
        (a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type),
      );
      let out = marks.some((m) => m.type === "code") ? `\`${node.text}\`` : escapeText(node.text);
      for (const mark of marks.reverse()) {
        if (mark.type === "bold") out = `**${out}**`;
        else if (mark.type === "italic") out = `_${out}_`;
        else if (mark.type === "link") out = `[${out}](${mark.attrs.href})`;
      }
      return out;
    })
    .join("");
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line, i) => (i === 0 || line === "" ? line : `${prefix}${line}`))
    .join("\n");
}

function listItem(item: ListItemNode, marker: string): string {
  const body = item.content.map(block).join("\n\n");
  return `${marker}${indent(body, " ".repeat(marker.length))}`;
}

function cellText(blocks: BlockNode[]): string {
  return blocks.map(block).join(" ").replace(/\n+/g, " ").replace(/\|/g, "\\|");
}

/** GFM table; the first row is the header (TipTap tables always have one). */
function table(node: TableNode): string {
  const rows = node.content.map((row) => row.content.map((cell) => cellText(cell.content)));
  const [header = [], ...body] = rows;
  const width = Math.max(1, ...rows.map((r) => r.length));
  const pad = (cells: string[]) => [...cells, ...Array(width - cells.length).fill("")];
  const line = (cells: string[]) => `| ${pad(cells).join(" | ")} |`;
  return [line(header), line(Array(width).fill("---")), ...body.map(line)].join("\n");
}

function block(node: BlockNode): string {
  switch (node.type) {
    case "paragraph":
      return inlineText(node.content);
    case "heading":
      return `${"#".repeat(node.attrs.level)} ${inlineText(node.content)}`;
    case "codeBlock": {
      const code = (node.content ?? []).map((t) => t.text).join("");
      return `\`\`\`${node.attrs?.language ?? ""}\n${code}\n\`\`\``;
    }
    case "blockquote":
      return node.content
        .map(block)
        .join("\n\n")
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
    case "bulletList":
      return node.content.map((item) => listItem(item, "- ")).join("\n");
    case "orderedList": {
      const start = node.attrs?.start ?? 1;
      return node.content.map((item, i) => listItem(item, `${start + i}. `)).join("\n");
    }
    case "horizontalRule":
      return "---";
    case "table":
      return table(node);
    case "mermaidBlock":
      return `\`\`\`mermaid\n${node.attrs.source}\n\`\`\``;
  }
}

/** Markdown of a section (LLM context, and later export); a blank section is "". */
export function toMarkdown(doc: DocNode): string {
  return (doc.content ?? [])
    .map(block)
    .filter((text) => text.trim() !== "")
    .join("\n\n");
}
