import { expect, type Page, test } from "@playwright/test";
import { ADMIN, signIn } from "../session";

const prdTemplates = (page: Page) => page.getByRole("region", { name: "PRD templates" });

async function familyAction(page: Page, family: string, action: string) {
  await page.getByRole("button", { name: `Actions for ${family}` }).click();
  await page.getByRole("menuitem", { name: action }).click();
}

test("an admin publishes a custom PRD template and new PRDs use it", async ({ browser }) => {
  const page = await signIn(browser, ADMIN);
  await page.goto("/admin/templates");
  await familyAction(page, "Product Requirements Document", "Duplicate…");
  await page.getByLabel("Name").fill("Acme PRD");
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Acme PRD");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("v1 · Draft");

  await page.getByRole("button", { name: "+ Add section" }).click();
  const added = page.getByRole("group", { name: "New section" });
  await added.getByLabel("Section title").fill("Rollout Plan");
  await page
    .getByRole("group", { name: "Rollout Plan" })
    .getByLabel("Guidance")
    .fill("Phases, flags, rollback.");
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("v1 · Published");
  await expect(page.getByRole("group", { name: "Rollout Plan" })).toContainText("rollout_plan");

  await page.goto("/admin/templates");
  await familyAction(page, "Acme PRD", "Set as default");
  const family = (name: string) => prdTemplates(page).getByRole("listitem", { name, exact: true });
  await expect(family("Acme PRD")).toContainText("Default");
  await expect(family("Product Requirements Document")).not.toContainText("Default");

  await page.getByRole("button", { name: "+ New", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New document" });
  await expect(dialog.getByLabel("Template")).toHaveValue(/.+/);
  await expect(dialog.getByLabel("Template").locator("option:checked")).toHaveText(
    "Acme PRD · v1 (default)",
  );
  await dialog.getByLabel("Title").fill("Custom template doc");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("textbox", { name: "Rollout Plan", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Outline" })).toContainText("0 of 13 complete");

  // Other specs create PRDs from the built-in: put it back as the default.
  await page.goto("/admin/templates");
  await familyAction(page, "Product Requirements Document", "Set as default");
  await expect(family("Product Requirements Document")).toContainText("Default");
  await expect(family("Acme PRD")).not.toContainText("Default");
});
