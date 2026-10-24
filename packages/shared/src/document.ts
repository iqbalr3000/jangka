import { z } from "zod";

/**
 * Whitelist of TipTap nodes/marks a section may contain. The web editor enables exactly these
 * extensions and `packages/export` serializes exactly these; unknown nodes, marks or attrs are rejected.
 */
export const MAX_SECTION_BYTES = 512 * 1024;
export const MAX_MERMAID_CHARS = 20_000;

const SAFE_HREF = /^(https?:|mailto:)/i;

const bold = z.strictObject({ type: z.literal("bold") });
const italic = z.strictObject({ type: z.literal("italic") });
const code = z.strictObject({ type: z.literal("code") });
const link = z.strictObject({
  type: z.literal("link"),
  attrs: z.strictObject({
    href: z.string().max(2000).regex(SAFE_HREF, { error: "Links must be http(s) or mailto" }),
    target: z.string().nullish(),
    rel: z.string().nullish(),
    class: z.string().nullish(),
    title: z.string().nullish(),
  }),
});
const mark = z.discriminatedUnion("type", [bold, italic, code, link]);
export type Mark = z.infer<typeof mark>;

const text = z.strictObject({
  type: z.literal("text"),
  text: z.string().min(1),
  marks: z.array(mark).optional(),
});
const plainText = z.strictObject({ type: z.literal("text"), text: z.string().min(1) });
const hardBreak = z.strictObject({ type: z.literal("hardBreak") });
const inline = z.discriminatedUnion("type", [text, hardBreak]);
export type TextNode = z.infer<typeof text>;
export type InlineNode = z.infer<typeof inline>;

export type ParagraphNode = { type: "paragraph"; content?: InlineNode[] };
export type HeadingNode = { type: "heading"; attrs: { level: 3 | 4 }; content?: InlineNode[] };
export type CodeBlockNode = {
  type: "codeBlock";
  attrs?: { language?: string | null };
  content?: { type: "text"; text: string }[];
};
export type BlockquoteNode = { type: "blockquote"; content: BlockNode[] };
export type ListItemNode = { type: "listItem"; content: BlockNode[] };
export type BulletListNode = { type: "bulletList"; content: ListItemNode[] };
export type OrderedListNode = {
  type: "orderedList";
  attrs?: { start?: number; type?: string | null };
  content: ListItemNode[];
};
export type HorizontalRuleNode = { type: "horizontalRule" };
export type CellAttrs = { colspan?: number; rowspan?: number; colwidth?: number[] | null };
export type TableCellNode = {
  type: "tableCell" | "tableHeader";
  attrs?: CellAttrs;
  content: BlockNode[];
};
export type TableRowNode = { type: "tableRow"; content: TableCellNode[] };
export type TableNode = { type: "table"; content: TableRowNode[] };
export type MermaidNode = { type: "mermaidBlock"; attrs: { source: string } };
export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | CodeBlockNode
  | BlockquoteNode
  | BulletListNode
  | OrderedListNode
  | HorizontalRuleNode
  | TableNode
  | MermaidNode;
export type DocNode = { type: "doc"; content?: BlockNode[] };

const blocks = (): z.ZodType<BlockNode[]> => z.array(block);

const listItem: z.ZodType<ListItemNode> = z.lazy(() =>
  z.strictObject({ type: z.literal("listItem"), content: blocks() }),
);
const cellAttrs = z.strictObject({
  colspan: z.number().int().min(1).optional(),
  rowspan: z.number().int().min(1).optional(),
  colwidth: z.array(z.number()).nullish(),
});
const cell: z.ZodType<TableCellNode> = z.lazy(() =>
  z.strictObject({
    type: z.enum(["tableCell", "tableHeader"]),
    attrs: cellAttrs.optional(),
    content: blocks(),
  }),
);
const row: z.ZodType<TableRowNode> = z.lazy(() =>
  z.strictObject({ type: z.literal("tableRow"), content: z.array(cell) }),
);

