import { expect, type Page, test } from "@playwright/test";
import { ADMIN, MEMBER, signIn } from "../session";

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Main" });

test("a member sees a collection only after it is granted", async ({ browser }) => {
  const admin = await signIn(browser, ADMIN);
  await sidebar(admin).getByRole("button", { name: "New collection" }).click();
  await admin.getByLabel("Name").fill("Platform");
  await admin.getByRole("button", { name: "Create" }).click();
  await expect(admin.getByRole("heading", { name: "Platform" })).toBeVisible();
  const platformUrl = admin.url();

  const member = await signIn(browser, MEMBER);
  await expect(sidebar(member)).not.toContainText("Platform");
  await member.goto(platformUrl);
  await expect(member.getByText("Collection not found.")).toBeVisible();

  await admin.goto("/admin/permissions");
  await admin.getByRole("button", { name: "All Users on Platform" }).click();
  await admin.getByRole("menuitem", { name: /^View/ }).click();
  await expect(admin.getByRole("region", { name: "Staged changes" })).toContainText(
    "All Users: No access → View on Platform",
  );
  await admin.getByRole("button", { name: "Save changes" }).click();
  await expect(admin.getByRole("region", { name: "Staged changes" })).toHaveCount(0);

  await member.goto("/");
  await sidebar(member).getByRole("link", { name: "Platform" }).click();
  await expect(member.getByRole("heading", { name: "Platform" })).toBeVisible();
  await expect(member.getByText("Access: View (via All Users)")).toBeVisible();
  await expect(member.getByRole("button", { name: "+ New collection" })).toHaveCount(0);

  await sidebar(member).getByRole("link", { name: "Personal" }).click();
  await expect(member.getByRole("heading", { name: "Personal" })).toBeVisible();
  await expect(member.getByText("Access: Edit (your personal collection)")).toBeVisible();
});
