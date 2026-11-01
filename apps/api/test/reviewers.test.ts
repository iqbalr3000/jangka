import {
  auditLogs,
  collectionGrants,
  groupMembers,
  groups,
  notifications,
  users,
} from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { documentSummary } from "@jangka/shared/document";
import { errorResponseSchema } from "@jangka/shared/errors";
import { myReviewList, pendingReviewsDetails, reviewerList } from "@jangka/shared/review";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN,
  buildApp,
  call,
  createCollection,
  createUser,
  grantAllUsers,
  login,
  setupInstance,
  type TestApp,
  testDatabase,
} from "./helpers";

const { db, pool } = testDatabase();
afterAll(async () => {
  await pool.end();
});

let app: TestApp;
let admin: string;
let rina: string;
let budi: string;
let ids: { admin: string; rina: string; budi: string; cici: string };
let collectionId: string;
let docId: string;

async function userId(email: string): Promise<string> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!row) throw new Error(`no user ${email}`);
  return row.id;
}

async function newDocument(title: string, collection = collectionId): Promise<string> {
  const res = await call(app, "POST", "/documents", {
    cookie: admin,
    body: { title, collectionId: collection, docType: "prd" },
  });
  return documentSummary.parse(await res.json()).id;
}

beforeEach(async () => {
  await truncateAll(pool);
  app = buildApp(db, pool).app;
  admin = await setupInstance(app, db);
  collectionId = await createCollection(app, admin, "Platform");
  docId = await newDocument("Refund PRD");
  await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
  await createUser(db, { name: "Budi", email: "budi@acme.co", password: "budi-password-123" });
  await createUser(db, {
    name: "Cici",
    email: "cici@acme.co",
    password: "cici-password-123",
    isActive: false,
  });
  rina = await login(app, "rina@acme.co", "rina-password-123");
  budi = await login(app, "budi@acme.co", "budi-password-123");
  ids = {
    admin: await userId(ADMIN.email),
    rina: await userId("rina@acme.co"),
    budi: await userId("budi@acme.co"),
    cici: await userId("cici@acme.co"),
  };
  await grantAllUsers(app, db, admin, collectionId, "view");
});

const assign = (user: string, cookie = admin, doc = docId) =>
  call(app, "PUT", `/documents/${doc}/reviewers/${user}`, { cookie });
const unassign = (user: string, cookie = admin) =>
  call(app, "DELETE", `/documents/${docId}/reviewers/${user}`, { cookie });
const verdict = (cookie: string, value: "approved" | "changes_requested") =>
  call(app, "POST", `/documents/${docId}/review`, { cookie, body: { verdict: value } });
const setStatus = (status: string, cookie = admin) =>
  call(app, "POST", `/documents/${docId}/status`, { cookie, body: { status } });

async function reviewers(cookie = admin) {
  const res = await call(app, "GET", `/documents/${docId}/reviewers`, { cookie });
  expect(res.status).toBe(200);
  return reviewerList.parse(await res.json());
}

async function kindsFor(recipientId: string) {
  const rows = await db
    .select({ kind: notifications.kind, status: notifications.status })
    .from(notifications)
    .where(eq(notifications.recipientId, recipientId))
    .orderBy(notifications.id);
  return rows.map((r) => (r.status ? `${r.kind}:${r.status}` : r.kind));
}

describe("assigning reviewers", () => {
  it("lets editors assign and remove viewers; idempotent; audited", async () => {
    expect((await assign(ids.budi, rina)).status).toBe(403);
    expect((await assign(ids.rina)).status).toBe(204);
    expect((await assign(ids.rina)).status).toBe(204);
    expect((await assign(ids.budi)).status).toBe(204);

    const asAdmin = await reviewers();
    expect(asAdmin.canManage).toBe(true);
    expect(asAdmin.isReviewer).toBe(false);
    expect(asAdmin.items.map((r) => [r.user.name, r.verdict, r.counted])).toEqual([
      ["Rina", null, true],
      ["Budi", null, true],
    ]);
    const asRina = await reviewers(rina);
    expect([asRina.canManage, asRina.isReviewer]).toEqual([false, true]);

    expect((await unassign(ids.budi, rina)).status).toBe(403);
    expect((await unassign(ids.budi)).status).toBe(204);
    expect((await unassign(ids.budi)).status).toBe(204);
    expect((await reviewers()).items.map((r) => r.user.name)).toEqual(["Rina"]);

    const actions = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.targetId, docId));
    expect(actions.map((a) => a.action).filter((a) => a.startsWith("review."))).toEqual([
      "review.assign",
      "review.assign",
      "review.unassign",
    ]);
  });

  it("refuses people who can't view the document or are deactivated", async () => {
    expect((await assign(ids.cici)).status).toBe(400);
    const secret = await createCollection(app, admin, "Secret");
    await grantAllUsers(app, db, admin, secret, "none");
    const secretDoc = await newDocument("Secret PRD", secret);
    expect((await assign(ids.rina, admin, secretDoc)).status).toBe(400);
    expect((await assign("01890a5d-ac96-774b-bcce-b302099a8057")).status).toBe(400);
  });

  it("freezes reviewers once approved", async () => {
    await setStatus("in_review");
    expect((await setStatus("approved")).status).toBe(200);
    const res = await assign(ids.rina);
    expect(res.status).toBe(409);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe("document_approved");
    expect((await reviewers()).canManage).toBe(false);
  });
});