const block: z.ZodType<BlockNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("paragraph"), content: z.array(inline).optional() }),
    z.strictObject({
      type: z.literal("heading"),
      attrs: z.strictObject({ level: z.union([z.literal(3), z.literal(4)]) }),
      content: z.array(inline).optional(),
    }),
    z.strictObject({
      type: z.literal("codeBlock"),
      attrs: z.strictObject({ language: z.string().max(50).nullish() }).optional(),
      content: z.array(plainText).optional(),
    }),
    z.strictObject({ type: z.literal("blockquote"), content: blocks() }),
    z.strictObject({ type: z.literal("bulletList"), content: z.array(listItem) }),
    z.strictObject({
      type: z.literal("orderedList"),
      attrs: z
        .strictObject({ start: z.number().int().optional(), type: z.string().nullish() })
        .optional(),
      content: z.array(listItem),
    }),
    z.strictObject({ type: z.literal("horizontalRule") }),
    z.strictObject({ type: z.literal("table"), content: z.array(row) }),
    z.strictObject({
      type: z.literal("mermaidBlock"),
      attrs: z.strictObject({ source: z.string().max(MAX_MERMAID_CHARS) }),
    }),
  ]),
);

export const docContent: z.ZodType<DocNode> = z
  .strictObject({ type: z.literal("doc"), content: z.array(block).optional() })
  .refine((doc) => new TextEncoder().encode(JSON.stringify(doc)).length <= MAX_SECTION_BYTES, {
    error: "Section is too large",
  });

export const EMPTY_DOC: DocNode = { type: "doc", content: [{ type: "paragraph" }] };

/** No text, diagram, table or rule anywhere: what "empty" means for completeness. */
export function isBlankDoc(doc: DocNode): boolean {
  const visit = (
    node: BlockNode | InlineNode | ListItemNode | TableRowNode | TableCellNode,
  ): boolean => {
    switch (node.type) {
      case "text":
        return node.text.trim() === "";
      case "hardBreak":
        return true;
      case "mermaidBlock":
        return node.attrs.source.trim() === "";
      case "horizontalRule":
      case "table":
        return false;
      default:
        return (node.content ?? []).every(visit);
    }
  };
  return (doc.content ?? []).every(visit);
}

export const completeness = z.enum(["empty", "partial", "complete"]);
export type Completeness = z.infer<typeof completeness>;
export const documentStatus = z.enum(["draft", "in_review", "approved"]);
export const docTypeSchema = z.enum(["brd", "prd", "tsd"]);

export const templateSummary = z.object({
  id: z.string(),
  docType: docTypeSchema,
  name: z.string(),
  version: z.number(),
  sectionCount: z.number(),
});
export const templateList = z.object({ items: z.array(templateSummary) });

export const documentSummary = z.object({
  id: z.string(),
  title: z.string(),
  docType: docTypeSchema,
  status: documentStatus,
  collectionId: z.string().nullable(),
  /** One entry per template section, in order. */
  completeness: z.array(completeness),
  createdBy: z.string().nullable(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});
export type DocumentSummary = z.infer<typeof documentSummary>;

const userRef = z.object({ id: z.string(), name: z.string() });

export const section = z.object({
  key: z.string(),
  title: z.string(),
  required: z.boolean(),
  expectsDiagram: z.string().nullable(),
  position: z.number(),
  content: docContent,
  completeness,
  revision: z.number(),
  updatedAt: z.string(),
  updatedBy: userRef.nullable(),
});
export type Section = z.infer<typeof section>;

export const documentDetail = z.object({
  document: documentSummary,
  level: z.enum(["view", "edit"]),
  collection: z
    .object({ id: z.string(), name: z.string(), personalOwnerId: z.string().nullable() })
    .nullable(),
  /** Inside a personal collection: the UI shows "Personal" for its root. */
  inPersonalTree: z.boolean(),
  sections: z.array(section),
});
export type DocumentDetail = z.infer<typeof documentDetail>;

const title = z.string().trim().min(1, { error: "Required" }).max(200);

export const createDocumentRequest = z.object({
  title,
  collectionId: z.uuid().nullable(),
  docType: z.literal("prd"),
});
export const updateDocumentRequest = z.object({ title });
export const moveDocumentRequest = z.object({ collectionId: z.uuid().nullable() });

export const saveSectionRequest = z.object({
  content: docContent,
  revision: z.number().int().min(0),
});

/** `details` of `409 revision_conflict`. */
export const revisionConflictDetails = z.object({ current: section });

export const sectionVersion = z.object({
  id: z.string(),
  revision: z.number(),
  source: z.enum(["llm", "human"]),
  createdBy: userRef.nullable(),
  createdAt: z.string(),
  content: docContent,
});
export const sectionVersionList = z.object({
  items: z.array(sectionVersion),
  nextCursor: z.string().nullable(),
});
