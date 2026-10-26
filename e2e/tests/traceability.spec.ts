import { expect, type Page, test } from "@playwright/test";
import { ADMIN, MEMBER, signIn } from "../session";

const outline = (page: Page) => page.getByRole("navigation", { name: "Outline" });
const panel = (page: Page) => page.getByRole("complementary", { name: "Assistant" });

async function newDocument(
  page: Page,
  input: { type: "BRD" | "PRD" | "TSD"; title: string; collection: string; source?: string },
) {
  await page.getByRole("button", { name: "+ New", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New document" });
  await dialog.getByText(input.type, { exact: true }).click();
  await expect(dialog.getByRole("radio", { name: new RegExp(`^${input.type}`) })).toBeChecked();
  await dialog.getByLabel("Title").fill(input.title);
  await dialog.getByLabel("Collection").selectOption({ label: input.collection });
  if (input.source)
    await dialog.getByLabel(/Source document/).selectOption({ label: input.source });
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Document title")).toHaveValue(input.title);
}

async function openTrace(page: Page) {
  await panel(page).getByRole("tab", { name: "Trace" }).click();
}

test("BRD → PRD → TSD chain with linked requirements; restricted BRD for a member", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const admin = await signIn(browser, ADMIN);

  // BRD in the admin's Personal collection: the member can't see it.
  await newDocument(admin, { type: "BRD", title: "Refund BRD", collection: "Personal" });
  await panel(admin).getByRole("tab", { name: "Chat" }).click();
  await panel(admin)
    .getByRole("textbox", { name: "Message the assistant" })
    .fill("Refunds take 7 days.");
  await panel(admin)
    .getByRole("textbox", { name: "Message the assistant" })
    .press("ControlOrMeta+Enter");
  await expect(panel(admin)).toContainText("COVERAGE 13/13");
  await admin.getByRole("button", { name: "Draft all" }).click();
  await expect(outline(admin)).toContainText("13 of 13 complete", { timeout: 30_000 });
  await openTrace(admin);
  await expect(panel(admin)).toContainText("BR-001");

  // PRD from the BRD, in Platform (the member can view it since the access spec).
  await newDocument(admin, {
    type: "PRD",
    title: "Refund PRD",
    collection: "Platform",
    source: "BRD · Refund BRD",
  });
  await expect(admin.getByRole("link", { name: /↑ BRD · Refund BRD/ })).toBeVisible();
  await admin.getByRole("button", { name: "Draft from source" }).click();
  await expect(outline(admin)).toContainText("12 of 12 complete", { timeout: 30_000 });
  await openTrace(admin);
  const fr = panel(admin)
    .getByRole("listitem")
    .filter({ hasText: /^FR-001/ });
  await expect(fr.getByRole("link", { name: "BR-001" })).toBeVisible();
  const prdUrl = admin.url();

  await newDocument(admin, {
    type: "TSD",
    title: "Refund TSD",
    collection: "Platform",
    source: "PRD · Refund PRD",
  });
  await admin.getByRole("button", { name: "Draft from source" }).click();
  await expect(outline(admin)).toContainText("13 of 13 complete", { timeout: 30_000 });
  await openTrace(admin);
  const tr = panel(admin)
    .getByRole("listitem")
    .filter({ hasText: /^TR-001/ });
  await expect(tr.getByRole("link", { name: "FR-001" })).toBeVisible();

  // The PRD now shows TR-001 downstream of FR-001.
  await admin.goto(prdUrl);
  await openTrace(admin);
  await expect(fr.getByRole("link", { name: "TR-001" })).toBeVisible();

  // The member sees the PRD but not the BRD it came from.
  const member = await signIn(browser, MEMBER);
  await member.goto(prdUrl);
  await expect(member.getByText("You have view access.")).toBeVisible();
  await expect(member.getByText("Restricted document").first()).toBeVisible();
  await expect(member.locator("body")).not.toContainText("Refund BRD");
  await openTrace(member);
  await expect(panel(member)).toContainText("Restricted document");
  await expect(panel(member)).not.toContainText("Refund BRD");
  await expect(panel(member).getByRole("link", { name: "BR-001" })).toHaveCount(0);
});
