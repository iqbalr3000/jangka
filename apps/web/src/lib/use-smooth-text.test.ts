import { describe, expect, it } from "vitest";
import { revealStep } from "./use-smooth-text";

describe("revealStep", () => {
  it("reveals nothing when caught up", () => {
    expect(revealStep(0)).toBe(0);
  });

  it("types a trickle at least two characters a frame, never past the text", () => {
    expect(revealStep(1)).toBe(1);
    expect(revealStep(5)).toBe(2);
  });

  it("drains a big burst within a second", () => {
    let backlog = 1200;
    let frames = 0;
    while (backlog > 0) {
      backlog -= revealStep(backlog);
      frames++;
    }
    expect(frames).toBeLessThan(60);
    expect(revealStep(1200)).toBe(100);
  });
});
