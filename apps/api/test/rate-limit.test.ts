import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/lib/rate-limit";

describe("RateLimiter", () => {
  it("makes room by dropping expired windows before live ones", () => {
    const limiter = new RateLimiter(2, 1_000, 3);
    limiter.record("victim", 0);
    limiter.record("victim", 0);
    limiter.record("old-1", 0);
    limiter.record("old-2", 0);
    // The old windows expired at 1000; the victim's was refreshed and is still live.
    limiter.record("victim", 1_500);
    limiter.record("victim", 1_500);
    limiter.record("new-1", 1_600);
    limiter.record("new-2", 1_600);
    expect(limiter.isLimited("victim", 1_700)).toBe(true);
  });

  it("evicts the oldest live window only when every window is live", () => {
    const limiter = new RateLimiter(1, 10_000, 2);
    limiter.record("a", 0);
    limiter.record("b", 1);
    limiter.record("c", 2);
    expect(limiter.isLimited("a", 3)).toBe(false);
    expect(limiter.isLimited("b", 3)).toBe(true);
    expect(limiter.isLimited("c", 3)).toBe(true);
  });
});
