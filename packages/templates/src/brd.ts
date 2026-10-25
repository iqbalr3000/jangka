import type { TemplateDefinition } from "./index";
import { NO_INVENTION, requirementTableGuidance } from "./requirements";

export const brdV1: TemplateDefinition = {
  docType: "brd",
  name: "Business Requirements Document",
  version: 1,
  sections: [
    {
      key: "executive_summary",
      title: "Executive Summary",
      required: true,
      guidance: `Three to five sentences: the business problem, the proposed solution and the expected value. ${NO_INVENTION}`,
      interviewHints: ["In two sentences, what does the business need and why now?"],
    },
    {
      key: "business_problem",
      title: "Business Problem",
      required: true,
      guidance: `The problem or opportunity, who is affected, and its business impact with evidence (cost, revenue, risk). ${NO_INVENTION}`,
      interviewHints: [
        "What problem or opportunity is this about?",
        "What does it cost the business today, and how do you know?",
      ],
    },
    {
      key: "business_objectives",
      title: "Business Objectives",
      required: true,
      guidance: `Bullet list of objectives, each measurable with a target and a timeframe. ${NO_INVENTION}`,
      interviewHints: ["What outcomes does the business expect, by when, measured how?"],
    },
    {
      key: "stakeholders",
      title: "Stakeholders",
      required: true,
      guidance: `Table or bullets: stakeholder, role, interest or responsibility. ${NO_INVENTION}`,
      interviewHints: ["Who sponsors this, who is affected, who decides?"],
    },
    {
      key: "current_state",
      title: "Current State (AS-IS)",
      required: true,
      guidance: `How the process works today, its steps and its pain points. ${NO_INVENTION}`,
      interviewHints: ["How is this handled today, step by step?", "Where does it break down?"],
    },
    {
      key: "proposed_solution",
      title: "Proposed Solution (TO-BE)",
      required: true,
      expectsDiagram: "flowchart",
      guidance: `The future process at business level (not technical design), with a Mermaid flowchart of the TO-BE flow. ${NO_INVENTION}`,
      interviewHints: ["How should the process work once this is done?"],
    },
    {
      key: "business_requirements",
      title: "Business Requirements",
      required: true,
      requirementKind: "business",
      guidance: requirementTableGuidance(
        "business",
        "What the business needs from the solution, each a single verifiable need stated without technical design.",
        null,
      ),
      interviewHints: [
        "What must the solution enable the business to do?",
        "Which needs are must-haves versus nice-to-haves?",
      ],
    },
    {
      key: "scope",
      title: "Scope / Out of Scope",
      required: true,
      guidance: `Two bullet lists: in scope and explicitly out of scope, with short reasons where given. ${NO_INVENTION}`,
      interviewHints: ["What is in scope for this initiative, and what is explicitly not?"],
    },
    {
      key: "constraints",
      title: "Constraints",
      required: false,
      guidance: `Budget, timeline, regulatory, contractual or organizational constraints. ${NO_INVENTION}`,
      interviewHints: ["Any budget, deadline, regulatory or policy constraints?"],
    },
    {
      key: "assumptions",
      title: "Assumptions",
      required: false,
      guidance: `Bullet list of assumptions the plan depends on. ${NO_INVENTION}`,
      interviewHints: ["What are you assuming to be true?"],
    },
    {
      key: "risks",
      title: "Risks",
      required: false,
      guidance: `Table or bullets: risk, impact, mitigation. ${NO_INVENTION}`,
      interviewHints: ["What could prevent the business from getting the expected value?"],
    },
    {
      key: "success_criteria",
      title: "Success Criteria",
      required: true,
      guidance: `How the business will judge success after launch: criteria with measures and targets. ${NO_INVENTION}`,
      interviewHints: ["How will you know, after launch, that this worked?"],
    },
    {
      key: "cost_benefit",
      title: "Cost/Benefit",
      required: false,
      guidance: `Expected costs and benefits with figures where given; omit what is unknown. ${NO_INVENTION}`,
      interviewHints: ["Do you have estimates of cost and expected benefit?"],
    },
  ],
};
