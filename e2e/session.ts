import { type Browser, expect } from "@playwright/test";

// Accounts created by onboarding.spec.ts; later projects depend on it.
export const ADMIN = { email: "ada@acme.co", password: "admin-password-123" };
export const MEMBER = { email: "rina@acme.co", password: "rina-password-123" };

/** Signs in through the login page in a fresh browser context. */
export async function signIn(browser: Browser, account: { email: string; password: string }) {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  return page;
}
