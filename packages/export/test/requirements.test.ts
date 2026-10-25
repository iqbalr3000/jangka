import type { BlockNode, DocNode, TableRowNode } from "@jangka/shared/document";
import { describe, expect, it } from "vitest";
import { extractRequirements } from "../src/index";

const p = (text: string): BlockNode => ({ type: "paragraph", content: [{ type: "text", text }] });

function row(cells: string[], header = false): TableRowNode {
  return {
    type: "tableRow",
    content: cells.map((text) => ({
      type: header ? "tableHeader" : "tableCell",
      content: [p(text)],
    })),
  };
}

const table = (...rows: TableRowNode[]): BlockNode => ({ type: "table", content: rows });
const doc = (...content: BlockNode[]): DocNode => ({ type: "doc", content });

describe("extractRequirements", () => {
  it("reads the requirement table", () => {
    const out = extractRequirements(
      doc(
        table(
          row(["ID", "Requirement", "Priority", "Upstream"], true),
          row(["FR-001", "Customer requests a refund", "Must", "BR-001, BR-003"]),
          row(["FR-002", "Agent approves it", "s", ""]),
        ),
      ),
      "functional",
    );
    expect(out).toEqual([
      {
        code: "FR-001",
        text: "Customer requests a refund",
        priority: "must",
        upstreamCodes: ["BR-001", "BR-003"],
      },
      { code: "FR-002", text: "Agent approves it", priority: "should", upstreamCodes: [] },
    ]);
  });

  it("accepts header aliases and any column order", () => {
    const out = extractRequirements(
      doc(
        table(
          row(["Implements", "id", "Description"], true),
          row(["FR-002 and NFR-001, FR-002", "TR-001", "Queue refunds"]),
        ),
      ),
      "technical",
    );
    expect(out).toEqual([
      {
        code: "TR-001",
        text: "Queue refunds",
        priority: null,
        upstreamCodes: ["FR-002", "NFR-001"],
      },
    ]);
  });

  it("ignores tables without an ID column, wrong prefixes and duplicates", () => {
    const out = extractRequirements(
      doc(
        table(row(["Risk", "Impact"], true), row(["FR-009", "x"])),
        table(
          row(["ID", "Requirement"], true),
          row(["BR-001", "Wrong section"]),
          row(["FR-1", "Too short"]),
          row(["FR-001", "First"]),
          row(["FR-001", "Duplicate"]),
          row(["", "No id"]),
        ),
      ),
      "functional",
    );
    expect(out.map((r) => [r.code, r.text])).toEqual([["FR-001", "First"]]);
  });

  it("reads the legacy list format", () => {
    const out = extractRequirements(
      doc(
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [p("FR-001: Request a refund")] },
            { type: "listItem", content: [p("FR-002 — Track its status")] },
            { type: "listItem", content: [p("Not a requirement")] },
          ],
        },
        p("FR-003 Notify by email"),
        p("NFR-001: wrong kind"),
      ),
      "functional",
    );
    expect(out.map((r) => [r.code, r.text])).toEqual([
      ["FR-001", "Request a refund"],
      ["FR-002", "Track its status"],
      ["FR-003", "Notify by email"],
    ]);
  });

  it("keeps NFR and FR apart", () => {
    const content = doc(p("NFR-001: p95 under 300 ms"), p("FR-001: Refund"));
    expect(extractRequirements(content, "non_functional").map((r) => r.code)).toEqual(["NFR-001"]);
    expect(extractRequirements(content, "functional").map((r) => r.code)).toEqual(["FR-001"]);
  });
});
