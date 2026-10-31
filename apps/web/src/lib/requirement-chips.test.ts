import type { TraceResponse } from "@jangka/shared/trace";
import { describe, expect, it } from "vitest";
import { chipIndex, findCodes, focusOf } from "./requirement-chips";

const trace: TraceResponse = {
  upstream: { id: "brd-1", title: "Refund BRD", docType: "brd" },
  downstream: [],
  needsReviewCount: 1,
  requirements: [
    {
      code: "FR-001",
      kind: "functional",
      text: "Request a refund in the app",
      priority: "must",
      sectionKey: "functional_requirements",
      upstream: [
        { code: "BR-001", status: "linked", text: "Self-service refunds", documentId: "brd-1" },
        { code: "BR-009", status: "missing" },
      ],
      needsReview: true,
      downstream: [],
    },
    {
      code: "FR-002",
      kind: "functional",
      text: "Agents review the rest",
      priority: null,
      sectionKey: "functional_requirements",
      upstream: [
        { code: "BR-001", status: "linked", text: "Self-service refunds", documentId: "brd-1" },
        { code: "BR-005", status: "restricted" },
      ],
      needsReview: false,
      downstream: [],
    },
  ],
};

describe("findCodes", () => {
  it("finds every requirement code with its offsets", () => {
    expect(findCodes("FR-001 cites BR-002, NFR-0004 and TR-010.")).toEqual([
      { code: "FR-001", from: 0, to: 6 },
      { code: "BR-002", from: 13, to: 19 },
      { code: "NFR-0004", from: 21, to: 29 },
      { code: "TR-010", from: 34, to: 40 },
    ]);
  });

  it("ignores partial and malformed codes", () => {
    expect(findCodes("XFR-001 FR-01 FR-001x fr-001 BR_001")).toEqual([]);
  });
});

describe("chipIndex", () => {
  const index = chipIndex(trace);

  it("knows own requirements, with needs review and their upstream codes", () => {
    expect(index.get("FR-001")).toMatchObject({
      kind: "own",
      priority: "must",
      needsReview: true,
      upstream: ["BR-001", "BR-009"],
    });
  });

  it("resolves cited codes as linked, restricted or missing, focused on the first citing requirement", () => {
    expect(index.get("BR-001")).toEqual({
      kind: "upstream",
      code: "BR-001",
      text: "Self-service refunds",
      source: "Refund BRD",
      focus: "FR-001",
    });
    expect(index.get("BR-005")).toEqual({ kind: "restricted", code: "BR-005", focus: "FR-002" });
    expect(index.get("BR-009")).toEqual({ kind: "missing", code: "BR-009", focus: "FR-001" });
  });

  it("leaves unknown codes out and maps each chip to the row to focus", () => {
    expect(index.has("FR-999")).toBe(false);
    const own = index.get("FR-002");
    const upstream = index.get("BR-005");
    if (!own || !upstream) throw new Error("chips missing");
    expect([focusOf(own), focusOf(upstream)]).toEqual(["FR-002", "FR-002"]);
  });

  it("is empty without trace data", () => {
    expect(chipIndex(undefined).size).toBe(0);
  });
});
