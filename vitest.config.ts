import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/shared", "packages/permissions", "packages/db", "apps/api"],
  },
});
