import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@jangka/api",
    globalSetup: ["../../packages/db/test/global-setup.ts"],
    // Integration tests share one database and truncate it between tests.
    fileParallelism: false,
  },
});
