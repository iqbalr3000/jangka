import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { sectionErrors } from "./template-errors";

vi.mock("./connection", () => ({ reportRequest: () => {} }));

const invalid = (details: unknown) =>
  new ApiError("invalid_template", 400, "Fix the highlighted sections", details);

describe("sectionErrors", () => {
  it("maps section issues to their card and field, merging a card's issues", () => {
    const errors = sectionErrors(
      invalid([
        { path: ["sections", 2, "guidance"], message: "Write guidance for the assistant" },
        { path: ["sections", 2, "requirementKind"], message: "Only one FR section" },
        { path: ["sections", 0, "title"], message: "Add a title" },
      ]),
    );
    expect(errors).toEqual({
      0: { title: "Add a title" },
      2: { guidance: "Write guidance for the assistant", requirementKind: "Only one FR section" },
    });
  });

  it("puts a section-level issue without a field on the title", () => {
    expect(sectionErrors(invalid([{ path: ["sections", 1], message: "Duplicate key" }]))).toEqual({
      1: { title: "Duplicate key" },
    });
  });

  it("leaves template-level issues to the banner", () => {
    expect(
      sectionErrors(invalid([{ path: ["sections"], message: "Add at least one section" }])),
    ).toEqual({});
    expect(sectionErrors(invalid([{ path: ["name"], message: "Pick another name" }]))).toEqual({});
  });

  it("ignores other errors and unexpected details", () => {
    expect(sectionErrors(new Error("offline"))).toEqual({});
    expect(sectionErrors(invalid({ unexpected: true }))).toEqual({});
  });
});
