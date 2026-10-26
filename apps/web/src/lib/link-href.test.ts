import { describe, expect, it } from "vitest";
import { normalizeHref } from "./link-href";

describe("normalizeHref", () => {
  it("keeps http(s) and mailto links", () => {
    expect(normalizeHref("https://acme.co/a?b=1")).toBe("https://acme.co/a?b=1");
    expect(normalizeHref("mailto:ada@acme.co")).toBe("mailto:ada@acme.co");
  });

  it("adds https to a bare domain, port included", () => {
    expect(normalizeHref(" acme.co/docs ")).toBe("https://acme.co/docs");
    expect(normalizeHref("acme.co:8080")).toBe("https://acme.co:8080/");
  });

  it("rejects other schemes and empty input", () => {
    expect(normalizeHref("javascript:alert(1)")).toBeNull();
    expect(normalizeHref("ftp://acme.co")).toBeNull();
    expect(normalizeHref("   ")).toBeNull();
  });
});
