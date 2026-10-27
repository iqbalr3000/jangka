import { groups } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { collectionSummary } from "@jangka/shared/access";
import { documentSummary } from "@jangka/shared/document";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildApp,
  call,
  createUser,
  login,
  setupInstance,
  type TestApp,
  testDatabase,
} from "../test/helpers";

// NFR-007: collection browser and document open < 500 ms p95 for up to 5,000 documents.
const DOCUMENTS = 5000;
const COLLECTIONS = 10;
const SAMPLES = 40;
const BUDGET_MS = 500;

const { db, pool } = testDatabase();
afterAll(() => pool.end());

let app: TestApp;
let member: string;
const collectionIds: string[] = [];
const documentIds: string[] = [];

async function p95(label: string, request: () => Promise<Response> | Response): Promise<number> {
  for (let i = 0; i < 5; i++) await request();
  const times: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const start = performance.now();
    const res = await request();
    times.push(performance.now() - start);
    expect(res.status).toBe(200);
  }
  times.sort((a, b) => a - b);
  const at = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0;
  process.stdout.write(
    `${label.padEnd(34)} p50 ${at(0.5).toFixed(1)} ms   p95 ${at(0.95).toFixed(1)} ms\n`,
  );
  return at(0.95);
}

beforeAll(async () => {
  await truncateAll(pool);
  app = buildApp(db, pool).app;
  const admin = await setupInstance(app, db);
  await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
  member = await login(app, "rina@acme.co", "rina-password-123");
  const [allUsers] = await db.select().from(groups).where(eq(groups.systemKey, "all_users"));
  if (!allUsers) throw new Error("all_users group missing");

  for (let i = 0; i < COLLECTIONS; i++) {
    const res = await call(app, "POST", "/collections", {
      cookie: admin,
      body: { name: `Team ${i + 1}`, parentId: null },
    });
    collectionIds.push(collectionSummary.parse(await res.json()).id);
  }
  // The member sees everything through a group grant, so the permission resolver does real work.
  await call(app, "PUT", "/admin/permissions", {
    cookie: admin,
    body: {
      changes: collectionIds.map((collectionId) => ({
        collectionId,
        groupId: allUsers.id,
        level: "view",
      })),
    },
  });

  for (let i = 0; i < DOCUMENTS; i++) {
    const res = await call(app, "POST", "/documents", {
      cookie: admin,
      body: {
        title: `Spec ${i + 1}`,
        collectionId: collectionIds[i % COLLECTIONS],
        docType: (["brd", "prd", "tsd"] as const)[i % 3],
      },
    });
    documentIds.push(documentSummary.parse(await res.json()).id);
  }
  // ~1.5 KB per section so document open reads realistic rows.
  const paragraph = "Refunds are issued within five business days of an approved request. ".repeat(
    20,
  );
  await db.execute(sql`
    update document_sections set
      content_md = ${paragraph},
      content = ${JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: paragraph }] }],
      })}::jsonb,
      completeness = 'partial'
  `);
  await db.execute(sql`analyze`);
}, 600_000);

describe(`${DOCUMENTS} documents in ${COLLECTIONS} collections (member with a group grant)`, () => {
  it("stays within the NFR-007 budget", async () => {
    const id = collectionIds[0];
    const doc = documentIds[Math.floor(DOCUMENTS / 2)];
    const results = [
      await p95("collection tree with counts", () =>
        call(app, "GET", "/collections", { cookie: member }),
      ),
      await p95(`collection items (${DOCUMENTS / COLLECTIONS} docs)`, () =>
        call(app, "GET", `/collections/${id}/items`, { cookie: member }),
      ),
      await p95("document open", () => call(app, "GET", `/documents/${doc}`, { cookie: member })),
    ];
    for (const value of results) expect(value).toBeLessThan(BUDGET_MS);
  }, 120_000);
});
