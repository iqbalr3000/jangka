import type { TemplateDefinition } from "./index";

const NO_INVENTION =
  "Use only information from the interview and existing sections; if something is unknown, leave it out rather than inventing it.";

export const prdV1: TemplateDefinition = {
  docType: "prd",
  name: "Product Requirements Document",
  version: 1,
  sections: [
    {
      key: "overview",
      title: "Overview",
      required: true,
      guidance: `Two or three sentences: what is being built, for whom, and the scope (markets, platforms, payment methods, etc.). ${NO_INVENTION}`,
      interviewHints: [
        "What are you building, in one sentence?",
        "Who is it for, and where (markets, platforms)?",
      ],
    },
    {
      key: "problem",
      title: "Problem Statement",
      required: true,
      guidance: `Describe the current pain, who feels it, and evidence of its size (tickets, metrics, quotes). No solution here. ${NO_INVENTION}`,
      interviewHints: [
        "What problem does this solve today?",
        "What evidence shows it matters (data, tickets, feedback)?",
      ],
    },
    {
      key: "goals",
      title: "Goals & Success Metrics",
      required: true,
      guidance: `Bullet list of goals. Each goal has a measurable metric with a target and a timeframe; flag any goal missing a target. ${NO_INVENTION}`,
      interviewHints: [
        "What outcomes define success?",
        "Which metric moves, from what baseline to what target, by when?",
      ],
    },
    {
      key: "personas",
      title: "Target Users & Personas",
      required: true,
      guidance: `One short paragraph or bullet per user type: role, context, and what they need from this product. ${NO_INVENTION}`,
      interviewHints: [
        "Who are the primary and secondary users?",
        "What do they need to get done?",
      ],
    },
    {
      key: "user_stories",
      title: "User Stories",
      required: true,
      guidance: `Bullet list in the form "As a <persona>, I can <action> so that <benefit>." Cover the main flows. ${NO_INVENTION}`,
      interviewHints: ["Walk me through what each user does, step by step."],
    },
    {
      key: "functional_requirements",
      title: "Functional Requirements",
      required: true,
      requirementKind: "functional",
      guidance: `Numbered requirements, one behavior each, testable, with acceptance criteria where known. Use IDs FR-001, FR-002, … ${NO_INVENTION}`,
      interviewHints: [
        "What must the system do in each step?",
        "What are the rules, limits and edge cases?",
        "How will you know each behavior works (acceptance criteria)?",
      ],
    },
    {
      key: "non_functional_requirements",
      title: "Non-Functional Requirements",
      required: true,
      requirementKind: "non_functional",
      guidance: `Measurable quality requirements (performance, availability, security, privacy, accessibility, compliance) with numbers. Use IDs NFR-001, … ${NO_INVENTION}`,
      interviewHints: [
        "Any targets for speed, uptime or scale?",
        "Security, privacy or compliance constraints?",
      ],
    },
    {
      key: "user_flow",
      title: "User Flow",
      required: false,
      expectsDiagram: "flowchart",
      guidance: `A Mermaid flowchart of the main flow including decision points, plus one sentence of explanation. ${NO_INVENTION}`,
      interviewHints: ["What are the steps and decision points in the main flow?"],
    },
    {
      key: "out_of_scope",
      title: "Out of Scope",
      required: true,
      guidance: `Bullet list of what this release explicitly does not include, with a short reason where given. ${NO_INVENTION}`,
      interviewHints: ["What is explicitly not part of this release?"],
    },
    {
      key: "assumptions",
      title: "Assumptions & Dependencies",
      required: false,
      guidance: `Bullet lists of assumptions being made and dependencies on other teams, systems or vendors. ${NO_INVENTION}`,
      interviewHints: [
        "What are you assuming to be true?",
        "What other teams or systems does this depend on?",
      ],
    },
    {
      key: "risks",
      title: "Risks & Mitigations",
      required: false,
      guidance: `Table or bullets: risk, impact, mitigation. ${NO_INVENTION}`,
      interviewHints: ["What could go wrong, and how would you handle it?"],
    },
    {
      key: "open_questions",
      title: "Open Questions",
      required: false,
      guidance: `Numbered list of unresolved questions, with an owner if known. Include gaps found during the interview. ${NO_INVENTION}`,
      interviewHints: ["What is still undecided?"],
    },
  ],
};
