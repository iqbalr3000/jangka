import { expect, test } from "@playwright/test";
import { ADMIN, signIn } from "../session";

test("an admin connects a provider and picks the default model", async ({ browser }) => {
  const admin = await signIn(browser, ADMIN);
  const banner = admin.getByText("Add an LLM provider to start drafting.");
  await expect(banner).toBeVisible();
  await admin.getByRole("link", { name: "Set up LLM" }).click();
  await expect(admin.getByRole("heading", { name: "LLM providers" })).toBeVisible();

  await admin.getByRole("button", { name: "+ Add provider" }).click();
  await admin.getByText("Fake (testing)", { exact: true }).click();
  await expect(admin.getByRole("radio", { name: "Fake (testing)" })).toBeChecked();
  await admin.getByRole("button", { name: "Continue" }).click();

  // The fake provider rejects the key "invalid" like a real provider would.
  await admin.getByLabel("API key").fill("invalid");
  await admin.getByRole("button", { name: "Test connection" }).click();
  await expect(admin.getByRole("alert")).toHaveText("Key rejected by provider");

  await admin.getByRole("button", { name: "Change" }).last().click();
  await admin.getByLabel("API key").fill("fake-key");
  await admin.getByRole("button", { name: "Test connection" }).click();
  await expect(admin.getByText("2 models available")).toBeVisible();
  await admin.getByRole("button", { name: "Continue" }).click();
  await admin.getByRole("option", { name: /Fake small/ }).click();
  await admin.getByRole("button", { name: "Save provider" }).click();

  const providers = admin.getByRole("region", { name: "Providers" });
  await expect(providers).toContainText("Default");
  await expect(providers).toContainText("Connected");
  await expect(providers).not.toContainText("fake-key");

  await admin.goto("/");
  await expect(admin.getByRole("heading", { name: "Our documents" })).toBeVisible();
  await expect(banner).toHaveCount(0);
});
