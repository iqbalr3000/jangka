import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@jangka/worker",
    globalSetup: ["test/global-setup.ts"],
    // Integration tests share one (worker-only) database and truncate it between tests.
    fileParallelism: false,
    // Real Chromium renders.
    testTimeout: 60_000,
  },
});
