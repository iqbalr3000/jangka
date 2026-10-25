import type { TemplateDefinition, TemplateSection } from "@jangka/templates";

export type SectionContext = {
  key: string;
  title: string;
  /** Current content as markdown; "" when empty. */
  markdown: string;
};

export type Turn = { role: "user" | "assistant"; content: string };

/** The document this one is generated from; only present when the requester can view it. */
export type SourceContext = {
  docType: "brd" | "prd" | "tsd";
  title: string;
  markdown: string;
  requirements: { code: string; text: string }[];
};

export type DocumentContext = {
  template: TemplateDefinition;
  title: string;
  sections: SectionContext[];
  source?: SourceContext;
};

const NEVER_INVENT =
  "Never invent facts, numbers, names or requirements. Write only what the conversation and the existing document support. If something is unknown, leave it out.";

function sectionList(template: TemplateDefinition): string {
  return template.sections
    .map(
      (s) =>
        `- ${s.title} (key: ${s.key}${s.required ? ", required" : ""}${s.expectsDiagram ? `, diagram: ${s.expectsDiagram}` : ""}): ${s.guidance}`,
    )
    .join("\n");
}

function currentDocument(sections: SectionContext[]): string {
  return sections
    .map((s) => `## ${s.title}\n${s.markdown.trim() ? s.markdown.trim() : "(empty)"}`)
    .join("\n\n");
}

function sourceDocument(source: SourceContext): string {
  const requirements = source.requirements.length
    ? source.requirements.map((r) => `- ${r.code}: ${r.text}`).join("\n")
    : "(none)";
  return [
    `Source ${source.docType.toUpperCase()} "${source.title}" (this document is derived from it; treat it as information the user gave you):\n${source.markdown.trim() || "(empty)"}`,
    `Requirements in the source. These are the only codes you may cite in an Upstream column:\n${requirements}`,
  ].join("\n\n");
}

function base(doc: DocumentContext): string {
  return [
    `You help a product team write a ${doc.template.docType.toUpperCase()} (${doc.template.name}) titled "${doc.title}".`,
    `Template sections:\n${sectionList(doc.template)}`,
    doc.source ? sourceDocument(doc.source) : "",
    `Current document:\n${currentDocument(doc.sections)}`,
    NEVER_INVENT,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function interviewSystem(doc: DocumentContext): string {
  return [
    base(doc),
    [
      "You are interviewing the user to gather what the document needs. Do not draft the document.",
      "Ask at most 3 focused questions per reply, about the sections with the least information first.",
      "Acknowledge briefly what you learned. Keep replies short and plain; no headings.",
    ].join(" "),
  ].join("\n\n");
}

export function coverageSystem(doc: DocumentContext): string {
  return [
    base(doc),
    [
      "Assess, for every template section, how much information the conversation and the current document provide:",
      '"missing" (nothing usable), "partial" (some, with gaps), "covered" (enough to write it well).',
      "For each section give a one-line note on what is still missing (empty string if nothing).",
      "List the most important open questions. readyToDraft is true when every required section is at least partial.",
    ].join(" "),
  ].join("\n\n");
}

function diagramInstruction(section: TemplateSection): string {
  return section.expectsDiagram
    ? `Include one Mermaid ${section.expectsDiagram} diagram in a \`\`\`mermaid fenced block, plus one sentence explaining it.`
    : "Do not include diagrams unless the user asked for one.";
}

const OUTPUT_RULES =
  "Output the section body as markdown only: no section heading, no preamble, no closing remarks. Use ### for sub-headings if needed.";

export function draftSystem(doc: DocumentContext, section: TemplateSection): string {
  return [
    base(doc),
    `Write the "${section.title}" section. Guidance: ${section.guidance}`,
    diagramInstruction(section),
    OUTPUT_RULES,
  ].join("\n\n");
}

export function transcriptMessage(
  transcript: Turn[],
  note: string,
  closing = "Write the section now.",
): string {
  const lines = transcript.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`);
  return [
    lines.length
      ? `Interview transcript:\n${lines.join("\n\n")}`
      : "There is no interview transcript yet.",
    note ? `What is still missing for this section: ${note}` : "",
    closing,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function checkSystem(section: TemplateSection): string {
  return [
    `Judge the completeness of this "${section.title}" section of a product document against its guidance: ${section.guidance}`,
    '"complete" when it fully satisfies the guidance, "partial" when something required is missing.',
    "The note is one short line naming what is missing (empty string when complete).",
  ].join(" ");
}

export function reviseSystem(doc: DocumentContext, section: TemplateSection): string {
  return [
    base(doc),
    `Revise the "${section.title}" section following the user's instruction. Guidance: ${section.guidance}`,
    "Keep everything the instruction doesn't ask to change. Return the full revised section.",
    diagramInstruction(section),
    OUTPUT_RULES,
  ].join("\n\n");
}

export function reviseMessage(current: string, instruction: string): string {
  return `Current section:\n${current.trim() || "(empty)"}\n\nInstruction: ${instruction}`;
}

export function fixDiagramSystem(expectsDiagram?: string): string {
  return [
    `You fix Mermaid diagram syntax${expectsDiagram ? ` (expected type: ${expectsDiagram})` : ""}.`,
    "Return the corrected Mermaid source only, without code fences. Keep the meaning, nodes and labels;",
    "change only what the renderer's error requires.",
  ].join(" ");
}

export function fixDiagramMessage(source: string, error: string): string {
  return `Mermaid source:\n${source}\n\nRenderer error:\n${error}`;
}
