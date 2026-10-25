import { expect, test } from "@playwright/test";
import { IDP_ISSUER } from "../env";
import { ADMIN, signIn } from "../session";

test("an admin adds an OIDC provider and signs in with it", async ({ browser }) => {
  const admin = await signIn(browser, ADMIN);
  await admin.goto("/admin/auth");
  await admin.getByRole("button", { name: "+ Add provider" }).click();
  const dialog = admin.getByRole("dialog", { name: "Add SSO provider" });
  await expect(dialog).toContainText("/api/v1/auth/oidc/callback");
  await dialog.getByText("OpenID Connect", { exact: true }).click();
  await dialog.getByLabel("Name").fill("Acme SSO");
  await dialog.getByLabel("Issuer URL").fill(IDP_ISSUER);
  await dialog.getByLabel("Client ID").fill("jangka-e2e");
  await dialog.getByLabel("Client secret").fill("e2e-client-secret");
  await dialog.getByRole("button", { name: "Add provider" }).click();
  await expect(dialog).toHaveCount(0);
  const providers = admin.getByRole("region", { name: "SSO providers" });
  await expect(providers).toContainText("Acme SSO");
  await expect(providers).toContainText("0 linked users");
  await expect(providers).not.toContainText("e2e-client-secret");

  // Password sign-in can't be turned off until an admin has signed in with SSO.
  await expect(
    admin.getByText("An admin must sign in with SSO at least once first."),
  ).toBeVisible();

  // Sign in through the IdP from a fresh browser, landing on the page asked for.
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login?redirect=%2Fadmin%2Fauth");
  await page.getByRole("link", { name: "Continue with Acme SSO" }).click();
  await expect(page).toHaveURL(/\/admin\/auth$/);
  await expect(page.getByRole("region", { name: "SSO providers" })).toContainText("1 linked user");
  await expect(page.getByLabel("Allow password sign-in")).toBeEnabled();

  await page.goto("/admin/users");
  await expect(page.getByTitle("Signs in with Acme SSO")).toBeVisible();
});
