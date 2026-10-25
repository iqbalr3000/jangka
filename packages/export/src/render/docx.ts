import type {
  BlockNode,
  InlineNode,
  ListItemNode,
  TableCellNode,
  TableNode,
} from "@jangka/shared/document";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from "docx";
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

// Twips (1/20 pt): A4 with 20 mm margins.
const PAGE = { width: 11906, height: 16838, margin: 1134 };
const CONTENT_WIDTH = PAGE.width - 2 * PAGE.margin;
const MAX_IMAGE_PX = 605; // 16 cm at 96 dpi
const FONT = "Inter";
const MONO = "JetBrains Mono";
const MUTED = "5C5C58";
const SURFACE_2 = "F4F4F2";
const BORDER = "E5E5E2";
const LIST_LEVELS = 6;

type Child = Paragraph | Table;
type Context = {
  figures: number;
  sectionTitle: string;
  diagrams: ExportInput["diagrams"];
  /** Each ordered list is its own numbering instance, so numbering restarts per list. */
  listInstances: number;
  /** `start` values other than 1 need their own numbering definition. */
  starts: Set<number>;
};
type ListState = { level: number; reference: string; instance?: number };
/** Where a block sits: inside a list (indent) and/or a blockquote (left rule). */
type Placement = { listLevel?: number; quote?: boolean };

const QUOTE_BORDER = {
  left: { style: BorderStyle.SINGLE, size: 12, color: "DCDCD8", space: 8 },
};

function runs(nodes: InlineNode[] = []): (TextRun | ExternalHyperlink)[] {
  return nodes.map((node) => {
    if (node.type === "hardBreak") return new TextRun({ text: "", break: 1 });
    const has = (type: string) => node.marks?.some((m) => m.type === type) ?? false;
    const text = new TextRun({
      text: node.text,
      bold: has("bold") || undefined,
      italics: has("italic") || undefined,
      ...(has("code") ? { font: MONO, size: 18, shading: shade(SURFACE_2) } : {}),
      ...(has("link") ? { style: "Hyperlink" } : {}),
    });
    const link = node.marks?.find((m) => m.type === "link");
    return link?.type === "link"
      ? new ExternalHyperlink({ link: link.attrs.href, children: [text] })
      : text;
  });
}

function shade(fill: string) {
  return { type: ShadingType.CLEAR, color: "auto", fill };
}

/** PNG pixel size from the IHDR chunk (bytes 16–23). */
export function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function codeLines(text: string): Paragraph[] {
  const lines = text.split("\n");
  return lines.map(
    (line, i) =>
      new Paragraph({
        children: [new TextRun({ text: line, font: MONO, size: 18 })],
        shading: shade(SURFACE_2),
        spacing: { before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 160 : 0 },
      }),
  );
}

function diagram(source: string, ctx: Context): Child[] {
  const result = ctx.diagrams.get(diagramHash(source)) ?? { error: DIAGRAM_MISSING };
  if ("error" in result) {
    return [
      new Paragraph({
        children: [
          new TextRun({
            text: `Diagram could not be rendered: ${result.error}`,
            color: "B91C1C",
            size: 18,
          }),
        ],
      }),
      ...codeLines(source),
    ];
  }
  // Rendered at 2x: halve to get the intended size, then fit the page width.
  const { width, height } = pngSize(result.png);
  const scale = Math.min(1, MAX_IMAGE_PX / (width / 2));
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      keepNext: true,
      spacing: { before: 160 },
      children: [
        new ImageRun({
          type: "png",
          data: result.png,
          transformation: {
            width: Math.round((width / 2) * scale),
            height: Math.round((height / 2) * scale),
          },
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: figureCaption(ctx.figures++, ctx.sectionTitle),
          size: 18,
          color: MUTED,
        }),
      ],
    }),
  ];
}

function cell(node: TableCellNode, ctx: Context, zebra: boolean): TableCell {
  const header = node.type === "tableHeader";
  const children = blocks(node.content, ctx);
  return new TableCell({
    children: children.length ? children : [new Paragraph("")],
    columnSpan: node.attrs?.colspan,
    rowSpan: node.attrs?.rowspan,
    shading: header ? shade("ECECE9") : zebra ? shade(SURFACE_2) : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}

function table(node: TableNode, ctx: Context): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: BORDER };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: node.content.map((row, i) => {
      const header = row.content.every((c) => c.type === "tableHeader");
      return new TableRow({
        // A header row repeats on each page the table spans.
        tableHeader: i === 0 && header,
        cantSplit: true,
        children: row.content.map((c) => cell(c, ctx, !header && i % 2 === 0)),
      });
    }),
  });
}

