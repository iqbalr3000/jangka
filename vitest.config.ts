import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/shared",
      "packages/permissions",
      "packages/llm",
      "packages/templates",
      "packages/export",
      "packages/db",
      "apps/api",
      "apps/worker",
    ],
  },
});
