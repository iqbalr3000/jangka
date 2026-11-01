import { describe, expect, it } from "vitest";
import { coverageItems } from "./coverage";

describe("coverageItems", () => {
  const sections = [
    { key: "overview", completeness: "complete" as const },
    { key: "goals", completeness: "partial" as const },
    { key: "risks", completeness: "empty" as const },
  ];

  it("reads the sections' content before any chat", () => {
    expect(coverageItems(null, sections).map((s) => s.coverage)).toEqual([
      "covered",
      "partial",
      "missing",
    ]);
  });

  it("uses the interview's assessment once there is one", () => {
    const state = {
      sections: [{ key: "overview", coverage: "missing" as const, note: "Ask about scope" }],
      openQuestions: [],
      readyToDraft: false,
      suggestions: [],
    };
    expect(coverageItems(state, sections)).toBe(state.sections);
  });
});
