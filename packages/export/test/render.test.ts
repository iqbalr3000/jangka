import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { mapMermaid, mermaidBlocks } from "../src/index";
import { diagramHash, pdfChrome, pngSize, toDocx, toHtml } from "../src/render/index";
import { BROKEN_DIAGRAM, everyNode, input, TINY_PNG, VALID_DIAGRAM } from "./fixtures";

const html = (overrides = {}) => toHtml(input(overrides), { fontCss: "" });

describe("mermaid helpers", () => {
  it("lists sources in order and maps them at any depth", () => {
    expect(mermaidBlocks(everyNode)).toEqual([VALID_DIAGRAM, BROKEN_DIAGRAM]);
    const nested = {
      type: "doc" as const,
      content: [
        {
          type: "blockquote" as const,
          content: [{ type: "mermaidBlock" as const, attrs: { source: "graph TD" } }],
        },
      ],
    };
    expect(mermaidBlocks(mapMermaid(nested, (s) => `${s}\n  A --> B`))).toEqual([
      "graph TD\n  A --> B",
    ]);
  });

  it("hashes source and theme stably", () => {
    expect(diagramHash("graph TD")).toBe(diagramHash("graph TD", "default"));
    expect(diagramHash("graph TD")).not.toBe(diagramHash("graph LR"));
    expect(diagramHash("graph TD")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("toHtml", () => {
  it("escapes text and attributes", () => {
    const out = html();
    expect(out).toContain("Plain &lt;b&gt;escaped&lt;/b&gt; &amp; ");
    expect(out).toContain('<a href="https://example.com/?a=&quot;1&quot;">link</a>');
    expect(out).toContain("<title>Refunds &lt;self-service&gt;</title>");
    expect(out).not.toContain("<self-service>");
    expect(out).toContain("<pre><code>a &lt; b\nc</code></pre>");
  });

  it("renders marks, headings, lists and quotes", () => {
    const out = html();
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain("<br><code>code</code>");
    expect(out).toContain("<h3>Sub heading</h3><h4>Minor heading</h4>");
    expect(out).toContain("<ul><li><p>One</p><ol><li><p>Nested</p></li></ol></li>");
    expect(out).toContain('<ol start="3">');
    expect(out).toContain("<blockquote><p>Quoted</p></blockquote>");
  });

  it("puts a header row in <thead> so it repeats across pages", () => {
    expect(html()).toContain(
      "<table><thead><tr><th><p>ID</p></th><th><p>Name</p></th></tr></thead><tbody><tr><td>",
    );
  });

  it("numbers figures and falls back to source for failed diagrams", () => {
    const out = html();
    expect(out).toContain('<figure><svg id="d1"><g></g></svg><figcaption>Figure 1 — Overview');
    expect(out).toContain("Diagram could not be rendered: Parse error on line 2");
    expect(out).toContain("flowchart TD\n  A --&gt;</code></pre>");
    expect(out).not.toContain("Figure 2");
  });

  it("prints empty sections as a placeholder, never omits them", () => {
    expect(html()).toContain('<section><h2>Risks</h2><div class="empty">Not yet specified.</div>');
  });

  it("shows a cover page or, without it, the title", () => {
    const withCover = html();
    expect(withCover).toContain('<section class="cover">');
    expect(withCover).toContain("<dt>Last updated</dt><dd>25 Oct 2026</dd>");
    const without = html({ includeCover: false });
    expect(without).not.toContain('class="cover"');
    expect(without).toContain("<main><h1>Refunds &lt;self-service&gt;</h1>");
  });

  it("builds page chrome with escaped title and page counters", () => {
    const { headerTemplate, footerTemplate } = pdfChrome(input().document);
    expect(headerTemplate).toContain("Refunds &lt;self-service&gt;");
    expect(headerTemplate).toContain("PRD · Draft");
    expect(footerTemplate).toContain(
      '<span class="pageNumber"></span> / <span class="totalPages">',
    );
    expect(footerTemplate).toContain("Acme");
  });
});

/** document.xml with generated ids normalized, so the snapshot only tracks structure. */
async function documentXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  return xml
    .replace(/r:(id|embed)="[^"]+"/g, 'r:$1="rId"')
    .replace(/ (id|name)="[^"]*"/g, ' $1=""')
    .replace(/<w:(p|tbl|tr)([ >])/g, "\n<w:$1$2");
}

describe("toDocx", () => {
  it("reads the PNG size from its header", () => {
    expect(pngSize(TINY_PNG)).toEqual({ width: 1, height: 1 });
  });

  it("produces the expected document structure", async () => {
    const buffer = await toDocx(input());
    const zip = await JSZip.loadAsync(buffer);
    expect(Object.keys(zip.files).filter((f) => /^word\/media\/.+\.png$/.test(f))).toHaveLength(1);
    expect(await documentXml(buffer)).toMatchSnapshot();
  });

  it("repeats the table header row and prints placeholders", async () => {
    const xml = await documentXml(await toDocx(input()));
    expect(xml).toContain("<w:tblHeader/>");
    expect(xml).toContain("Not yet specified.");
    expect(xml).toContain("Figure 1 — Overview");
    expect(xml).toContain("Diagram could not be rendered: Parse error on line 2");
  });
});
