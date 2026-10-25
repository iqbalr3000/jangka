import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { diagramRenders, documentExports } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { diagramHash } from "@jangka/export/render";
import { eq } from "drizzle-orm";
import JSZip from "jszip";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "../src/cleanup";
import { renderDiagram } from "../src/diagrams";
import { exportFileName, markFailed, runExport } from "../src/export-job";
import { Renderer } from "../src/renderer";
import { createExport, DIAGRAMS, seedDocument, testDatabase } from "./fixtures";

const { db, pool } = testDatabase();
const renderer = new Renderer();
afterAll(async () => {
  await renderer.close();
  await pool.end();
});
beforeEach(async () => {
  await truncateAll(pool);
});

const VALID = DIAGRAMS[0] ?? "";
const BROKEN = "flowchart TD\n  A -->";

describe("diagram render", () => {
  it("caches SVG and a 2x PNG for a valid diagram", async () => {
    const result = await renderDiagram(db, renderer, VALID);
    expect("svg" in result && result.svg).toContain("<svg");
    expect("png" in result && result.png.subarray(1, 4).toString()).toBe("PNG");
    const [row] = await db.select().from(diagramRenders);
    expect(row?.sourceHash).toBe(diagramHash(VALID));
    expect(row?.error).toBeNull();
  });

  it("caches the error of a broken diagram and never renders it twice", async () => {
    const spy = vi.spyOn(renderer, "renderDiagram");
    const first = await renderDiagram(db, renderer, BROKEN);
    expect("error" in first && first.error.length).toBeGreaterThan(0);
    const second = await renderDiagram(db, renderer, BROKEN);
    expect(second).toEqual(first);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("blocks network requests from rendered pages", async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.end("x");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const pdf = await renderer.pdf(
        `<html><body><img src="http://127.0.0.1:${port}/leak.png"><link rel="stylesheet" href="http://127.0.0.1:${port}/x.css">Hi</body></html>`,
        { headerTemplate: "<span></span>", footerTemplate: "<span></span>" },
      );
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });
});

describe("export.run", () => {
  it("exports the baseline PRD (3 diagrams + 30-row table) to PDF", async () => {
    const seeded = await seedDocument(db);
    const id = await createExport(db, { ...seeded, format: "pdf" });
    await runExport(db, renderer, id);
    const [row] = await db.select().from(documentExports).where(eq(documentExports.id, id));
    expect(row).toMatchObject({ status: "done", fileName: "refund-self-service.pdf" });
    const pdf = row?.file ?? Buffer.alloc(0);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    const pages = pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
    expect(pages.length).toBeGreaterThan(2);
    expect(await db.select().from(diagramRenders)).toHaveLength(3);
  });

  it("exports the baseline PRD to DOCX with 3 images and the full table", async () => {
    const seeded = await seedDocument(db);
    const id = await createExport(db, { ...seeded, format: "docx" });
    await runExport(db, renderer, id);
    const [row] = await db.select().from(documentExports).where(eq(documentExports.id, id));
    expect(row?.fileName).toBe("refund-self-service.docx");
    const zip = await JSZip.loadAsync(row?.file ?? Buffer.alloc(0));
    const images = Object.keys(zip.files).filter((f) => /^word\/media\/.+\.png$/.test(f));
    expect(images).toHaveLength(3);
    const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
    expect(xml.match(/<w:tr>/g)).toHaveLength(31);
    expect(xml).toContain("FR-030");
    expect(xml.match(/Not yet specified\./g)?.length).toBeGreaterThan(0);
  });

  it("marks a failed export with a generic message", async () => {
    const seeded = await seedDocument(db);
    const id = await createExport(db, { ...seeded, format: "pdf" });
    await markFailed(db, id);
    const [row] = await db.select().from(documentExports).where(eq(documentExports.id, id));
    expect(row).toMatchObject({
      status: "failed",
      error: "The export could not be generated. Try again.",
    });
  });
});

describe("cleanup", () => {
  it("deletes expired exports and stale renders only", async () => {
    const seeded = await seedDocument(db);
    const expired = await createExport(db, {
      ...seeded,
      format: "pdf",
      expiresAt: new Date(Date.now() - 1000),
    });
    const fresh = await createExport(db, { ...seeded, format: "pdf" });
    await db.insert(diagramRenders).values([
      { sourceHash: "old", error: "x", createdAt: new Date(Date.now() - 31 * 86_400_000) },
      { sourceHash: "new", error: "x" },
    ]);
    expect(await cleanup(db)).toEqual({ exports: 1, renders: 1 });
    const ids = (await db.select().from(documentExports)).map((r) => r.id);
    expect(ids).toEqual([fresh]);
    expect(ids).not.toContain(expired);
    expect((await db.select().from(diagramRenders)).map((r) => r.sourceHash)).toEqual(["new"]);
  });
});

describe("file names", () => {
  it("slugs the title and falls back to document", () => {
    expect(exportFileName("Refund self-service", "pdf")).toBe("refund-self-service.pdf");
    expect(exportFileName("Résumé: Q4 / plan!", "docx")).toBe("resume-q4-plan.docx");
    expect(exportFileName("日本語", "pdf")).toBe("document.pdf");
  });
});
