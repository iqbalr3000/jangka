import { auditLogs, collectionGrants, collections, requirements, templates } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { collectionDocumentList } from "@jangka/shared/access";
import { chatThread } from "@jangka/shared/assistant";
import { documentDetail } from "@jangka/shared/document";
import { traceResponse } from "@jangka/shared/trace";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureBuiltinTemplates } from "../src/services/templates";
import {
  ADMIN,
  buildApp,
  call,
  captureSetupToken,
  createUser,
  login,
  setupInstance,
  type TestApp,
  testDatabase,
} from "./helpers";

const { db, pool } = testDatabase();
afterAll(() => pool.end());

let app: TestApp;

beforeEach(async () => {
  await truncateAll(pool);
  app = buildApp(db, pool).app;
});

const examplesCollections = () => db.select().from(collections);

async function documentsIn(collectionId: string, cookie: string) {
  const res = await call(app, "GET", `/collections/${collectionId}/documents`, { cookie });
  expect(res.status).toBe(200);
  return collectionDocumentList.parse(await res.json()).items;
}

async function rina() {
  await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
  return login(app, "rina@acme.co", "rina-password-123");
}

describe("examples at setup", () => {
  it("creates a linked BRD → PRD → TSD in an Examples collection everyone can view", async () => {
    const admin = await setupInstance(app, db, { examples: true });
    const [examples] = (await examplesCollections()).filter((c) => c.name === "Examples");
    if (!examples) throw new Error("Examples collection missing");
    const grants = await db
      .select()
      .from(collectionGrants)
      .where(eq(collectionGrants.collectionId, examples.id));
    expect(grants.map((g) => g.level)).toEqual(["view"]);

    // A plain member sees all three, with nothing else granted.
    const member = await rina();
    const listed = await documentsIn(examples.id, member);
    expect(listed.map((d) => d.docType).sort()).toEqual(["brd", "prd", "tsd"]);
    expect(listed.every((d) => d.completeness.every((c) => c === "complete"))).toBe(true);

    const byType = new Map(listed.map((d) => [d.docType, d.id]));
    const tsd = documentDetail.parse(
      await (await call(app, "GET", `/documents/${byType.get("tsd")}`, { cookie: admin })).json(),
    );
    expect(tsd.source).toMatchObject({ id: byType.get("prd") });
    expect(tsd.sections.every((s) => s.revision === 1)).toBe(true);

    // Complete content reads as full coverage in the assistant panel.
    const chat = chatThread.parse(
      await (
        await call(app, "GET", `/documents/${byType.get("prd")}/chat`, { cookie: member })
      ).json(),
    );
    // Every section of the PRD template (the panel showed "COVERAGE 0/12" before).
    expect(chat.state?.sections).toHaveLength(12);
    expect(chat.state?.sections.every((s) => s.coverage === "covered")).toBe(true);
    expect(chat.messages).toEqual([]);

    const counts = await db.select().from(requirements);
    const prefixes = counts.map((r) => r.code.split("-")[0]);
    expect(prefixes.filter((p) => p === "BR")).toHaveLength(6);
    expect(prefixes.filter((p) => p === "FR")).toHaveLength(7);
    expect(prefixes.filter((p) => p === "NFR")).toHaveLength(4);
    expect(prefixes.filter((p) => p === "TR")).toHaveLength(6);

    // Every upstream code in the PRD and TSD resolves to a real requirement.
    for (const type of ["prd", "tsd"] as const) {
      const trace = traceResponse.parse(
        await (
          await call(app, "GET", `/documents/${byType.get(type)}/trace`, { cookie: member })
        ).json(),
      );
      const refs = trace.requirements.flatMap((r) => r.upstream);
      expect(refs.length).toBeGreaterThan(0);
      expect(refs.every((ref) => ref.status === "linked")).toBe(true);
    }

    const [logged] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "samples.create"));
    expect(logged?.targetId).toBe(examples.id);
  });

  it("creates nothing when unchecked", async () => {
    await setupInstance(app, db, { examples: false });
    expect((await examplesCollections()).some((c) => c.name === "Examples")).toBe(false);
  });

  it("setup still succeeds when the examples can't be created", async () => {
    await ensureBuiltinTemplates(db);
    // No TSD template: seeding fails inside its own transaction.
    await db.delete(templates).where(eq(templates.docType, "tsd"));
    const token = await captureSetupToken(db);
    const res = await call(app, "POST", "/setup", {
      body: {
        token,
        orgName: "Acme",
        adminName: ADMIN.name,
        adminEmail: ADMIN.email,
        password: ADMIN.password,
        examples: true,
      },
    });
    expect(res.status).toBe(201);
    expect((await examplesCollections()).some((c) => c.name === "Examples")).toBe(false);
  });
});

describe("POST /admin/samples", () => {
  it("adds another set, named so it doesn't clash", async () => {
    const admin = await setupInstance(app, db, { examples: true });
    const res = await call(app, "POST", "/admin/samples", { cookie: admin });
    expect(res.status).toBe(201);
    const { collectionId } = (await res.json()) as { collectionId: string };
    const [created] = await db.select().from(collections).where(eq(collections.id, collectionId));
    expect(created?.name).toBe("Examples 2");
    expect(await documentsIn(collectionId, admin)).toHaveLength(3);
  });

  it("is admin only", async () => {
    await setupInstance(app, db);
    const member = await rina();
    expect((await call(app, "POST", "/admin/samples", { cookie: member })).status).toBe(403);
  });
});
