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
  // Unsaved changes: leaving asks first, and Cancel stays on the editor.
  await page.getByRole("link", { name: "Templates" }).first().click();
  const leave = page.getByRole("dialog", { name: "Leave without saving?" });
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("v1 · Draft");

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

test("an admin creates a blank TSD template and new TSDs can use it", async ({ browser }) => {
  const page = await signIn(browser, ADMIN);
  await page.goto("/admin/templates");
  await page.getByRole("button", { name: "New template" }).click();
  const create = page.getByRole("dialog", { name: "New template" });
  await create.getByText("TSD", { exact: true }).click();
  await expect(create.getByRole("radio", { name: /^TSD/ })).toBeChecked();
  await create.getByLabel("Name").fill("Acme TSD");
  await expect(create.getByLabel("Start from")).toHaveValue("");
  await create.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Acme TSD");
  await expect(page.getByText("No sections yet.")).toBeVisible();

  // An empty draft can't be published.
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByText("Add at least one section before publishing")).toBeVisible();

  await page.getByRole("button", { name: "+ Add section" }).click();
  await page
    .getByRole("group", { name: "New section" })
    .getByLabel("Section title")
    .fill("Runbook");
  await expect(page.getByText("No section collects requirements")).toBeVisible();

  // Guidance starts empty and is required at publish; the failing card says why.
  await page.getByRole("button", { name: "Publish v1" }).click();
  const runbook = page.getByRole("group", { name: "Runbook" });
  await expect(runbook).toContainText("Write guidance for the assistant");
  await runbook.getByLabel("Guidance").fill("Steps to operate and recover the service.");
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("v1 · Published");

  await page.getByRole("button", { name: "+ New", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New document" });
  await dialog.getByText("TSD", { exact: true }).click();
  await dialog.getByLabel("Template").selectOption({ label: "Acme TSD · v1" });
  await dialog.getByLabel("Title").fill("Blank template doc");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("textbox", { name: "Runbook", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Outline" })).toContainText("0 of 1 complete");
});

test("a document upgrades to the template's newer version without losing content", async ({
  browser,
}) => {
  const page = await signIn(browser, ADMIN);
  await page.goto("/admin/templates");
  await familyAction(page, "Product Requirements Document", "Duplicate…");
  await page.getByLabel("Name").fill("Upgrade PRD");
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await page.getByRole("button", { name: "Publish v1" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("v1 · Published");

  await page.getByRole("button", { name: "+ New", exact: true }).click();
  const create = page.getByRole("dialog", { name: "New document" });
  await create.getByLabel("Template").selectOption({ label: "Upgrade PRD · v1" });
  await create.getByLabel("Title").fill("Refunds on v1");
  await create.getByRole("button", { name: "Create" }).click();
  const risks = page.getByRole("textbox", { name: "Risks & Mitigations", exact: true });
  await risks.click();
  await page.keyboard.type("Refund fraud.");
  await expect(page.getByRole("status").filter({ hasText: /Sav/ })).toHaveText(/Saved/);
  const documentUrl = page.url();

  // v2 drops Risks & Mitigations and adds Rollout Plan.
  await page.goto("/admin/templates");
  await familyAction(page, "Upgrade PRD", "New version");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("v2 · Draft");
  await page
    .getByRole("group", { name: "Risks & Mitigations" })
    .getByRole("button", { name: "Remove section" })
    .click();
  await page.getByRole("button", { name: "+ Add section" }).click();
  const added = page.getByRole("group", { name: "New section" });
  await added.getByLabel("Section title").fill("Rollout Plan");
  await page.getByRole("group", { name: "Rollout Plan" }).getByLabel("Guidance").fill("Phases.");
  await page.getByRole("button", { name: "Publish v2" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("v2 · Published");

  await page.goto(documentUrl);
  await page.getByRole("button", { name: "Review upgrade" }).click();
  const dialog = page.getByRole("dialog", { name: "Upgrade template" });
  await expect(dialog).toContainText("v1 → v2");
  await expect(dialog).toContainText("Rollout Plan");
  await expect(dialog).toContainText("Risks & Mitigations · keeps its content");
  await dialog.getByRole("button", { name: "Upgrade to v2" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(page.getByRole("button", { name: "Review upgrade" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Rollout Plan", exact: true })).toBeVisible();
  const retired = page.getByRole("region", { name: "Risks", exact: true });
  await expect(retired).toContainText("Removed from template");
  await expect(retired).toContainText("Refund fraud.");
});
