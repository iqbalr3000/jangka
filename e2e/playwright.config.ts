import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, SERVER_LOG, serverEnv } from "./env";

export default defineConfig({
  testDir: "tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Uses the production build (`pnpm build` first); output is kept so tests can read the setup token.
    command: `mkdir -p test-results && tsx reset-db.ts && node ../apps/api/dist/main.js > ${SERVER_LOG} 2>&1`,
    url: `${BASE_URL}/api/v1/health`,
    env: serverEnv(),
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
