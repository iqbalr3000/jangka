import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./auth";

describe("safeRedirectPath", () => {
  it("keeps same-app paths with query and hash", () => {
    expect(safeRedirectPath("/d/123?comments=goals#top")).toBe("/d/123?comments=goals#top");
    expect(safeRedirectPath("/")).toBe("/");
  });

  it("refuses anything that can leave the app", () => {
    for (const value of [
      undefined,
      null,
      "",
      "https://evil.com",
      "evil.com",
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/%09/evil.com".replace("%09", "\t"),
      "javascript:alert(1)",
    ]) {
      expect(safeRedirectPath(value)).toBe("/");
    }
  });
});
