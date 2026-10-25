import { expect, type Page, test } from "@playwright/test";
import { ADMIN, signIn } from "../session";

const saveStatus = (page: Page) => page.getByRole("status").filter({ hasText: /Sav|Conflict/ });

async function exportAs(page: Page, format: "PDF" | "DOCX") {
  await page.keyboard.press("ControlOrMeta+Shift+E");
  const dialog = page.getByRole("dialog", { name: "Export" });
  await expect(dialog).toContainText("sections are empty and will show as placeholders");
  await dialog.getByRole("radio", { name: format }).check();
  await dialog.getByRole("button", { name: "Export" }).click();

  const toast = page.getByRole("status").filter({ hasText: /Preparing|Ready|failed/ });
  await expect(toast.getByRole("link", { name: "Download" })).toBeVisible({ timeout: 30_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    toast.getByRole("link", { name: "Download" }).click(),
  ]);
  return download;
}

test("export a PRD with a diagram to PDF and DOCX", async ({ browser }) => {
  const page = await signIn(browser, ADMIN);
  await page.getByRole("button", { name: "+ New", exact: true }).click();
  await page.getByLabel("Title").fill("Refund export");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByLabel("Document title")).toHaveValue("Refund export");

  await page.getByRole("textbox", { name: "Overview", exact: true }).click();
  await page.keyboard.type("Customers request refunds themselves.");
  await page.getByRole("textbox", { name: "User Flow", exact: true }).click();
  await page.getByRole("button", { name: "Diagram" }).click();
  await expect(page.getByRole("img", { name: "Diagram preview" }).locator("svg")).toBeVisible();
  await expect(saveStatus(page)).toHaveText(/Saved/);

  const pdf = await exportAs(page, "PDF");
  expect(pdf.suggestedFilename()).toBe("refund-export.pdf");
  const pdfBytes = await streamBytes(await pdf.createReadStream());
  expect(pdfBytes.subarray(0, 4).toString()).toBe("%PDF");

  const docx = await exportAs(page, "DOCX");
  expect(docx.suggestedFilename()).toBe("refund-export.docx");
  // DOCX is a zip.
  expect((await streamBytes(await docx.createReadStream())).subarray(0, 2).toString()).toBe("PK");
});

async function streamBytes(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
