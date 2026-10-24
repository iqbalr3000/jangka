import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { SERVER_LOG } from "../env";

const ADMIN = { name: "Ada Admin", email: "ada@acme.co", password: "admin-password-123" };
const MEMBER = { name: "Rina", email: "rina@acme.co", password: "rina-password-123" };

async function setupToken(): Promise<string> {
  const log = await readFile(SERVER_LOG, "utf8");
  const token = /SETUP TOKEN: (\S+)/.exec(log)?.[1];
  if (!token) throw new Error("setup token not found in server output");
  return token;
}

async function openAccountMenu(page: Page) {
  await page.getByRole("button", { name: "Account menu" }).click();
}

test("setup, sign out and in, invite a member", async ({ page, browser }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);

  await page.getByLabel("Setup token").fill(await setupToken());
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Organization name").fill("Acme");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Name").fill(ADMIN.name);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN.password);
  await page.getByLabel("Confirm password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByRole("heading", { name: "Connect an LLM" })).toBeVisible();
  await page.getByRole("button", { name: "Skip for now" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("navigation", { name: "Main" })).toContainText("Acme");

  await openAccountMenu(page);
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);

  await openAccountMenu(page);
  await page.getByRole("menuitem", { name: "Admin panel" }).click();
  await expect(page.getByRole("heading", { name: "Users & invites" })).toBeVisible();

  await page.getByRole("button", { name: "Invite user" }).click();
  await page.getByLabel("Email").fill(MEMBER.email);
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.getByTitle(/\/invite\//).getAttribute("title");
  expect(link).toBeTruthy();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("region", { name: "Pending invites" })).toContainText(MEMBER.email);

  const member = await (await browser.newContext()).newPage();
  await member.goto(link ?? "");
  await expect(member.getByRole("heading", { name: "Join Acme" })).toBeVisible();
  await member.getByLabel("Name").fill(MEMBER.name);
  await member.getByLabel("Password", { exact: true }).fill(MEMBER.password);
  await member.getByLabel("Confirm password").fill(MEMBER.password);
  await member.getByRole("button", { name: "Create account" }).click();
  await expect(member).toHaveURL(/\/$/);

  await openAccountMenu(member);
  await expect(member.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  await expect(member.getByRole("menuitem", { name: "Admin panel" })).toHaveCount(0);

  await member.goto(link ?? "");
  await expect(member.getByRole("heading", { name: "Link expired" })).toBeVisible();
});
