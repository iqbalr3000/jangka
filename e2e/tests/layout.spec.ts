import { expect, type Page, test } from "@playwright/test";
import { ADMIN, signIn } from "../session";

const outline = (page: Page) => page.getByRole("navigation", { name: "Outline" });
const panel = (page: Page) => page.getByRole("complementary", { name: "Assistant" });
const panes = (page: Page) => page.getByRole("tablist").filter({ hasText: "outline" });

test("a broken diagram offers Fix with assistant", async ({ browser }) => {
  const page = await signIn(browser, ADMIN);
  // N opens New document outside inputs.
  await page.keyboard.press("n");
  await page.getByLabel("Title").fill("Layout check");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Document title")).toHaveValue("Layout check");

  await page.getByRole("textbox", { name: "User Flow", exact: true }).click();
  await page.getByRole("button", { name: "Diagram" }).click();
  await page.getByRole("button", { name: "source", exact: true }).click();
  await page.getByLabel("Mermaid source").fill("flowchart TD\n  A -->");
  await expect(page.getByText("Render error")).toBeVisible();

  // The fake provider's fix ("Fake") doesn't render either, so the worker check rejects it.
  await page.getByRole("button", { name: "Fix with assistant" }).click();
  await expect(page.getByText("The assistant couldn't fix this diagram.")).toBeVisible();
  await expect(page.getByLabel("Mermaid source")).toHaveValue("flowchart TD\n  A -->");
});

test("the document layout adapts to narrower screens", async ({ browser }) => {
  const page = await signIn(browser, ADMIN);
  await page.getByRole("button", { name: "+ New", exact: true }).click();
  await page.getByLabel("Title").fill("Narrow check");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Document title")).toHaveValue("Narrow check");

  // 1024–1279 px: outline as icons, panel still beside the document.
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(panel(page)).toBeVisible();
  await expect(outline(page).getByText("OUTLINE")).toBeHidden();
  await expect(panes(page)).toBeHidden();

  // Below 1024 px: one pane at a time.
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(panel(page)).toBeHidden();
  await expect(outline(page)).toBeHidden();
  await panes(page).getByRole("tab", { name: "assistant" }).click();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Overview", exact: true })).toBeHidden();

  await panes(page).getByRole("tab", { name: "outline" }).click();
  await outline(page)
    .getByRole("link", { name: /Risks & Mitigations/ })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Risks & Mitigations", exact: true }),
  ).toBeInViewport();
});
