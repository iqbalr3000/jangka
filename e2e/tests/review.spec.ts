import { expect, type Page, test } from "@playwright/test";
import { ADMIN, MEMBER, signIn } from "../session";

const panel = (page: Page) => page.getByRole("complementary", { name: "Assistant" });
const saveStatus = (page: Page) => page.getByRole("status").filter({ hasText: /Sav|Conflict/ });

test("a reader comments, the editor resolves, approves, and reopens", async ({ browser }) => {
  const admin = await signIn(browser, ADMIN);
  await admin.getByRole("button", { name: "+ New", exact: true }).click();
  const dialog = admin.getByRole("dialog", { name: "New document" });
  await dialog.getByLabel("Title").fill("Review flow");
  // Platform: the member can view it (access spec).
  await dialog.getByLabel("Collection").selectOption({ label: "Platform" });
  await dialog.getByRole("button", { name: "Create" }).click();
  const overview = admin.getByRole("textbox", { name: "Overview", exact: true });
  await overview.click();
  await admin.keyboard.type("Self-service refunds.");
  await expect(saveStatus(admin)).toHaveText(/Saved/);
  const documentUrl = admin.url();

  // The member (view access) comments on Overview.
  const member = await signIn(browser, MEMBER);
  await member.goto(documentUrl);
  await expect(member.getByText("You have view access.")).toBeVisible();
  await member.getByRole("button", { name: "Comment on Overview" }).click();
  await panel(member).getByLabel("Comment on Overview").fill("Which markets are in scope?");
  await panel(member).getByRole("button", { name: "Comment", exact: true }).click();
  await expect(panel(member).getByRole("list", { name: "Comment threads" })).toContainText(
    "Which markets are in scope?",
  );

  // The editor sees the badge, replies and resolves.
  await admin.reload();
  await admin.getByRole("button", { name: "1 open comments on Overview" }).click();
  const thread = panel(admin).getByRole("listitem", { name: "Thread on Overview" });
  await expect(thread).toContainText("Which markets are in scope?");
  await thread.getByRole("button", { name: "Reply" }).click();
  await thread.getByLabel("Reply").fill("Indonesia and Singapore.");
  await thread.getByRole("button", { name: "Reply", exact: true }).last().click();
  await expect(thread).toContainText("Indonesia and Singapore.");
  await thread.getByRole("button", { name: "Resolve" }).click();
  await expect(panel(admin)).toContainText("No open comments.");
  await expect(admin.getByRole("button", { name: "Comment on Overview" })).toBeAttached();

  // Review and approve: the content freezes.
  await admin.getByRole("button", { name: "Status: Draft" }).click();
  await admin.getByRole("menuitem", { name: "Request review" }).click();
  await admin.getByRole("button", { name: "Status: In review" }).click();
  await admin.getByRole("menuitem", { name: "Approve" }).click();
  await expect(admin.getByText(/Approved by Ada Admin/)).toBeVisible();
  await expect(overview).toHaveAttribute("contenteditable", "false");

  // Reopen to edit again.
  await admin.getByRole("button", { name: "Status: Approved" }).click();
  await admin.getByRole("menuitem", { name: "Reopen" }).click();
  await expect(admin.getByRole("button", { name: "Status: Draft" })).toBeVisible();
  await expect(overview).toHaveAttribute("contenteditable", "true");
});
