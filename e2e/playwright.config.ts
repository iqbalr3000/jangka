import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, SERVER_LOG, serverEnv } from "./env";

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  // One server and database per run: later specs build on the instance onboarding sets up.
  projects: [
    {
      name: "onboarding",
      testMatch: "onboarding.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "access",
      testMatch: "access.spec.ts",
      dependencies: ["onboarding"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "document",
      testMatch: "document.spec.ts",
      dependencies: ["onboarding"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "llm",
      testMatch: "llm.spec.ts",
      dependencies: ["onboarding"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Uses the fake provider the llm project sets as the default.
      name: "assistant",
      testMatch: "assistant.spec.ts",
      dependencies: ["llm"],
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Uses the production build (`pnpm build` first); output is kept so tests can read the setup token.
    command: `mkdir -p test-results && tsx reset-db.ts && node ../apps/api/dist/main.js > ${SERVER_LOG} 2>&1`,
    url: `${BASE_URL}/api/v1/health`,
    env: serverEnv(),
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
