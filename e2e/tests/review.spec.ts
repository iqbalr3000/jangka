import { expect, type Page, test } from "@playwright/test";
import { ADMIN, MEMBER, signIn } from "../session";

const panel = (page: Page) => page.getByRole("complementary", { name: "Assistant" });
/** The empty-section placeholder of a section (rendered from data-placeholder by CSS). */
const emptyPlaceholder = (page: Page, section: string) =>
  page.getByRole("textbox", { name: section, exact: true }).locator("p.is-editor-empty");
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

  const member = await signIn(browser, MEMBER);
  await member.goto(documentUrl);
  await expect(member.getByText("You have view access.")).toBeVisible();
  await expect(emptyPlaceholder(member, "Problem Statement")).toHaveAttribute(
    "data-placeholder",
    "Not yet specified.",
  );
  await member.getByRole("button", { name: "Comment on Overview" }).click();
  await panel(member).getByLabel("Comment on Overview").fill("Which markets are in scope?");
  await panel(member).getByRole("button", { name: "Comment", exact: true }).click();
  await expect(panel(member).getByRole("list", { name: "Comment threads" })).toContainText(
    "Which markets are in scope?",
  );

  // Approving with an open thread is refused, and the dialog leads to it.
  await admin.reload();
  await admin.getByRole("button", { name: "Status: Draft" }).click();
  await admin.getByRole("menuitem", { name: "Request review" }).click();
  await admin.getByRole("button", { name: "Status: In review" }).click();
  await admin.getByRole("menuitem", { name: "Approve" }).click();
  const blocked = admin.getByRole("dialog", { name: "Resolve comments before approving" });
  await expect(blocked).toContainText("Overview");
  await blocked.getByRole("button", { name: "Show comments" }).click();
  await expect(blocked).toHaveCount(0);

  const thread = panel(admin).getByRole("listitem", { name: "Thread on Overview" });
  await expect(thread).toContainText("Which markets are in scope?");
  await thread.getByRole("button", { name: "Reply" }).click();
  await thread.getByLabel("Reply").fill("Indonesia and Singapore.");
  await thread.getByRole("button", { name: "Reply", exact: true }).last().click();
  await expect(thread).toContainText("Indonesia and Singapore.");
  await thread.getByRole("button", { name: "Resolve" }).click();
  await expect(panel(admin)).toContainText("No open comments.");
  await expect(admin.getByRole("button", { name: "Comment on Overview" })).toBeAttached();

  await admin.getByRole("button", { name: "Status: In review" }).click();
  await admin.getByRole("menuitem", { name: "Approve" }).click();
  await expect(admin.getByText(/Approved by Ada Admin/)).toBeVisible();
  await expect(overview).toHaveAttribute("contenteditable", "false");
  await expect(emptyPlaceholder(admin, "Problem Statement")).toHaveAttribute(
    "data-placeholder",
    "Not yet specified.",
  );

  await admin.getByRole("button", { name: "Status: Approved" }).click();
  await admin.getByRole("menuitem", { name: "Reopen" }).click();
  await expect(admin.getByRole("button", { name: "Status: Draft" })).toBeVisible();
  await expect(overview).toHaveAttribute("contenteditable", "true");
  await expect(emptyPlaceholder(admin, "Problem Statement")).toHaveAttribute(
    "data-placeholder",
    "Not enough information yet.",
  );
});

test("an @mention notifies the member, who lands on the comment", async ({ browser }) => {
  const admin = await signIn(browser, ADMIN);
  await admin.getByRole("button", { name: "+ New", exact: true }).click();
  const dialog = admin.getByRole("dialog", { name: "New document" });
  await dialog.getByLabel("Title").fill("Mention flow");
  await dialog.getByLabel("Collection").selectOption({ label: "Platform" });
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(admin.getByRole("textbox", { name: "Overview", exact: true })).toBeVisible();

  await admin.getByRole("button", { name: "Comment on Overview" }).click();
  const box = panel(admin).getByLabel("Comment on Overview");
  await box.pressSequentially("Can you check this @Ri");
  await panel(admin).getByRole("option", { name: /Rina/ }).click();
  await box.pressSequentially("please check the refund window?");
  await panel(admin).getByRole("button", { name: "Comment", exact: true }).click();
  const thread = panel(admin).getByRole("listitem", { name: "Thread on Overview" });
  await expect(thread).toContainText("Can you check this @Rina please check the refund window?");
  await expect(thread.getByText("@Rina", { exact: true })).toBeVisible();

  const member = await signIn(browser, MEMBER);
  await expect(member.getByTestId("unread-badge")).toBeVisible();
  await member.getByRole("button", { name: /^Notifications, \d+ unread$/ }).click();
  const notifications = member.getByRole("dialog", { name: "Notifications" });
  const item = notifications.getByRole("button", {
    name: /Ada Admin mentioned you in Mention flow/,
  });
  await expect(item).toContainText("Can you check this @Rina please check the refund window?");
  await item.click();

  await expect(member).toHaveURL(/\/d\/[^?]+$/);
  await expect(member.getByLabel("Document title")).toHaveValue("Mention flow");
  const landed = panel(member).getByRole("listitem", { name: "Thread on Overview" });
  await expect(landed).toContainText("Can you check this @Rina please check the refund window?");
  await member.getByRole("button", { name: /^Notifications/ }).click();
  await expect(
    notifications
      .getByRole("button", { name: /Ada Admin mentioned you in Mention flow/ })
      .getByRole("img", { name: "Unread" }),
  ).toHaveCount(0);
});
