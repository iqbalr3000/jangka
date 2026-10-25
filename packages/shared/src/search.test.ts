import { describe, expect, it } from "vitest";
import { SNIPPET_END as E, SNIPPET_START as S, snippetParts } from "./search";

describe("snippetParts", () => {
  it("splits marked and plain runs, keeping markup as plain text", () => {
    expect(snippetParts(`The ${S}refund${E} window <b>is</b> ${S}14${E} days`)).toEqual([
      { text: "The ", marked: false },
      { text: "refund", marked: true },
      { text: " window <b>is</b> ", marked: false },
      { text: "14", marked: true },
      { text: " days", marked: false },
    ]);
  });

  it("handles text without matches and an unterminated marker", () => {
    expect(snippetParts("plain")).toEqual([{ text: "plain", marked: false }]);
    expect(snippetParts(`${S}open`)).toEqual([{ text: "open", marked: true }]);
    expect(snippetParts("")).toEqual([]);
  });
});
