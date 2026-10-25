import { AppError } from "@jangka/shared/errors";

type Window = { count: number; resetAt: number };

/** In-memory fixed-window counter (failed logins, LLM requests). Per process; fine for a single-instance app. */
export class RateLimiter {
  private readonly hits = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  isLimited(key: string, now = Date.now()): boolean {
    const window = this.hits.get(key);
    return window !== undefined && window.resetAt > now && window.count >= this.limit;
  }

  record(key: string, now = Date.now()): void {
    let window = this.hits.get(key);
    if (!window || window.resetAt <= now) {
      this.hits.delete(key);
      if (this.hits.size >= this.maxKeys) {
        const oldest = this.hits.keys().next().value;
        if (oldest !== undefined) this.hits.delete(oldest);
      }
      window = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, window);
    }
    window.count += 1;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

/** Counts one LLM request for the user, or refuses with `429 rate_limited` once over the cap. */
export function requireLlmQuota(limiter: RateLimiter, userId: string): void {
  if (limiter.isLimited(userId)) {
    throw new AppError(
      "rate_limited",
      429,
      "You've reached the assistant limit for now. Try again in a few minutes.",
    );
  }
  limiter.record(userId);
}
