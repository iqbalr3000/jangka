import { expect, type Page, test } from "@playwright/test";
import { ADMIN, signIn } from "../session";

const panel = (page: Page) => page.getByRole("complementary", { name: "Assistant" });
const saveStatus = (page: Page) => page.getByRole("status").filter({ hasText: /Sav|Conflict/ });

test("restore an older section version and find it in the audit log", async ({ browser }) => {
  const page = await signIn(browser, ADMIN);
  await page.getByRole("button", { name: "+ New", exact: true }).click();
  await page.getByLabel("Title").fill("History check");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Document title")).toHaveValue("History check");

  // r1: a human edit.
  const overview = page.getByRole("textbox", { name: "Overview", exact: true });
  await overview.click();
  await page.keyboard.type("Customers wait a week for refunds.");
  await expect(saveStatus(page)).toHaveText(/Saved/);

  // r2: an accepted AI revision, from the section menu while still editing it.
  await page.getByRole("button", { name: "Assistant actions for Overview" }).click();
  await page.getByRole("menuitem", { name: "⟳ Revise…" }).click();
  await page.getByLabel("Revise Overview").fill("Make it shorter");
  await page.getByLabel("Revise Overview").press("Enter");
  const proposal = page.getByRole("region", { name: "Proposed revision" });
  await proposal.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(overview).toContainText("This is a fake reply");

  // History: diff against the human version, then restore it.
  await page.getByRole("button", { name: "History of Overview" }).click();
  await expect(panel(page).getByRole("tab", { name: "history" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const versions = panel(page).getByRole("list", { name: "Versions" });
  await expect(versions).toContainText("AI");
  await versions.getByRole("button").filter({ hasText: "Edited" }).first().click();
  await expect(
    panel(page).getByRole("region", { name: "Changes since this version" }),
  ).toContainText("+ This is a fake reply");
  await panel(page).getByRole("button", { name: "Restore this version" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Restore", exact: true }).click();
  await expect(overview).toHaveText("Customers wait a week for refunds.");
  await expect(versions).toContainText(/Restored from r\d+/);

  await page.goto("/admin/audit");
  await page.getByLabel("Area").selectOption({ label: "Documents" });
  const entries = page.getByRole("region", { name: "Audit entries" });
  await expect(entries).toContainText("document.restore_section");
  await expect(entries).not.toContainText("auth.login");
  await entries.getByText("document.restore_section").first().click();
  await expect(entries).toContainText('"section": "overview"');
});
