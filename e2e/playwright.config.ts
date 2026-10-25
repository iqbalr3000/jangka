import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, IDP_ISSUER, SERVER_LOG, serverEnv } from "./env";

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
      // Needs the fake provider (llm) and the Platform collection members can view (access).
      name: "traceability",
      testMatch: "traceability.spec.ts",
      dependencies: ["llm", "access"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Uses the fake provider (llm) for an accepted AI revision.
      name: "history",
      testMatch: "history.spec.ts",
      dependencies: ["llm"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "impact",
      testMatch: "impact.spec.ts",
      dependencies: ["traceability"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Needs the Platform collection the member can view (access).
      name: "review",
      testMatch: "review.spec.ts",
      dependencies: ["access"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "templates",
      testMatch: "templates.spec.ts",
      dependencies: ["onboarding"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "sso",
      testMatch: "sso.spec.ts",
      dependencies: ["onboarding"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Runs the built app with the default APP_ROLE=all, so the worker renders in-process.
      name: "export",
      testMatch: "export.spec.ts",
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
  webServer: [
    {
      // Uses the production build (`pnpm build` first); output is kept so tests can read the setup token.
      command: `mkdir -p test-results && tsx reset-db.ts && node ../apps/api/dist/main.js > ${SERVER_LOG} 2>&1`,
      url: `${BASE_URL}/api/v1/health`,
      env: serverEnv(),
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Stub OpenID provider for the SSO spec.
      command: "tsx oidc-idp.ts",
      url: `${IDP_ISSUER}/.well-known/openid-configuration`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
