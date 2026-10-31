import { describe, expect, it } from "vitest";
import {
  builtinTemplates,
  customTemplateDefinition,
  latestBuiltinTemplate,
  REQUIREMENT_PREFIX,
  sampleDocuments,
  sectionKeyFor,
  type TemplateDefinition,
  templateDefinition,
  templateDraftDefinition,
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

describe("draft definitions", () => {
  const empty = { docType: "tsd", name: "x", version: 1, sections: [] };
  const section = { key: "a", title: "A", required: true, guidance: "g", interviewHints: [] };

  it("allow a draft with no sections, but not a published definition", () => {
    expect(templateDraftDefinition.safeParse(empty).success).toBe(true);
    expect(templateDefinition.safeParse(empty).success).toBe(false);
  });

  it("still reject duplicate keys in a draft", () => {
    const result = templateDraftDefinition.safeParse({ ...empty, sections: [section, section] });
    expect(result.success).toBe(false);
  });
});

describe("custom templates", () => {
  const base = builtinTemplates.find((t) => t.docType === "prd" && t.version === 2);
  if (!base) throw new Error("PRD v2 missing");
  const issues = (template: unknown) => {
    const result = customTemplateDefinition.safeParse(template);
    return result.success ? [] : result.error.issues.map((i) => [i.path.join("."), i.message]);
  };

  it("accepts every built-in", () => {
    for (const template of builtinTemplates) expect(issues(template)).toEqual([]);
  });

  it("allows one section per requirement kind, of the kinds the type supports", () => {
    const fr = base.sections.findIndex((s) => s.key === "functional_requirements");
    const twice = {
      ...base,
      sections: [...base.sections, { ...base.sections[fr], key: "more_frs" }],
    };
    expect(issues(twice)).toEqual([
      [`sections.${base.sections.length}.requirementKind`, "Only one section per requirement kind"],
    ]);
    const wrongKind = {
      ...base,
      sections: base.sections.map((s, i) =>
        i === fr ? { ...s, requirementKind: "business" as const } : s,
      ),
    };
    expect(issues(wrongKind)).toEqual([
      [`sections.${fr}.requirementKind`, "A PRD can't have business requirements"],
    ]);
  });

  it("rejects an empty template and duplicate keys", () => {
    expect(issues({ ...base, sections: [] })).not.toEqual([]);
    expect(issues({ ...base, sections: [base.sections[0], base.sections[0]] })).not.toEqual([]);
  });

  it("derives stable, unique keys from titles", () => {
    expect(sectionKeyFor("Risks & Mitigations", [])).toBe("risks_mitigations");
    expect(sectionKeyFor("Risks & Mitigations", ["risks_mitigations"])).toBe("risks_mitigations_2");
    expect(sectionKeyFor("Résumé 2026", [])).toBe("resume_2026");
    expect(sectionKeyFor("2026 plan", [])).toBe("s_2026_plan");
    expect(sectionKeyFor("!!!", [])).toBe("section");
    expect(/^[a-z][a-z0-9_]*$/.test(sectionKeyFor("2026 plan", []))).toBe(true);
  });
});

describe("sample documents", () => {
  const codes = (markdown: string, prefix: string) =>
    [...markdown.matchAll(new RegExp(`\\b${prefix}-\\d{3}\\b`, "g"))].map((m) => m[0]);

  it("fill every section of the latest built-in template, and nothing else", () => {
    for (const sample of sampleDocuments) {
      const template = latestBuiltinTemplate(sample.docType);
      expect(Object.keys(sample.sections).sort()).toEqual(
        template.sections.map((s) => s.key).sort(),
      );
      for (const [key, markdown] of Object.entries(sample.sections)) {
        expect(markdown.trim(), `${sample.docType}.${key}`).not.toBe("");
      }
    }
  });

  it("write requirement sections as ID tables, and diagrams where the template expects one", () => {
    for (const sample of sampleDocuments) {
      for (const section of latestBuiltinTemplate(sample.docType).sections) {
        const markdown = sample.sections[section.key] ?? "";
        if (section.requirementKind) expect(markdown).toMatch(/^\| ID \| Requirement \| Priority/);
        if (section.expectsDiagram) expect(markdown).toContain("```mermaid");
      }
    }
  });

  it("cite only requirements that exist upstream (BRD → PRD → TSD)", () => {
    const [brd, prd, tsd] = sampleDocuments;
    if (!brd || !prd || !tsd) throw new Error("samples missing");
    const business = new Set(codes(brd.sections.business_requirements ?? "", "BR"));
    const product = new Set([
      ...codes(prd.sections.functional_requirements ?? "", "FR"),
      ...codes(prd.sections.non_functional_requirements ?? "", "NFR"),
    ]);
    const prdCites = codes(
      `${prd.sections.functional_requirements}${prd.sections.non_functional_requirements}`,
      "BR",
    );
    const tsdCites = [
      ...codes(tsd.sections.technical_requirements ?? "", "FR"),
      ...codes(tsd.sections.technical_requirements ?? "", "NFR"),
    ];
    expect(prdCites.length).toBeGreaterThan(0);
    expect(prdCites.every((c) => business.has(c))).toBe(true);
    expect(tsdCites.length).toBeGreaterThan(0);
    expect(tsdCites.every((c) => product.has(c))).toBe(true);
  });
});
