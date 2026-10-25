import { builtinTemplates } from "@jangka/templates";
import { describe, expect, it } from "vitest";
import { sampleFromSchema } from "../src/adapters/fake";
import { createProvider, fakeResponses, type LLMProvider } from "../src/index";
import {
  assessCoverage,
  checkSection,
  coverageSchema,
  type DocumentContext,
  draftSection,
  fitBudget,
  fixDiagram,
  interview,
  toTurns,
} from "../src/pipelines/index";
import { jsonSchemaOf } from "../src/structured";
import { collect } from "../src/testing";

const template = builtinTemplates[0];
if (!template) throw new Error("PRD template missing");

const doc: DocumentContext = {
  template,
  title: "Refunds",
  sections: template.sections.map((s) => ({ key: s.key, title: s.title, markdown: "" })),
};
const fake = createProvider({ kind: "fake", apiKey: "" });

/** Records the requests a pipeline makes, answering like the fake. */
function recording(): { provider: LLMProvider; system: string[]; messages: string[] } {
  const system: string[] = [];
  const messages: string[] = [];
  return {
    system,
    messages,
    provider: {
      ...fake,
      streamText(req, signal) {
        system.push(req.system ?? "");
        messages.push(req.messages.map((m) => `${m.role}:${m.content}`).join("|"));
        return fake.streamText(req, signal);
      },
      generateObject(req, schema, signal) {
        system.push(req.system ?? "");
        messages.push(req.messages.map((m) => `${m.role}:${m.content}`).join("|"));
        return fake.generateObject(req, schema, signal);
      },
    },
  };
}

describe("coverage", () => {
  it("builds the schema from template keys and normalizes the result", async () => {
    const keys = Object.keys(
      (jsonSchemaOf(coverageSchema(template)).properties as { coverage: { properties: object } })
        .coverage.properties,
    );
    expect(keys).toEqual(template.sections.map((s) => s.key));

    fakeResponses({
      coverage: Object.fromEntries(template.sections.map((s) => [s.key, "missing"])),
      notes: Object.fromEntries(template.sections.map((s) => [s.key, ""])),
      openQuestions: ["Who requests refunds?"],
      readyToDraft: true,
    });
    const state = await assessCoverage(
      { provider: fake, model: "fake-small" },
      { doc, transcript: [] },
    );
    expect(state.sections).toHaveLength(12);
    expect(state.sections[0]).toEqual({ key: "overview", coverage: "missing", note: "" });
    // Recomputed from the template, not trusted from the model.
    expect(state.readyToDraft).toBe(false);
  });

  it("the fake's schema sample reads as fully covered", async () => {
    const state = await assessCoverage(
      { provider: fake, model: "fake-small" },
      { doc, transcript: [] },
    );
    expect(state.sections.every((s) => s.coverage === "covered")).toBe(true);
    expect(state.readyToDraft).toBe(true);
    expect(sampleFromSchema({ type: "array", items: { type: "string" } })).toEqual(["Fake"]);
  });
});

describe("prompts", () => {
  it("interview asks for at most 3 questions and forbids drafting and invention", async () => {
    const rec = recording();
    await collect(
      interview(
        { provider: rec.provider, model: "m" },
        { doc, transcript: [{ role: "user", content: "Refunds are slow" }] },
      ),
    );
    expect(rec.system[0]).toContain("at most 3 focused questions");
    expect(rec.system[0]).toContain("Do not draft");
    expect(rec.system[0]).toContain("Never invent");
  });

  it("draft includes the section guidance, the diagram rule and the transcript", async () => {
    const rec = recording();
    const section = template.sections.find((s) => s.key === "user_flow");
    if (!section) throw new Error("user_flow missing");
    const events = await collect(
      draftSection(
        { provider: rec.provider, model: "m" },
        {
          doc,
          transcript: [{ role: "user", content: "Customers tap Refund" }],
          section,
          note: "no decision points",
        },
      ),
    );
    expect(events.at(-1)?.type).toBe("done");
    expect(rec.system[0]).toContain(section.guidance);
    expect(rec.system[0]).toContain("```mermaid");
    expect(rec.messages[0]).toContain("Customers tap Refund");
    expect(rec.messages[0]).toContain("no decision points");
  });

  it("checkSection returns a validated completeness", async () => {
    const section = template.sections[0];
    if (!section) throw new Error("section missing");
    await expect(
      checkSection({ provider: fake, model: "m" }, { section, markdown: "Text" }),
    ).resolves.toEqual({ completeness: "complete", note: "Fake" });
  });
});

describe("toTurns", () => {
  it("merges consecutive roles and starts with the user", () => {
    expect(
      toTurns([
        { role: "assistant", content: "Drafted 3 sections." },
        { role: "user", content: "a" },
        { role: "user", content: "b" },
        { role: "assistant", content: "c" },
        { role: "assistant", content: " " },
      ]),
    ).toEqual([
      { role: "user", content: "a\n\nb" },
      { role: "assistant", content: "c" },
    ]);
  });
});

describe("fitBudget", () => {
  const turn = (i: number) => ({
    role: i % 2 ? ("assistant" as const) : ("user" as const),
    content: `${i} ${"x".repeat(4000)}`,
  });

  it("keeps everything when it fits", () => {
    const transcript = [turn(0), turn(1)];
    expect(fitBudget({ doc, transcript }).transcript).toEqual(transcript);
  });

  it("drops the oldest turns but keeps the first message", () => {
    const transcript = Array.from({ length: 10 }, (_, i) => turn(i));
    const fitted = fitBudget({ doc, transcript }, 10_000);
    expect(fitted.transcript[0]).toEqual(transcript[0]);
    expect(fitted.transcript.at(-1)).toEqual(transcript.at(-1));
    expect(fitted.transcript.length).toBeLessThan(10);
  });

  it("clips sections other than the focus when turns alone aren't enough", () => {
    const big = {
      ...doc,
      sections: doc.sections.map((s) => ({ ...s, markdown: "y".repeat(20_000) })),
    };
    const fitted = fitBudget({ doc: big, transcript: [turn(0)], focusKey: "goals" }, 20_000);
    expect(fitted.doc.sections.find((s) => s.key === "goals")?.markdown).toHaveLength(20_000);
    expect(fitted.doc.sections.find((s) => s.key === "overview")?.markdown).toContain(
      "(truncated)",
    );
  });
});

describe("fixDiagram", () => {
  it("sends the source and the renderer error, and strips a code fence", async () => {
    const rec = recording();
    fakeResponses({ source: "```mermaid\nflowchart TD\n  A --> B\n```" });
    const fixed = await fixDiagram(
      { provider: rec.provider, model: "fake-small" },
      {
        source: "flowchart TD\n  A -->",
        error: "Parse error on line 2",
        expectsDiagram: "flowchart",
      },
    );
    expect(fixed).toBe("flowchart TD\n  A --> B");
    expect(rec.system[0]).toContain("expected type: flowchart");
    expect(rec.messages[0]).toContain("Parse error on line 2");
  });

  it("retries when the output is invalid, then gives up", async () => {
    fakeResponses({ source: "" }, { source: "" }, { source: "" });
    await expect(
      fixDiagram({ provider: fake, model: "fake-small" }, { source: "x", error: "bad" }),
    ).rejects.toMatchObject({ code: "invalid_output" });
  });
});