describe("verdicts and the approval gate", () => {
  it("takes verdicts from reviewers only, while in review", async () => {
    await assign(ids.rina);
    expect((await verdict(rina, "approved")).status).toBe(409);
    await setStatus("in_review");
    expect((await verdict(budi, "approved")).status).toBe(403);
    // View access is enough to review.
    expect((await verdict(rina, "changes_requested")).status).toBe(204);
    expect((await reviewers()).items[0]).toMatchObject({ verdict: "changes_requested" });
    expect((await verdict(rina, "approved")).status).toBe(204);
    expect((await reviewers()).items[0]?.decidedAt).not.toBeNull();
  });

  it("blocks approval until every counted reviewer approved", async () => {
    await assign(ids.rina);
    await assign(ids.budi);
    await assign(ids.admin);
    await setStatus("in_review");
    await verdict(rina, "approved");
    await verdict(budi, "changes_requested");

    const blocked = await setStatus("approved");
    expect(blocked.status).toBe(409);
    const { error } = errorResponseSchema.parse(await blocked.json());
    expect(error.code).toBe("pending_reviews");
    expect(pendingReviewsDetails.parse(error.details).reviewers.map((r) => r.name)).toEqual([
      "Budi",
      ADMIN.name,
    ]);

    await verdict(budi, "approved");
    // The approving editor is a reviewer too: no silent self-approval.
    expect((await setStatus("approved")).status).toBe(409);
    await verdict(admin, "approved");
    expect((await setStatus("approved")).status).toBe(200);
  });

  it("doesn't count deactivated reviewers or those who lost access", async () => {
    // Rina views through her own group, so only her access can be revoked.
    await grantAllUsers(app, db, admin, collectionId, "none");
    const [group] = await db.insert(groups).values({ name: "Rina's team" }).returning();
    if (!group) throw new Error("group not created");
    await db.insert(groupMembers).values([
      { groupId: group.id, userId: ids.rina },
      { groupId: group.id, userId: ids.budi },
    ]);
    await db.insert(collectionGrants).values({ collectionId, groupId: group.id, level: "view" });
    await assign(ids.rina);
    await assign(ids.budi);
    await setStatus("in_review");
    expect((await setStatus("approved")).status).toBe(409);

    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, group.id), eq(groupMembers.userId, ids.rina)));
    await db.update(users).set({ isActive: false }).where(eq(users.id, ids.budi));
    expect((await reviewers()).items.map((r) => [r.user.name, r.counted])).toEqual([
      ["Rina", false],
      ["Budi", false],
    ]);
    expect((await setStatus("approved")).status).toBe(200);
  });

  it("applies concurrent status changes one at a time, each from the current status", async () => {
    await setStatus("in_review");
    const results = await Promise.all([setStatus("approved"), setStatus("approved")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const actions = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, docId), eq(auditLogs.action, "document.status")));
    expect(actions).toHaveLength(2);
  });

  it("starts a new round when the document goes back to draft", async () => {
    await assign(ids.rina);
    await setStatus("in_review");
    await verdict(rina, "approved");
    await setStatus("approved");
    await setStatus("draft");
    expect((await reviewers()).items[0]).toMatchObject({ verdict: null, decidedAt: null });

    await setStatus("in_review");
    await verdict(rina, "changes_requested");
    await setStatus("draft");
    expect((await reviewers()).items[0]?.verdict).toBeNull();
  });
});

describe("review notifications", () => {
  it("asks reviewers when review starts or when assigned during review", async () => {
    await assign(ids.rina);
    expect(await kindsFor(ids.rina)).toEqual([]);
    await setStatus("in_review");
    expect(await kindsFor(ids.rina)).toEqual(["review_requested"]);
    await assign(ids.budi);
    expect(await kindsFor(ids.budi)).toEqual(["review_requested"]);
  });

  it("tells the creator about verdict changes", async () => {
    await assign(ids.rina);
    await setStatus("in_review");
    await verdict(rina, "changes_requested");
    await verdict(rina, "changes_requested");
    await verdict(rina, "approved");
    expect(await kindsFor(ids.admin)).toEqual([
      "review_verdict:changes_requested",
      "review_verdict:approved",
    ]);
  });
});

describe("my reviews", () => {
  async function mine(cookie: string) {
    const res = await call(app, "GET", "/reviews", { cookie });
    expect(res.status).toBe(200);
    return myReviewList.parse(await res.json()).items;
  }

  it("lists documents in review waiting for my approval", async () => {
    const other = await newDocument("Checkout PRD");
    await assign(ids.rina);
    await assign(ids.rina, admin, other);
    await assign(ids.budi);
    expect(await mine(rina)).toEqual([]);

    await setStatus("in_review");
    const items = await mine(rina);
    expect(items).toEqual([
      expect.objectContaining({
        id: docId,
        title: "Refund PRD",
        collectionName: "Platform",
        myVerdict: null,
      }),
    ]);
    expect(items[0]?.requestedAt).not.toBeNull();

    await verdict(rina, "changes_requested");
    expect((await mine(rina)).map((r) => r.myVerdict)).toEqual(["changes_requested"]);
    await verdict(rina, "approved");
    expect(await mine(rina)).toEqual([]);
    expect((await mine(budi)).map((r) => r.title)).toEqual(["Refund PRD"]);

    await grantAllUsers(app, db, admin, collectionId, "none");
    expect(await mine(budi)).toEqual([]);
  });
});
