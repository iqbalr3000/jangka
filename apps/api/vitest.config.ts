import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@jangka/api",
    globalSetup: ["../../packages/db/test/global-setup.ts"],
  },
});
