import { describe, expect, it } from "vitest";
import {
  builtinTemplates,
  REQUIREMENT_PREFIX,
  type TemplateDefinition,
  templateDefinition,
} from "../src/index";

const latest = (docType: TemplateDefinition["docType"]) =>
  builtinTemplates.filter((t) => t.docType === docType).sort((a, b) => b.version - a.version)[0];

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

  it("PRD v2 keeps v1's sections and switches requirement sections to the table", () => {
    const v1 = builtinTemplates.find((t) => t.docType === "prd" && t.version === 1);
    const v2 = latest("prd");
    expect(v2?.version).toBe(2);
    expect(v2?.sections.map((s) => s.key)).toEqual(v1?.sections.map((s) => s.key));
    expect(v2?.sections.find((s) => s.key === "functional_requirements")?.guidance).toContain(
      "ID | Requirement | Priority | Upstream",
    );
    expect(v2?.sections.find((s) => s.key === "overview")).toEqual(
      v1?.sections.find((s) => s.key === "overview"),
    );
  });

  it("BRD and TSD follow SPEC §7, with one requirement section each", () => {
    const brd = latest("brd");
    const tsd = latest("tsd");
    expect(brd?.sections).toHaveLength(13);
    expect(tsd?.sections.map((s) => s.key)).toContain("technical_requirements");
    expect(brd?.sections.filter((s) => s.requirementKind).map((s) => s.requirementKind)).toEqual([
      "business",
    ]);
    expect(tsd?.sections.filter((s) => s.requirementKind).map((s) => s.requirementKind)).toEqual([
      "technical",
    ]);
    expect(tsd?.sections.find((s) => s.key === "data_model")?.expectsDiagram).toBe("erd");
  });

  it("requirement sections ask for the indexed table with their prefix", () => {
    for (const template of builtinTemplates.filter((t) => t.docType !== "prd" || t.version > 1)) {
      for (const section of template.sections.filter((s) => s.requirementKind)) {
        const kind = section.requirementKind;
        if (!kind) continue;
        expect(section.guidance).toContain("ID | Requirement | Priority");
        expect(section.guidance).toContain(`${REQUIREMENT_PREFIX[kind]}-001`);
        expect(section.guidance.includes("Upstream")).toBe(template.docType !== "brd");
      }
    }
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
