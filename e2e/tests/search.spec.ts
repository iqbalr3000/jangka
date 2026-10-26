import { expect, type Page, test } from "@playwright/test";
import { ADMIN, MEMBER, signIn } from "../session";

const saveStatus = (page: Page) => page.getByRole("status").filter({ hasText: /Sav|Conflict/ });

async function createDoc(page: Page, title: string, collection: string, overview?: string) {
  await page.getByRole("button", { name: "+ New", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New document" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("Collection").selectOption({ label: collection });
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Document title")).toHaveValue(title);
  if (overview) {
    await page.getByRole("textbox", { name: "Overview", exact: true }).click();
    await page.keyboard.type(overview);
    await expect(saveStatus(page)).toHaveText(/Saved/);
  }
}

test("search finds viewable documents only, from ⌘K and the search page", async ({ browser }) => {
  const admin = await signIn(browser, ADMIN);
  await createDoc(admin, "Zebra secrets", "Personal", "Zebra plans nobody else sees.");
  await createDoc(admin, "Launch plan", "Platform", "The zebra crossing rollout starts in May.");

  // The member (view access to Platform) searches from the palette.
  const member = await signIn(browser, MEMBER);
  await member.keyboard.press("ControlOrMeta+k");
  const palette = member.getByRole("dialog", { name: "Search" });
  await palette.getByRole("combobox").fill("zebra");
  const results = palette.getByRole("listbox", { name: "Results" });
  await expect(results.getByRole("option", { name: /Launch plan/ })).toBeVisible();
  await expect(results).not.toContainText("Zebra secrets");
  await palette.getByRole("combobox").press("Enter");
  await expect(member.getByLabel("Document title")).toHaveValue("Launch plan");

  // The search page shows a highlighted snippet and filters by type.
  await member.goto("/search?q=zebra");
  const list = member.getByRole("list", { name: "Search results" });
  await expect(list).toContainText("Launch plan");
  await expect(list.locator("mark").first()).toHaveText(/zebra/i);
  await expect(list).not.toContainText("Zebra secrets");
  await member.getByRole("button", { name: "BRD", exact: true }).click();
  await expect(member.getByText("No documents match “zebra”.")).toBeVisible();

  await admin.goto("/search?q=zebra");
  await expect(admin.getByRole("list", { name: "Search results" })).toContainText("Zebra secrets");
});
