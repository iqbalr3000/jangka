import type {
  BlockNode,
  InlineNode,
  ListItemNode,
  Mark,
  TableCellNode,
  TableNode,
} from "@jangka/shared/document";
import { diagramHash } from "./hash";
import {
  APPENDIX_COLUMNS,
  APPENDIX_TITLE,
  appendixCells,
  DIAGRAM_MISSING,
  DOC_TYPE_LABEL,
  EMPTY_SECTION_TEXT,
  type ExportInput,
  figureCaption,
  formatDate,
  STATUS_LABEL,
} from "./types";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

const MARK_ORDER: Mark["type"][] = ["link", "bold", "italic", "code"];

function inline(nodes: InlineNode[] = []): string {
  return nodes
    .map((node) => {
      if (node.type === "hardBreak") return "<br>";
      const marks = [...(node.marks ?? [])].sort(
        (a, b) => MARK_ORDER.indexOf(b.type) - MARK_ORDER.indexOf(a.type),
      );
      let out = escapeHtml(node.text);
      for (const mark of marks) {
        if (mark.type === "code") out = `<code>${out}</code>`;
        else if (mark.type === "bold") out = `<strong>${out}</strong>`;
        else if (mark.type === "italic") out = `<em>${out}</em>`;
        // href is already restricted to http(s)/mailto by the content schema.
        else out = `<a href="${escapeHtml(mark.attrs.href)}">${out}</a>`;
      }
      return out;
    })
    .join("");
}

type Figures = { next: number; sectionTitle: string; diagrams: ExportInput["diagrams"] };

function cell(node: TableCellNode, figures: Figures): string {
  const tag = node.type === "tableHeader" ? "th" : "td";
  const span = [
    node.attrs?.colspan && node.attrs.colspan > 1 ? ` colspan="${node.attrs.colspan}"` : "",
    node.attrs?.rowspan && node.attrs.rowspan > 1 ? ` rowspan="${node.attrs.rowspan}"` : "",
  ].join("");
  return `<${tag}${span}>${blocks(node.content, figures)}</${tag}>`;
}