function listItems(items: ListItemNode[], list: ListState, ctx: Context, at: Placement): Child[] {
  return items.flatMap((item) =>
    item.content.flatMap((child, i): Child[] => {
      if (child.type === "bulletList" || child.type === "orderedList") {
        return block(child, ctx, { ...at, listLevel: list.level + 1 });
      }
      if (i !== 0 || child.type !== "paragraph") {
        return block(child, ctx, { ...at, listLevel: list.level });
      }
      // The item's first paragraph carries the bullet/number.
      return [
        new Paragraph({
          children: runs(child.content),
          numbering: { reference: list.reference, level: list.level, instance: list.instance },
          border: at.quote ? QUOTE_BORDER : undefined,
          spacing: { after: 60 },
        }),
      ];
    }),
  );
}

function block(node: BlockNode, ctx: Context, at: Placement = {}): Child[] {
  const level = at.listLevel ?? -1;
  switch (node.type) {
    case "paragraph":
      return [
        new Paragraph({
          children: runs(node.content),
          indent: level >= 0 ? { left: 720 * (level + 1) } : at.quote ? { left: 360 } : undefined,
          border: at.quote ? QUOTE_BORDER : undefined,
        }),
      ];
    case "heading":
      return [
        new Paragraph({
          heading: node.attrs.level === 3 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
          children: runs(node.content),
        }),
      ];
    case "codeBlock":
      return codeLines((node.content ?? []).map((t) => t.text).join(""));
    case "blockquote":
      return node.content.flatMap((child) => block(child, ctx, { ...at, quote: true }));
    case "bulletList":
      return listItems(node.content, { level: Math.max(0, level), reference: "bullet" }, ctx, at);
    case "orderedList": {
      const start = node.attrs?.start ?? 1;
      if (start !== 1) ctx.starts.add(start);
      return listItems(
        node.content,
        {
          level: Math.max(0, level),
          reference: start === 1 ? "number" : `number-${start}`,
          instance: ++ctx.listInstances,
        },
        ctx,
        at,
      );
    }
    case "horizontalRule":
      return [
        new Paragraph({
          children: [],
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER, space: 1 } },
        }),
      ];
    case "table":
      return [table(node, ctx), new Paragraph("")];
    case "mermaidBlock":
      return node.attrs.source.trim() ? diagram(node.attrs.source, ctx) : [];
  }
}

function blocks(nodes: BlockNode[], ctx: Context): Child[] {
  return nodes.flatMap((node) => block(node, ctx));
}

function appendix(rows: ExportInput["appendix"]): Child[] {
  if (!rows?.length) return [];
  const border = { style: BorderStyle.SINGLE, size: 4, color: BORDER };
  const cellOf = (text: string, opts: { header?: boolean; mono?: boolean; zebra?: boolean }) =>
    new TableCell({
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text,
              bold: opts.header || undefined,
              ...(opts.mono ? { font: MONO, size: 18 } : {}),
            }),
          ],
        }),
      ],
      shading: opts.header ? shade("ECECE9") : opts.zebra ? shade(SURFACE_2) : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
    });
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
      children: [new TextRun(APPENDIX_TITLE)],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: border,
        bottom: border,
        left: border,
        right: border,
        insideHorizontal: border,
        insideVertical: border,
      },
      rows: [
        new TableRow({
          tableHeader: true,
          children: APPENDIX_COLUMNS.map((name) => cellOf(name, { header: true })),
        }),
        ...rows.map((row, i) => {
          const [code, text, priority, upstream] = appendixCells(row);
          const zebra = i % 2 === 1;
          return new TableRow({
            cantSplit: true,
            children: [
              cellOf(code, { mono: true, zebra }),
              cellOf(text, { zebra }),
              cellOf(priority, { zebra }),
              cellOf(upstream, { mono: true, zebra }),
            ],
          });
        }),
      ],
    }),
  ];
}

function numberingDefinition(reference: string, format: "bullet" | "decimal", start = 1) {
  const bullets = ["•", "◦", "▪"];
  return {
    reference,
    levels: Array.from({ length: LIST_LEVELS }, (_, level) => ({
      level,
      format: format === "bullet" ? LevelFormat.BULLET : LevelFormat.DECIMAL,
      text: format === "bullet" ? (bullets[level % bullets.length] ?? "•") : `%${level + 1}.`,
      start: level === 0 ? start : 1,
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
    })),
  };
}

