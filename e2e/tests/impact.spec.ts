import { expect, type Page, test } from "@playwright/test";
import { ADMIN, signIn } from "../session";

const panel = (page: Page) => page.getByRole("complementary", { name: "Assistant" });
const sidebar = (page: Page) => page.getByRole("navigation", { name: "Main" });
const saveStatus = (page: Page) => page.getByRole("status").filter({ hasText: /Sav|Conflict/ });

// Builds on the BRD → PRD → TSD chain the traceability spec creates.
test("an upstream change flags the PRD; chat references other documents", async ({ browser }) => {
  const page = await signIn(browser, ADMIN);

  // Change BR-001 in the BRD.
  await sidebar(page).getByRole("link", { name: "Personal" }).click();
  await page.getByRole("link", { name: /Refund BRD/ }).click();
  const requirements = page.getByRole("textbox", { name: "Business Requirements", exact: true });
  await requirements.getByText("Fake requirement one").click();
  await page.keyboard.type(" (48 hours)");
  await expect(saveStatus(page)).toHaveText(/Saved/);

  // The PRD's trace flags the requirements citing BR-001.
  await sidebar(page).getByRole("link", { name: "Platform" }).click();
  await page.getByRole("link", { name: /Refund PRD/ }).click();
  await panel(page).getByRole("tab", { name: "trace" }).click();
  await expect(panel(page)).toContainText(/\d+ needs? review/);
  const fr = panel(page)
    .getByRole("listitem")
    .filter({ hasText: /^FR-001/ });
  await expect(fr).toContainText("Needs review: upstream changed");
  await expect(fr.getByRole("link", { name: "BR-001 · changed" })).toBeVisible();
  await fr.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(fr).not.toContainText("Needs review");

  // Chat draws on another viewable document (the TSD) and says so.
  await panel(page).getByRole("tab", { name: "chat" }).click();
  const composer = page.getByRole("textbox", { name: "Message the assistant" });
  await composer.fill("How is the refund queue handled? Fake requirement details please.");
  await composer.press("ControlOrMeta+Enter");
  await expect(panel(page).getByText("Referenced:").last()).toBeVisible({ timeout: 15_000 });
  await expect(panel(page)).toContainText("TSD Refund TSD");
});
