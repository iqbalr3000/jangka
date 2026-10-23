type Window = { count: number; resetAt: number };

/** In-memory fixed-window failure counter. Per process; fine for a single-instance app. */
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

  recordFailure(key: string, now = Date.now()): void {
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
