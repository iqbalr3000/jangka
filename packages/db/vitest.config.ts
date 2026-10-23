import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@jangka/db",
    globalSetup: ["./test/global-setup.ts"],
  },
});
