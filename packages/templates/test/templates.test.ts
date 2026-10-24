import { describe, expect, it } from "vitest";
import { builtinTemplates, templateDefinition } from "../src/index";

describe("built-in templates", () => {
  it("are valid definitions", () => {
    for (const template of builtinTemplates) {
      expect(templateDefinition.safeParse(template).success).toBe(true);
    }
  });

  it("have unique (docType, name, version)", () => {
    const ids = builtinTemplates.map((t) => `${t.docType}/${t.name}/${t.version}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("PRD has the 12 SPEC §7 sections in order", () => {
    const prd = builtinTemplates.find((t) => t.docType === "prd");
    expect(prd?.sections.map((s) => s.key)).toEqual([
      "overview",
      "problem",
      "goals",
      "personas",
      "user_stories",
      "functional_requirements",
      "non_functional_requirements",
      "user_flow",
      "out_of_scope",
      "assumptions",
      "risks",
      "open_questions",
    ]);
    expect(prd?.sections.find((s) => s.key === "user_flow")?.expectsDiagram).toBe("flowchart");
  });

  it("rejects duplicate section keys", () => {
    const section = {
      key: "a",
      title: "A",
      required: true,
      guidance: "g",
      interviewHints: [],
    };
    const result = templateDefinition.safeParse({
      docType: "prd",
      name: "x",
      version: 1,
      sections: [section, section],
    });
    expect(result.success).toBe(false);
  });
});
