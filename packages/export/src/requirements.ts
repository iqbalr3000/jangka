import type { BlockNode, DocNode, InlineNode, TableNode } from "@jangka/shared/document";
import { REQUIREMENT_PREFIX, type RequirementKind } from "@jangka/templates";

export type RequirementPriority = "must" | "should" | "could";

export type ExtractedRequirement = {
  code: string;
  text: string;
  priority: RequirementPriority | null;
  upstreamCodes: string[];
};

const PRIORITIES: Record<string, RequirementPriority> = {
  must: "must",
  m: "must",
  should: "should",
  s: "should",
  could: "could",
  c: "could",
};

const COLUMN_ALIASES = {
  text: ["requirement", "title", "description"],
  priority: ["priority"],
  upstream: ["upstream", "derives from", "implements"],
} as const;

const UPSTREAM_CODE = /\b(?:BR|FR|NFR)-\d{3,}\b/g;

function inlineText(nodes: InlineNode[] = []): string {
  return nodes.map((node) => (node.type === "text" ? node.text : " ")).join("");
}

function plainText(blocks: BlockNode[]): string {
  return blocks
    .map((block): string => {
      switch (block.type) {
        case "paragraph":
        case "heading":
          return inlineText(block.content);
        case "codeBlock":
          return (block.content ?? []).map((t) => t.text).join("");
        case "blockquote":
          return plainText(block.content);
        case "bulletList":
        case "orderedList":
          return block.content.map((item) => plainText(item.content)).join(" ");
        default:
          return "";
      }
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function priorityOf(text: string): RequirementPriority | null {
  return PRIORITIES[text.trim().toLowerCase()] ?? null;
}

function upstreamOf(text: string): string[] {
  return [...new Set(text.match(UPSTREAM_CODE) ?? [])];
}

function fromTable(table: TableNode, codePattern: RegExp): ExtractedRequirement[] {
  const [header, ...rows] = table.content;
  if (!header) return [];
  const names = header.content.map((cell) => plainText(cell.content).toLowerCase());
  const idColumn = names.indexOf("id");
  if (idColumn === -1) return [];
  const column = (aliases: readonly string[]) => names.findIndex((name) => aliases.includes(name));
  const textColumn = column(COLUMN_ALIASES.text);
  const priorityColumn = column(COLUMN_ALIASES.priority);
  const upstreamColumn = column(COLUMN_ALIASES.upstream);

  return rows.flatMap((row) => {
    const cell = (index: number) =>
      index === -1 ? "" : plainText(row.content[index]?.content ?? []);
    const code = cell(idColumn);
    if (!codePattern.test(code)) return [];
    return [
      {
        code,
        text: cell(textColumn),
        priority: priorityOf(cell(priorityColumn)),
        upstreamCodes: upstreamOf(cell(upstreamColumn)),
      },
    ];
  });
}

/** `FR-001: Text`, `FR-001 — Text`, `FR-001 Text` (the PRD v1 list format). */
function fromLine(blocks: BlockNode[], codePattern: RegExp): ExtractedRequirement | null {
  const text = plainText(blocks);
  const match = /^((?:BR|FR|NFR|TR)-\d{3,})(?:\s*[:—–-]\s*|\s+|$)(.*)$/.exec(text);
  if (!match?.[1] || !codePattern.test(match[1])) return null;
  return { code: match[1], text: match[2] ?? "", priority: null, upstreamCodes: [] };
}

function collect(blocks: BlockNode[], codePattern: RegExp): ExtractedRequirement[] {
  return blocks.flatMap((block): ExtractedRequirement[] => {
    switch (block.type) {
      case "table":
        return fromTable(block, codePattern);
      case "paragraph": {
        const line = fromLine([block], codePattern);
        return line ? [line] : [];
      }
      case "bulletList":
      case "orderedList":
        return block.content.flatMap((item) => {
          const [first, ...rest] = item.content;
          const line = first ? fromLine([first], codePattern) : null;
          return line ? [line, ...collect(rest, codePattern)] : collect(item.content, codePattern);
        });
      case "blockquote":
        return collect(block.content, codePattern);
      default:
        return [];
    }
  });
}

/**
 * Requirements written in a requirement section: rows of a table with an `ID` column,
 * or legacy lines starting with a code. Only codes with the section kind's prefix count; the
 * first occurrence of a code wins.
 */
export function extractRequirements(doc: DocNode, kind: RequirementKind): ExtractedRequirement[] {
  const codePattern = new RegExp(`^${REQUIREMENT_PREFIX[kind]}-\\d{3,}$`);
  const seen = new Set<string>();
  return collect(doc.content ?? [], codePattern).filter((requirement) => {
    if (seen.has(requirement.code)) return false;
    seen.add(requirement.code);
    return true;
  });
}