function cover(doc: ExportInput["document"]): Paragraph[] {
  const meta = [
    ["Status", STATUS_LABEL[doc.status]],
    ["Author", doc.author ?? "—"],
    ["Last updated", formatDate(doc.updatedAt)],
  ] as const;
  return [
    new Paragraph({
      children: [
        new TextRun({ text: "j", bold: true, size: 24 }),
        new TextRun({ text: "Λ", bold: true, size: 24, color: "1D4ED8" }),
        new TextRun({ text: "ngka", bold: true, size: 24 }),
      ],
      spacing: { after: 4000 },
    }),
    new Paragraph({
      children: [new TextRun({ text: DOC_TYPE_LABEL[doc.docType], font: MONO, size: 18 })],
      border: {
        top: { style: BorderStyle.SINGLE, size: 4, color: "DCDCD8", space: 1 },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: "DCDCD8", space: 1 },
        left: { style: BorderStyle.SINGLE, size: 4, color: "DCDCD8", space: 2 },
        right: { style: BorderStyle.SINGLE, size: 4, color: "DCDCD8", space: 2 },
      },
      spacing: { after: 200 },
    }),
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(doc.title)] }),
    ...meta.map(
      ([label, value]) =>
        new Paragraph({
          tabStops: [{ type: TabStopType.LEFT, position: 1900 }],
          children: [new TextRun({ text: label, color: MUTED }), new TextRun(`\t${value}`)],
          spacing: { after: 60 },
        }),
    ),
  ];
}

function chrome(doc: ExportInput["document"]) {
  const tab = [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }];
  const small = { size: 16, color: MUTED };
  return {
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            tabStops: tab,
            children: [
              new TextRun({ text: doc.title, ...small }),
              new TextRun({
                text: `\t${DOC_TYPE_LABEL[doc.docType]} · ${STATUS_LABEL[doc.status]}`,
                ...small,
              }),
            ],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            tabStops: tab,
            children: [
              new TextRun({ text: doc.orgName ?? "", ...small }),
              new TextRun({
                children: ["\t", PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES],
                ...small,
              }),
            ],
          }),
        ],
      }),
    },
  };
}

export async function toDocx(input: ExportInput): Promise<Buffer> {
  const ctx: Context = {
    figures: 1,
    sectionTitle: "",
    diagrams: input.diagrams,
    listInstances: 0,
    starts: new Set(),
  };
  const body: Child[] = [];
  if (!input.includeCover) {
    body.push(
      new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(input.document.title)] }),
    );
  }
  for (const section of input.sections) {
    ctx.sectionTitle = section.title;
    body.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(section.title)] }),
    );
    if (section.empty) {
      body.push(
        new Paragraph({
          children: [new TextRun({ text: EMPTY_SECTION_TEXT, color: MUTED })],
          shading: shade(SURFACE_2),
          spacing: { before: 80, after: 160 },
        }),
      );
    } else {
      body.push(...blocks(section.content.content ?? [], ctx));
    }
  }
  body.push(...appendix(input.appendix));

  const page = {
    size: { width: PAGE.width, height: PAGE.height },
    margin: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
  };
  const document = new Document({
    creator: "Jangka",
    title: input.document.title,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 22 },
          paragraph: { spacing: { after: 120, line: 288 } },
        },
        title: { run: { font: FONT, size: 56, bold: true } },
        heading1: {
          run: { font: FONT, size: 32, bold: true },
          paragraph: { spacing: { before: 360, after: 120 } },
        },
        heading2: {
          run: { font: FONT, size: 26, bold: true },
          paragraph: { spacing: { before: 240, after: 100 } },
        },
        heading3: {
          run: { font: FONT, size: 22, bold: true },
          paragraph: { spacing: { before: 200, after: 80 } },
        },
        hyperlink: { run: { color: "1D4ED8", underline: {} } },
      },
    },
    numbering: {
      config: [
        numberingDefinition("bullet", "bullet"),
        numberingDefinition("number", "decimal"),
        ...[...ctx.starts].map((start) => numberingDefinition(`number-${start}`, "decimal", start)),
      ],
    },
    sections: [
      ...(input.includeCover ? [{ properties: { page }, children: cover(input.document) }] : []),
      { properties: { page }, ...chrome(input.document), children: body },
    ],
  });
  return Packer.toBuffer(document);
}
