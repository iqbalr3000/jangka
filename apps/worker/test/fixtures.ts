import {
  createDb,
  type Database,
  documentExports,
  documentSections,
  documents,
  instanceSettings,
  templates,
  users,
} from "@jangka/db";
import type { BlockNode, DocNode, TableRowNode } from "@jangka/shared/document";
import { builtinTemplates } from "@jangka/templates";
import { workerTestDatabaseUrl } from "./database";

export function testDatabase() {
  return createDb(workerTestDatabaseUrl());
}

const p = (text: string): BlockNode => ({ type: "paragraph", content: [{ type: "text", text }] });
const mermaid = (source: string): BlockNode => ({ type: "mermaidBlock", attrs: { source } });

export const DIAGRAMS = [
  "flowchart TD\n  A[Customer requests refund] --> B{Eligible?}\n  B -- yes --> C[Refund issued]\n  B -- no --> D[Explain why]",
  "sequenceDiagram\n  participant U as User\n  participant S as Service\n  U->>S: POST /refunds\n  S-->>U: 202 Accepted",
  "stateDiagram-v2\n  [*] --> Requested\n  Requested --> Approved\n  Requested --> Rejected\n  Approved --> [*]",
];

function row(cells: string[], header = false): TableRowNode {
  return {
    type: "tableRow",
    content: cells.map((text) => ({
      type: header ? "tableHeader" : "tableCell",
      content: [p(text)],
    })),
  };
}

/** Baseline load: 3 diagrams and a 30-row table (plus its header row). */
export const baselineSections: Record<string, DocNode> = {
  overview: {
    type: "doc",
    content: [
      p("Customers can request a refund without contacting support."),
      mermaid(DIAGRAMS[0] ?? ""),
    ],
  },
  functional_requirements: {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          row(["ID", "Requirement", "Priority"], true),
          ...Array.from({ length: 30 }, (_, i) =>
            row([`FR-${String(i + 1).padStart(3, "0")}`, `Requirement number ${i + 1}`, "Must"]),
          ),
        ],
      },
    ],
  },
  user_flow: { type: "doc", content: [mermaid(DIAGRAMS[1] ?? ""), mermaid(DIAGRAMS[2] ?? "")] },
};

export async function seedDocument(
  db: Database,
  contents: Record<string, DocNode> = baselineSections,
): Promise<{ documentId: string; userId: string }> {
  const definition = builtinTemplates[0];
  if (!definition) throw new Error("PRD template missing");
  await db.insert(instanceSettings).values({ id: 1, orgName: "Acme" }).onConflictDoNothing();
  const [template] = await db
    .insert(templates)
    .values({
      docType: definition.docType,
      name: definition.name,
      version: definition.version,
      definition,
      isBuiltin: true,
    })
    .returning();
  const [user] = await db
    .insert(users)
    .values({ name: "Ada Admin", email: "ada@acme.co" })
    .returning();
  if (!template || !user) throw new Error("seed failed");
  const [doc] = await db
    .insert(documents)
    .values({
      title: "Refund self-service",
      docType: "prd",
      templateId: template.id,
      createdBy: user.id,
    })
    .returning();
  if (!doc) throw new Error("document not created");
  await db.insert(documentSections).values(
    definition.sections.map((section, position) => {
      const content = contents[section.key];
      return {
        documentId: doc.id,
        sectionKey: section.key,
        position,
        content: content ?? { type: "doc", content: [{ type: "paragraph" }] },
        completeness: content ? ("complete" as const) : ("empty" as const),
      };
    }),
  );
  return { documentId: doc.id, userId: user.id };
}

export async function createExport(
  db: Database,
  input: {
    documentId: string;
    userId: string;
    format: "pdf" | "docx";
    expiresAt?: Date;
    includeAppendix?: boolean;
  },
): Promise<string> {
  const [row] = await db
    .insert(documentExports)
    .values({
      documentId: input.documentId,
      requestedBy: input.userId,
      format: input.format,
      includeAppendix: input.includeAppendix ?? true,
      expiresAt: input.expiresAt ?? new Date(Date.now() + 60_000),
    })
    .returning();
  if (!row) throw new Error("export not created");
  return row.id;
}
