import { expect, type Page, test } from "@playwright/test";
import { ADMIN, signIn } from "../session";

const outline = (page: Page) => page.getByRole("navigation", { name: "Outline" });
const saveStatus = (page: Page) => page.getByRole("status").filter({ hasText: /Sav|Conflict/ });

test("create a PRD, edit sections with a diagram, resolve a conflict", async ({ browser }) => {
  const page = await signIn(browser, ADMIN);
  await page.getByRole("button", { name: "+ New", exact: true }).click();
  await page.getByLabel("Title").fill("Checkout revamp");
  await expect(page.getByRole("combobox", { name: "Collection" })).toHaveValue(/.+/);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Document title")).toHaveValue("Checkout revamp");
  await expect(outline(page)).toContainText("0 of 12 complete");

  const overview = page.getByRole("textbox", { name: "Overview", exact: true });
  await overview.click();
  await page.keyboard.type("One-page checkout for returning customers.");
  await expect(saveStatus(page)).toHaveText(/Saved/);
  await expect(outline(page)).toContainText("1 of 12 complete");

  // Diagram in User Flow.
  await page.getByRole("textbox", { name: "User Flow", exact: true }).click();
  await page.getByRole("button", { name: "Diagram" }).click();
  await expect(page.getByRole("img", { name: "Diagram preview" }).locator("svg")).toBeVisible();
  await expect(saveStatus(page)).toHaveText(/Saved/);

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Overview", exact: true })).toContainText(
    "One-page checkout for returning customers.",
  );
  await expect(page.getByRole("img", { name: "Diagram preview" }).locator("svg")).toBeVisible();

  // Another tab edits the same section first.
  const other = await signIn(browser, ADMIN);
  await other.goto(page.url());
  const otherOverview = other.getByRole("textbox", { name: "Overview", exact: true });
  await otherOverview.click();
  await other.keyboard.press("End");
  await other.keyboard.type(" Guest checkout later.");
  await expect(saveStatus(other)).toHaveText(/Saved/);

  await overview.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Mine.");
  const banner = page.getByRole("alert").filter({ hasText: "Updated by Ada Admin" });
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Overwrite" }).click();
  await expect(banner).toHaveCount(0);
  await expect(saveStatus(page)).toHaveText(/Saved/);

  await other.reload();
  await expect(other.getByRole("textbox", { name: "Overview", exact: true })).toContainText(
    "Mine.",
  );
});
