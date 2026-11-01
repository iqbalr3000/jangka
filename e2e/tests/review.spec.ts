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

test("an assigned reviewer approves before the document can be approved", async ({ browser }) => {
  const admin = await signIn(browser, ADMIN);
  await admin.getByRole("button", { name: "+ New", exact: true }).click();
  const dialog = admin.getByRole("dialog", { name: "New document" });
  await dialog.getByLabel("Title").fill("Reviewer flow");
  await dialog.getByLabel("Collection").selectOption({ label: "Platform" });
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(admin.getByLabel("Document title")).toHaveValue("Reviewer flow");

  await admin.getByRole("button", { name: "Add reviewers" }).click();
  const popover = admin.getByRole("dialog", { name: "Reviewers" });
  await popover.getByLabel("Add reviewer").fill("ri");
  await popover.getByRole("button", { name: /Rina/ }).click();
  await expect(popover.getByRole("list", { name: "Assigned reviewers" })).toContainText(
    "RinaPending",
  );
  await admin.keyboard.press("Escape");

  await admin.getByRole("button", { name: "Status: Draft" }).click();
  await admin.getByRole("menuitem", { name: "Request review" }).click();
  await admin.getByRole("button", { name: "Status: In review" }).click();
  await admin.getByRole("menuitem", { name: "Approve" }).click();
  const blocked = admin.getByRole("dialog", { name: "Waiting for reviewers" });
  await expect(blocked).toContainText("Rina");
  await admin.keyboard.press("Escape");
  await expect(blocked).toHaveCount(0);

  const member = await signIn(browser, MEMBER);
  await expect(member.getByRole("link", { name: "Reviews, 1 waiting" })).toBeVisible();
  await member.getByRole("link", { name: "Reviews, 1 waiting" }).click();
  await member
    .getByRole("region", { name: "Waiting for my review" })
    .getByRole("link", { name: "Reviewer flow" })
    .click();
  await member.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(member.getByRole("button", { name: "Approve", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(member.getByRole("link", { name: "Reviews", exact: true })).toBeVisible();

  await admin.reload();
  await expect(admin.getByRole("button", { name: "Reviewers: Rina (Approved)" })).toBeVisible();
  await admin.getByRole("button", { name: "Status: In review" }).click();
  await admin.getByRole("menuitem", { name: "Approve" }).click();
  await expect(admin.getByText(/Approved by Ada Admin/)).toBeVisible();
});

/** Selects `words` inside a section's editor, the way a mouse drag would. */
async function selectWords(page: Page, section: string, words: string) {
  const editor = page.getByRole("textbox", { name: section, exact: true });
  await editor.evaluate((root, text) => {
    const doc = root.ownerDocument;
    // NodeFilter.SHOW_TEXT
    const walker = doc.createTreeWalker(root, 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(text) ?? -1;
      if (at === -1) continue;
      const range = doc.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + text.length);
      const selection = doc.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    throw new Error(`"${text}" not found`);
  }, words);
}

test("a viewer comments on selected words, highlighted until resolved", async ({ browser }) => {
  const admin = await signIn(browser, ADMIN);
  await admin.getByRole("button", { name: "+ New", exact: true }).click();
  const dialog = admin.getByRole("dialog", { name: "New document" });
  await dialog.getByLabel("Title").fill("Anchor flow");
  await dialog.getByLabel("Collection").selectOption({ label: "Platform" });
  await dialog.getByRole("button", { name: "Create" }).click();
  const overview = admin.getByRole("textbox", { name: "Overview", exact: true });
  await overview.click();
  await admin.keyboard.type("Refunds are allowed within 14 days of purchase.");
  await expect(saveStatus(admin)).toHaveText(/Saved/);
  const documentUrl = admin.url();

  const member = await signIn(browser, MEMBER);
  await member.goto(documentUrl);
  await expect(member.getByText("You have view access.")).toBeVisible();
  await selectWords(member, "Overview", "14 days");
  await member.getByRole("button", { name: "Comment", exact: true }).first().click();
  await expect(panel(member)).toContainText("Commenting on 14 days");
  await panel(member).getByLabel("Comment on Overview").fill("Is 14 days enough?");
  await panel(member).getByRole("button", { name: "Comment", exact: true }).click();
  const thread = panel(member).getByRole("listitem", { name: "Thread on Overview" });
  await expect(thread.locator("blockquote")).toHaveText("14 days");
  await expect(panel(member)).not.toContainText("Commenting on");

  await admin.reload();
  const highlight = admin.locator(".comment-anchor");
  await expect(highlight).toHaveText("14 days");
  await highlight.click();
  const adminThread = panel(admin).getByRole("listitem", { name: "Thread on Overview" });
  await expect(adminThread).toContainText("Is 14 days enough?");
  await adminThread.getByRole("button", { name: "Resolve" }).click();
  await expect(highlight).toHaveCount(0);

  await overview.click();
  await admin.keyboard.press("ControlOrMeta+a");
  await admin.keyboard.type("Refunds are allowed within two weeks.");
  await expect(saveStatus(admin)).toHaveText(/Saved/);
  await panel(admin).getByLabel("Resolved").check();
  await expect(adminThread).toContainText("Original text changed");
});

test("autosave stops retrying when the document is approved elsewhere", async ({ browser }) => {
  const admin = await signIn(browser, ADMIN);
  await admin.getByRole("button", { name: "+ New", exact: true }).click();
  const dialog = admin.getByRole("dialog", { name: "New document" });
  await dialog.getByLabel("Title").fill("Autosave stop");
  await dialog.getByRole("button", { name: "Create" }).click();
  const overview = admin.getByRole("textbox", { name: "Overview", exact: true });
  await overview.click();
  await admin.keyboard.type("First draft.");
  await expect(saveStatus(admin)).toHaveText(/Saved/);
  const id = admin.url().split("/d/")[1] ?? "";

  // Approved from another tab while this one keeps typing.
  const other = await signIn(browser, ADMIN);
  for (const status of ["in_review", "approved"]) {
    const res = await other.request.post(`/api/v1/documents/${id}/status`, {
      data: { status },
      headers: { origin: new URL(other.url()).origin },
    });
    expect(res.ok()).toBe(true);
  }

  let puts = 0;
  admin.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/sections/")) puts += 1;
  });
  await overview.click();
  await admin.keyboard.type(" More.");
  await expect(admin.getByRole("status").filter({ hasText: "Not saved" })).toBeVisible();
  await admin.waitForTimeout(2_000);
  expect(puts).toBeLessThanOrEqual(2);
});
