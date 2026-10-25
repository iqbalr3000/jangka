import { documentExports, groups } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { collectionSummary } from "@jangka/shared/access";
import { documentSummary } from "@jangka/shared/document";
import { exportJob } from "@jangka/shared/export";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildApp,
  call,
  createUser,
  login,
  type RecordingQueue,
  setupInstance,
  type TestApp,
  testDatabase,
} from "./helpers";

const { db, pool } = testDatabase();
afterAll(async () => {
  await pool.end();
});

let app: TestApp;
let queue: RecordingQueue;
let admin: string;
let rina: string;
let collectionId: string;
let docId: string;

async function grantAllUsers(level: "view" | "none") {
  const [allUsers] = await db.select().from(groups).where(eq(groups.systemKey, "all_users"));
  const res = await call(app, "PUT", "/admin/permissions", {
    cookie: admin,
    body: { changes: [{ collectionId, groupId: allUsers?.id, level }] },
  });
  expect(res.status).toBe(200);
}

beforeEach(async () => {
  await truncateAll(pool);
  const built = buildApp(db, pool);
  app = built.app;
  queue = built.queue as RecordingQueue;
  admin = await setupInstance(app, db);
  const collection = await call(app, "POST", "/collections", {
    cookie: admin,
    body: { name: "Platform", parentId: null },
  });
  collectionId = collectionSummary.parse(await collection.json()).id;
  const doc = await call(app, "POST", "/documents", {
    cookie: admin,
    body: { title: "Refunds", collectionId, docType: "prd" },
  });
  docId = documentSummary.parse(await doc.json()).id;
  await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
  rina = await login(app, "rina@acme.co", "rina-password-123");
});

async function requestExport(cookie: string, body: unknown = { format: "pdf" }) {
  return call(app, "POST", `/documents/${docId}/exports`, { cookie, body });
}

async function finish(id: string, overrides: Partial<typeof documentExports.$inferInsert> = {}) {
  await db
    .update(documentExports)
    .set({ status: "done", file: Buffer.from("%PDF-1.7"), fileName: "refunds.pdf", ...overrides })
    .where(eq(documentExports.id, id));
}

describe("create", () => {
  it("queues an export for a viewer and returns it", async () => {
    await grantAllUsers("view");
    const res = await requestExport(rina, { format: "docx", includeCover: false });
    expect(res.status).toBe(202);
    const job = exportJob.parse(await res.json());
    expect(job).toMatchObject({ documentId: docId, format: "docx", status: "queued" });
    expect(new Date(job.expiresAt).getTime() - new Date(job.createdAt).getTime()).toBeCloseTo(
      24 * 60 * 60 * 1000,
      -4,
    );
    expect(queue.sent).toEqual([{ name: "export.run", payload: { exportId: job.id } }]);
    const [row] = await db.select().from(documentExports);
    expect(row?.includeCover).toBe(false);
  });

  it("is not found without view access", async () => {
    const res = await requestExport(rina);
    expect(res.status).toBe(404);
    expect(queue.sent).toEqual([]);
  });

  it("refuses an archived document and invalid formats", async () => {
    expect((await requestExport(admin, { format: "odt" })).status).toBe(400);
    await call(app, "POST", `/documents/${docId}/archive`, { cookie: admin });
    const res = await requestExport(admin);
    expect(res.status).toBe(409);
  });
});

describe("status and download", () => {
  it("are only for the requester", async () => {
    await grantAllUsers("view");
    const job = exportJob.parse(await (await requestExport(admin)).json());
    expect((await call(app, "GET", `/exports/${job.id}`, { cookie: rina })).status).toBe(404);
    await finish(job.id);
    const download = await call(app, "GET", `/exports/${job.id}/download`, { cookie: rina });
    expect(download.status).toBe(404);
  });

  it("downloads when done, with an attachment name", async () => {
    const job = exportJob.parse(await (await requestExport(admin)).json());
    const early = await call(app, "GET", `/exports/${job.id}/download`, { cookie: admin });
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: { code: "export_not_ready" } });

    await finish(job.id);
    const status = await call(app, "GET", `/exports/${job.id}`, { cookie: admin });
    expect(exportJob.parse(await status.json())).toMatchObject({
      status: "done",
      fileName: "refunds.pdf",
    });
    const res = await call(app, "GET", `/exports/${job.id}/download`, { cookie: admin });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="refunds.pdf"; filename*=UTF-8''refunds.pdf`,
    );
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.7");
  });

  it("is gone after 24 hours", async () => {
    const job = exportJob.parse(await (await requestExport(admin)).json());
    await finish(job.id, { expiresAt: new Date(Date.now() - 1000) });
    const res = await call(app, "GET", `/exports/${job.id}/download`, { cookie: admin });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: { code: "export_expired" } });
  });

  it("stops once the requester loses view access", async () => {
    await grantAllUsers("view");
    const job = exportJob.parse(await (await requestExport(rina)).json());
    await finish(job.id);
    expect((await call(app, "GET", `/exports/${job.id}/download`, { cookie: rina })).status).toBe(
      200,
    );
    await grantAllUsers("none");
    expect((await call(app, "GET", `/exports/${job.id}/download`, { cookie: rina })).status).toBe(
      404,
    );
    expect((await call(app, "GET", `/exports/${job.id}`, { cookie: rina })).status).toBe(404);
  });
});
