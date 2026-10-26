import { expect, type Page, test } from "@playwright/test";
import { ADMIN, signIn } from "../session";

const saveStatus = (page: Page) => page.getByRole("status").filter({ hasText: /Sav|Conflict/ });

test("blocks: slash insert, line after a table, bubble formatting, gutter delete", async ({
  browser,
}) => {
  const page = await signIn(browser, ADMIN);
  await page.getByRole("button", { name: "+ New", exact: true }).click();
  await page.getByLabel("Title").fill("Editor blocks");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Document title")).toHaveValue("Editor blocks");

  const overview = page.getByRole("textbox", { name: "Overview", exact: true });
  await overview.click();
  await page.keyboard.type("First line");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/tab");
  await expect(page.getByRole("listbox", { name: "Insert block" })).toContainText("Table");
  await page.keyboard.press("Enter");
  // No forced empty line after a closing table.
  await expect(overview.locator(":scope > *").last()).toHaveClass(/tableWrapper/);

  // Clicking under the table continues the section.
  const box = await overview.boundingBox();
  if (!box) throw new Error("Overview editor not laid out");
  await page.mouse.click(box.x + 40, box.y + box.height + 10);
  await page.keyboard.type("After the table");
  await expect(overview.locator(":scope > p").last()).toHaveText("After the table");

  await overview.getByText("First line").click({ clickCount: 3 });
  const formatting = page.getByRole("toolbar", { name: "Formatting" });
  await formatting.getByRole("button", { name: "Bold" }).click();
  await expect(overview.locator("strong")).toHaveText("First line");

  await overview.getByText("After the table").hover();
  await page.getByRole("button", { name: "Block actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(overview).not.toContainText("After the table");
  await expect(saveStatus(page)).toHaveText(/Saved/);

  await page.reload();
  const reloaded = page.getByRole("textbox", { name: "Overview", exact: true });
  await expect(reloaded.locator("strong")).toHaveText("First line");
  await expect(reloaded.locator(":scope > *").last()).toHaveClass(/tableWrapper/);
});
