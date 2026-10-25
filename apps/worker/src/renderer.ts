import type { DiagramResult } from "@jangka/export/render";
import { type Browser, type BrowserContext, chromium } from "playwright-core";
import { z } from "zod";
import { assetPath, MERMAID_SCRIPT } from "./assets";

const RENDER_TIMEOUT_MS = 15_000;
const MAX_ERROR_CHARS = 500;

const mermaidScript = assetPath(MERMAID_SCRIPT);

// Runs in the page; a string because the worker is typed without DOM globals.
const RENDER_IN_PAGE = `async ({ source, id }) => {
  const mermaid = window.mermaid;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
  try {
    const { svg } = await mermaid.render(id, source);
    document.getElementById("out").innerHTML = svg;
    return { svg };
  } catch (error) {
    return { error: String((error && error.message) || error) };
  }
}`;

const pageResult = z.union([z.object({ svg: z.string() }), z.object({ error: z.string() })]);

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), RENDER_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * One shared headless Chromium; every job gets a fresh context with all network requests
 * aborted, since diagram sources and document content are untrusted.
 */
export class Renderer {
  private browser: Promise<Browser> | null = null;

  private launch(): Promise<Browser> {
    if (!this.browser) {
      this.browser = chromium.launch({ args: ["--disable-dev-shm-usage"] }).then((browser) => {
        browser.on("disconnected", () => {
          this.browser = null;
        });
        return browser;
      });
      this.browser.catch(() => {
        this.browser = null;
      });
    }
    return this.browser;
  }

  private async withContext<T>(
    options: { javaScriptEnabled: boolean; deviceScaleFactor?: number },
    run: (context: BrowserContext) => Promise<T>,
  ): Promise<T> {
    const browser = await this.launch();
    const context = await browser.newContext(options);
    try {
      await context.route("**/*", (route) => route.abort());
      return await run(context);
    } finally {
      await context.close();
    }
  }

  /** SVG + 2x PNG, or Mermaid's error message (a broken source isn't a job failure). */
  async renderDiagram(source: string, id: string): Promise<DiagramResult> {
    return this.withContext({ javaScriptEnabled: true, deviceScaleFactor: 2 }, async (context) => {
      const page = await context.newPage();
      await page.setContent(
        '<!doctype html><html><body style="margin:0;background:#fff"><div id="out" style="display:inline-block;padding:8px;background:#fff"></div></body></html>',
      );
      await page.addScriptTag({ path: mermaidScript });
      const raw: unknown = await withTimeout(
        page.evaluate(`(${RENDER_IN_PAGE})(${JSON.stringify({ source, id })})`),
        "diagram render",
      );
      const result = pageResult.parse(raw);
      if ("error" in result) return { error: result.error.slice(0, MAX_ERROR_CHARS) };
      const png = await page.locator("#out").screenshot({ type: "png" });
      return { svg: result.svg, png };
    });
  }

  /** A4 PDF from self-contained HTML, with JavaScript disabled. */
  async pdf(html: string, chrome: { headerTemplate: string; footerTemplate: string }) {
    return this.withContext({ javaScriptEnabled: false }, async (context) => {
      const page = await context.newPage();
      await withTimeout(page.setContent(html, { waitUntil: "load" }), "pdf layout");
      return page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        ...chrome,
        margin: { top: "20mm", bottom: "20mm", left: "20mm", right: "20mm" },
      });
    });
  }

  async close(): Promise<void> {
    const browser = await this.browser?.catch(() => null);
    this.browser = null;
    await browser?.close();
  }
}