/** A first row of header cells becomes `<thead>`, so it repeats on every printed page. */
function table(node: TableNode, figures: Figures): string {
  const [first, ...rest] = node.content;
  const headed = first?.content.every((c) => c.type === "tableHeader") ?? false;
  const row = (r: (typeof node.content)[number]) =>
    `<tr>${r.content.map((c) => cell(c, figures)).join("")}</tr>`;
  const head = headed && first ? `<thead>${row(first)}</thead>` : "";
  const body = (headed ? rest : node.content).map(row).join("");
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

function listItem(item: ListItemNode, figures: Figures): string {
  return `<li>${blocks(item.content, figures)}</li>`;
}

function diagram(source: string, figures: Figures): string {
  const result = figures.diagrams.get(diagramHash(source)) ?? { error: DIAGRAM_MISSING };
  if ("error" in result) {
    return [
      `<div class="diagram-error"><p>Diagram could not be rendered: ${escapeHtml(result.error)}</p>`,
      `<pre><code>${escapeHtml(source)}</code></pre></div>`,
    ].join("");
  }
  const caption = figureCaption(figures.next++, figures.sectionTitle);
  // Our own render of a sandboxed Mermaid run; the PDF page runs with JavaScript disabled.
  return `<figure>${result.svg}<figcaption>${escapeHtml(caption)}</figcaption></figure>`;
}

function block(node: BlockNode, figures: Figures): string {
  switch (node.type) {
    case "paragraph":
      return `<p>${inline(node.content)}</p>`;
    case "heading":
      return `<h${node.attrs.level}>${inline(node.content)}</h${node.attrs.level}>`;
    case "codeBlock":
      return `<pre><code>${escapeHtml((node.content ?? []).map((t) => t.text).join(""))}</code></pre>`;
    case "blockquote":
      return `<blockquote>${blocks(node.content, figures)}</blockquote>`;
    case "bulletList":
      return `<ul>${node.content.map((item) => listItem(item, figures)).join("")}</ul>`;
    case "orderedList": {
      const start = node.attrs?.start ?? 1;
      const attr = start !== 1 ? ` start="${start}"` : "";
      return `<ol${attr}>${node.content.map((item) => listItem(item, figures)).join("")}</ol>`;
    }
    case "horizontalRule":
      return "<hr>";
    case "table":
      return table(node, figures);
    case "mermaidBlock":
      return node.attrs.source.trim() ? diagram(node.attrs.source, figures) : "";
  }
}

function blocks(nodes: BlockNode[], figures: Figures): string {
  return nodes.map((node) => block(node, figures)).join("");
}

function cover(doc: ExportInput["document"]): string {
  const meta = [
    ["Status", STATUS_LABEL[doc.status]],
    ["Author", doc.author ?? "—"],
    ["Last updated", formatDate(doc.updatedAt)],
  ]
    .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value ?? "")}</dd>`)
    .join("");
  return [
    '<section class="cover">',
    '<div class="wordmark">j<span>Λ</span>ngka</div>',
    `<div class="cover-body"><span class="badge">${DOC_TYPE_LABEL[doc.docType]}</span>`,
    `<h1>${escapeHtml(doc.title)}</h1><dl>${meta}</dl></div>`,
    "</section>",
  ].join("");
}

function appendix(rows: ExportInput["appendix"]): string {
  if (!rows?.length) return "";
  const head = APPENDIX_COLUMNS.map((name) => `<th>${name}</th>`).join("");
  const body = rows
    .map((row) => {
      const [code, text, priority, upstream] = appendixCells(row).map(escapeHtml);
      return `<tr><td class="mono">${code}</td><td>${text}</td><td>${priority}</td><td class="mono">${upstream}</td></tr>`;
    })
    .join("");
  return `<section class="appendix"><h2>${APPENDIX_TITLE}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`;
}

const PRINT_CSS = `
@page { size: A4; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: "Inter Variable", system-ui, sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a19; }
h1, h2, h3, h4 { font-weight: 600; line-height: 1.25; break-after: avoid; }
h1 { font-size: 24pt; letter-spacing: -0.02em; margin: 0 0 12pt; }
h2 { font-size: 16pt; margin: 22pt 0 8pt; padding-bottom: 4pt; border-bottom: 1px solid #e5e5e2; }
h3 { font-size: 13pt; margin: 14pt 0 6pt; }
h4 { font-size: 11pt; margin: 12pt 0 4pt; }
p { margin: 0 0 8pt; }
a { color: #1d4ed8; }
code, pre { font-family: "JetBrains Mono Variable", ui-monospace, monospace; font-size: 9pt; }
:not(pre) > code { background: #f4f4f2; border-radius: 3px; padding: 0 3px; }
pre { background: #f4f4f2; border: 1px solid #e5e5e2; border-radius: 4px; padding: 8pt; white-space: pre-wrap; word-break: break-word; }
blockquote { margin: 0 0 8pt; padding-left: 10pt; border-left: 3px solid #dcdcd8; color: #5c5c58; }
ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
li > p { margin-bottom: 2pt; }
hr { border: 0; border-top: 1px solid #e5e5e2; margin: 12pt 0; }
table { width: 100%; border-collapse: collapse; margin: 0 0 10pt; font-size: 10pt; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { border: 1px solid #e5e5e2; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #ecece9; font-weight: 600; }
tbody tr:nth-child(even) td { background: #f4f4f2; }
th p, td p { margin: 0; }
figure { margin: 10pt 0 12pt; text-align: center; break-inside: avoid; }
figure svg { max-width: 100%; height: auto; }
figcaption { margin-top: 6pt; font-size: 9pt; color: #5c5c58; }
.mono { font-family: "JetBrains Mono Variable", ui-monospace, monospace; font-size: 9pt; white-space: nowrap; }
.appendix { break-before: page; }
.empty { background: #f4f4f2; border-radius: 4px; padding: 10pt; color: #5c5c58; }
.diagram-error p { color: #b91c1c; font-size: 9pt; }
.cover { height: 250mm; display: flex; flex-direction: column; break-after: page; }
.wordmark { font-size: 12pt; font-weight: 600; letter-spacing: -0.03em; }
.wordmark span { color: #1d4ed8; }
.cover-body { margin-top: 70mm; }
.badge { display: inline-block; font-family: "JetBrains Mono Variable", ui-monospace, monospace; font-size: 9pt; font-weight: 500; border: 1px solid #dcdcd8; border-radius: 3px; padding: 1pt 5pt; margin-bottom: 10pt; }
.cover h1 { font-size: 30pt; margin-bottom: 18pt; }
.cover dl { display: grid; grid-template-columns: 34mm 1fr; gap: 4pt 0; margin: 0; color: #5c5c58; }
.cover dd { margin: 0; color: #1a1a19; }
`;

/** Self-contained print HTML; `fontCss` holds the @font-face rules (fonts as data URIs). */
export function toHtml(input: ExportInput, opts: { fontCss: string }): string {
  const figures: Figures = { next: 1, sectionTitle: "", diagrams: input.diagrams };
  const sections = input.sections
    .map((section) => {
      figures.sectionTitle = section.title;
      const body = section.empty
        ? `<div class="empty">${EMPTY_SECTION_TEXT}</div>`
        : blocks(section.content.content ?? [], figures);
      return `<section><h2>${escapeHtml(section.title)}</h2>${body}</section>`;
    })
    .join("");
  const title = input.includeCover ? "" : `<h1>${escapeHtml(input.document.title)}</h1>`;
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(input.document.title)}</title>`,
    `<style>${opts.fontCss}${PRINT_CSS}</style></head><body>`,
    input.includeCover ? cover(input.document) : "",
    `<main>${title}${sections}${appendix(input.appendix)}</main></body></html>`,
  ].join("");
}

/** Chromium header/footer templates; they don't inherit page styles, so sizes are explicit. */
export function pdfChrome(doc: ExportInput["document"]): {
  headerTemplate: string;
  footerTemplate: string;
} {
  const style =
    "font-family: system-ui, sans-serif; font-size: 8px; color: #5c5c58; width: 100%; padding: 0 20mm; display: flex; justify-content: space-between;";
  return {
    headerTemplate: `<div style="${style}"><span>${escapeHtml(doc.title)}</span><span>${DOC_TYPE_LABEL[doc.docType]} · ${STATUS_LABEL[doc.status]}</span></div>`,
    footerTemplate: `<div style="${style}"><span>${escapeHtml(doc.orgName ?? "")}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  };
}
