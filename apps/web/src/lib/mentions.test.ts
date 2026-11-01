import { describe, expect, it } from "vitest";
import { mentionAt } from "./mentions";

describe("mentionAt", () => {
  it("finds the @query ending at the caret", () => {
    expect(mentionAt("Hi @ri", 6)).toEqual({ from: 3, query: "ri" });
    expect(mentionAt("@", 1)).toEqual({ from: 0, query: "" });
    expect(mentionAt("line\n@budi more", 10)).toEqual({ from: 5, query: "budi" });
  });

  it("ignores emails, finished words and tokens", () => {
    expect(mentionAt("mail ada@acme", 13)).toBeNull();
    expect(mentionAt("Hi @rina ", 9)).toBeNull();
    expect(mentionAt("@[Rina](user:1", 14)).toBeNull();
  });
});
