import { defineProject } from "vitest/config";

// Not part of `pnpm test`: seeds thousands of rows. Run with `pnpm test:perf`.
export default defineProject({
  test: {
    name: "@jangka/api-perf",
    include: ["perf/**/*.perf.ts"],
    globalSetup: ["../../packages/db/test/global-setup.ts"],
    fileParallelism: false,
  },
});
