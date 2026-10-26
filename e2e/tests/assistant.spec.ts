import { expect, type Page, test } from "@playwright/test";
import { ADMIN, signIn } from "../session";

const composer = (page: Page) => page.getByRole("textbox", { name: "Message the assistant" });
const panel = (page: Page) => page.getByRole("complementary", { name: "Assistant" });

async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("ControlOrMeta+Enter");
}

test("interview, draft everything, revise one section via chat, stop a reply", async ({
  browser,
}) => {
  const page = await signIn(browser, ADMIN);
  await page.getByRole("button", { name: "+ New", exact: true }).click();
  await page.getByLabel("Title").fill("Refund self-service");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Document title")).toHaveValue("Refund self-service");

  await send(page, "Customers wait 7 days for refunds.");
  await expect(panel(page)).toContainText("This is a fake reply");
  await expect(panel(page)).toContainText("COVERAGE 12/12");

  await page.getByRole("button", { name: "Draft all" }).click();
  await expect(page.getByRole("navigation", { name: "Outline" })).toContainText(
    "12 of 12 complete",
    { timeout: 30_000 },
  );
  await expect(page.getByRole("button", { name: "Draft all" })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Problem Statement", exact: true })).toContainText(
    "This is a fake reply",
  );
  await expect(panel(page)).toContainText("Drafted Overview");

  await composer(page).fill("@Non");
  await page.getByRole("option", { name: "Non-Functional Requirements" }).click();
  await composer(page).pressSequentially("Make every NFR measurable");
  await composer(page).press("ControlOrMeta+Enter");
  const proposal = page.getByRole("region", { name: "Proposed revision" });
  await expect(proposal.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
  await proposal.getByRole("button", { name: "Accept", exact: true }).click();
  const acceptedNote = page.getByRole("status").filter({ hasText: "Accepted" });
  await expect(acceptedNote).toBeVisible();
  await acceptedNote.getByRole("button", { name: "Undo" }).click();
  await expect(acceptedNote).toHaveCount(0);
  await expect(panel(page)).toContainText("Proposed changes to Non-Functional Requirements");

  await send(page, "[slow] Tell me more");
  await expect(panel(page)).toContainText("and more");
  await panel(page).getByRole("button", { name: "■ Stop" }).click();
  await expect(panel(page)).toContainText("(interrupted)");
  await expect(panel(page).getByRole("button", { name: "↑ Send" })).toBeVisible();
});

test("a draft keeps going while the user is on another page", async ({ browser }) => {
  const page = await signIn(browser, ADMIN);
  await page.getByRole("button", { name: "+ New", exact: true }).click();
  await page.getByLabel("Title").fill("Background draft");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Document title")).toHaveValue("Background draft");

  // "[slow]" in the transcript makes the fake draft each section slowly.
  await send(page, "[slow] Customers wait 7 days for refunds.");
  await expect(panel(page)).toContainText("COVERAGE 12/12", { timeout: 15_000 });

  await page.getByRole("heading", { name: "Overview" }).hover();
  await page.getByRole("button", { name: "Assistant actions for Overview" }).click();
  await page.getByRole("menuitem", { name: "Draft this section" }).click();
  await expect(page.getByText("Drafting…").first()).toBeVisible();

  // In-app navigation away and back: progress is still live, no reload needed.
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByLabel("Document title")).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("button", { name: "■ Stop" }).first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Overview", exact: true })).toContainText(
    "and more",
    { timeout: 15_000 },
  );
  await expect(page.getByRole("button", { name: "■ Stop" })).toHaveCount(0);
});
