import { collectionGrants, collections, groups } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import {
  accessCheck,
  archivedCollectionList,
  collectionDetail,
  collectionList,
  collectionSummary,
  type Level,
  permissionGraph,
} from "@jangka/shared/access";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN,
  buildApp,
  call,
  createUser,
  login,
  setupInstance,
  type TestApp,
  testDatabase,
} from "./helpers";

const { db, pool } = testDatabase();
afterAll(() => pool.end());

const RINA = { name: "Rina", email: "rina@acme.co", password: "rina-password-123" };

let app: TestApp;
let adminCookie: string;
let rinaId: string;
let rinaCookie: string;
let allUsers: string;
beforeEach(async () => {
  await truncateAll(pool);
  app = buildApp(db, pool).app;
  adminCookie = await setupInstance(app, db);
  rinaId = await createUser(db, RINA);
  rinaCookie = await login(app, RINA.email, RINA.password);
  const [row] = await db.select().from(groups).where(eq(groups.systemKey, "all_users"));
  allUsers = row?.id ?? "";
});

async function create(name: string, parentId: string | null, cookie = adminCookie) {
  const res = await call(app, "POST", "/collections", { cookie, body: { name, parentId } });
  expect(res.status).toBe(201);
  return collectionSummary.parse(await res.json()).id;
}

async function grant(collectionId: string | null, level: Level | null, groupId = allUsers) {
  const res = await call(app, "PUT", "/admin/permissions", {
    cookie: adminCookie,
    body: { changes: [{ collectionId, groupId, level }] },
  });
  expect(res.status).toBe(200);
  return permissionGraph.parse(await res.json());
}

async function tree(cookie: string) {
  const res = await call(app, "GET", "/collections", { cookie });
  expect(res.status).toBe(200);
  return collectionList.parse(await res.json());
}

async function items(id: string, cookie: string) {
  return call(app, "GET", `/collections/${id}/items`, { cookie });
}

describe("personal collections", () => {
  it("are created for the setup admin and invited users", async () => {
    const rows = await db.select().from(collections);
    expect(rows.map((r) => r.name).sort()).toEqual([
      "Ada Admin's personal collection",
      "Rina's personal collection",
    ]);
    const invite = await call(app, "POST", "/admin/invites", {
      cookie: adminCookie,
      body: { email: "budi@acme.co" },
    });
    const { url } = (await invite.json()) as { url: string };
    await call(app, "POST", `/invites/${url.split("/invite/")[1]}/accept`, {
      body: { name: "Budi", password: "budi-password-123" },
    });
    expect(await db.select().from(collections)).toHaveLength(3);
  });

  it("are private to the owner (and admins), and can hold sub-collections", async () => {
    await grant(null, "edit");
    const res = await call(app, "GET", "/collections/personal", { cookie: rinaCookie });
    const personal = collectionDetail.parse(await res.json());
    expect(personal.access).toEqual({ level: "edit", reason: { kind: "owner" } });
    const personalId = personal.collection?.id ?? "";

    const drafts = await create("Drafts", personalId, rinaCookie);
    expect((await items(drafts, rinaCookie)).status).toBe(200);

    expect((await items(personalId, adminCookie)).status).toBe(200);
    const adaTree = await tree(adminCookie);
    expect(adaTree.items.map((i) => i.id)).not.toContain(personalId);

    const budiId = await createUser(db, { ...RINA, name: "Budi", email: "budi@acme.co" });
    const budi = await login(app, "budi@acme.co", RINA.password);
    expect((await items(personalId, budi)).status).toBe(404);
    expect((await items(drafts, budi)).status).toBe(404);
    expect(budiId).toBeTruthy();
  });

  it("can't be renamed, moved or archived", async () => {
    const personal = collectionDetail.parse(
      await (await call(app, "GET", "/collections/personal", { cookie: rinaCookie })).json(),
    );
    const id = personal.collection?.id ?? "";
    const rename = await call(app, "PATCH", `/collections/${id}`, {
      cookie: rinaCookie,
      body: { name: "Mine" },
    });
    expect(rename.status).toBe(409);
    expect(
      (await call(app, "POST", `/collections/${id}/archive`, { cookie: rinaCookie })).status,
    ).toBe(409);
  });

  it("can't receive grants", async () => {
    const [row] = await db
      .select()
      .from(collections)
      .where(eq(collections.personalOwnerId, rinaId));
    const res = await call(app, "PUT", "/admin/permissions", {
      cookie: adminCookie,
      body: { changes: [{ collectionId: row?.id, groupId: allUsers, level: "view" }] },
    });
    expect(res.status).toBe(400);
  });
});

describe("collections", () => {
  it("hides everything from members until granted (root has no grant by default)", async () => {
    const platform = await create("Platform", null);
    const before = await tree(rinaCookie);
    expect(before.rootLevel).toBe("none");
    expect(before.items.filter((i) => i.personalOwnerId === null)).toHaveLength(0);
    expect((await items(platform, rinaCookie)).status).toBe(404);

    await grant(platform, "view");
    const after = await tree(rinaCookie);
    expect(after.items.find((i) => i.id === platform)?.level).toBe("view");
    const detail = collectionDetail.parse(await (await items(platform, rinaCookie)).json());
    expect(detail.access).toEqual({
      level: "view",
      reason: {
        kind: "grant",
        groupId: allUsers,
        groupName: "All Users",
        collectionId: platform,
        collectionName: "Platform",
      },
    });
  });

  it("requires edit on the parent to create", async () => {
    const platform = await create("Platform", null);
    await grant(platform, "view");
    const res = await call(app, "POST", "/collections", {
      cookie: rinaCookie,
      body: { name: "Mine", parentId: platform },
    });
    expect(res.status).toBe(403);
    const atRoot = await call(app, "POST", "/collections", {
      cookie: rinaCookie,
      body: { name: "Mine", parentId: null },
    });
    expect(atRoot.status).toBe(403);

    await grant(platform, "edit");
    await create("Payments", platform, rinaCookie);
  });

  it("returns 404 when creating under an invisible parent", async () => {
    const secret = await create("Secret", null);
    const res = await call(app, "POST", "/collections", {
      cookie: rinaCookie,
      body: { name: "X", parentId: secret },
    });
    expect(res.status).toBe(404);
  });

  it("lifts a visible collection whose parent is invisible and doesn't leak the parent", async () => {
    const platform = await create("Platform", null);
    const payments = await create("Payments", platform);
    await grant(payments, "view");
    const { items: list } = await tree(rinaCookie);
    const shared = list.filter((i) => i.personalOwnerId === null);
    expect(shared).toEqual([expect.objectContaining({ id: payments, parentId: null })]);

    const detail = collectionDetail.parse(await (await items(payments, rinaCookie)).json());
    expect(detail.breadcrumbs).toEqual([]);
    expect(JSON.stringify(detail)).not.toContain("Platform");

    const root = collectionDetail.parse(await (await items("root", rinaCookie)).json());
    expect(root.children.map((c) => c.id)).toEqual([payments]);
  });

  it("renames with edit, forbids with view", async () => {
    const platform = await create("Platform", null);
    await grant(platform, "view");
    const denied = await call(app, "PATCH", `/collections/${platform}`, {
      cookie: rinaCookie,
      body: { name: "X" },
    });
    expect(denied.status).toBe(403);
    await grant(platform, "edit");
    const ok = await call(app, "PATCH", `/collections/${platform}`, {
      cookie: rinaCookie,
      body: { name: "Platform 2" },
    });
    expect(ok.status).toBe(200);
    expect(collectionSummary.parse(await ok.json()).name).toBe("Platform 2");
  });

  it("refuses moving a collection into its own descendant", async () => {
    const platform = await create("Platform", null);
    const payments = await create("Payments", platform);
    const res = await call(app, "PATCH", `/collections/${platform}`, {
      cookie: adminCookie,
      body: { parentId: payments },
    });
    expect(res.status).toBe(409);
  });

  it("requires edit on the destination to move", async () => {
    const product = await create("Product", null);
    const platform = await create("Platform", null);
    const payments = await create("Payments", platform);
    await grant(platform, "edit");
    await grant(product, "view");
    const res = await call(app, "PATCH", `/collections/${payments}`, {
      cookie: rinaCookie,
      body: { parentId: product },
    });
    expect(res.status).toBe(403);
    await grant(product, "edit");
    const ok = await call(app, "PATCH", `/collections/${payments}`, {
      cookie: rinaCookie,
      body: { parentId: product },
    });
    expect(ok.status).toBe(200);
  });

  it("drops grants of a subtree moved into a personal collection", async () => {
    const platform = await create("Platform", null);
    const payments = await create("Payments", platform);
    // Moving needs edit on the current parent (root) too.
    await grant(null, "edit");
    await grant(payments, "view");
    const [personal] = await db
      .select()
      .from(collections)
      .where(eq(collections.personalOwnerId, rinaId));

    const res = await call(app, "PATCH", `/collections/${platform}`, {
      cookie: rinaCookie,
      body: { parentId: personal?.id },
    });
    expect(res.status).toBe(200);
    const left = await db.select().from(collectionGrants);
    expect(left.map((g) => g.collectionId)).toEqual([null]);

    const budiId = await createUser(db, { ...RINA, name: "Budi", email: "budi@acme.co" });
    expect(budiId).toBeTruthy();
    const budi = await login(app, "budi@acme.co", RINA.password);
    expect((await items(payments, budi)).status).toBe(404);
  });

  it("archives and restores; archived subtrees leave the tree", async () => {
    const platform = await create("Platform", null);
    const payments = await create("Payments", platform);
    await grant(null, "edit");

    expect(
      (await call(app, "POST", `/collections/${platform}/archive`, { cookie: rinaCookie })).status,
    ).toBe(204);
    const ids = (await tree(rinaCookie)).items.map((i) => i.id);
    expect(ids).not.toContain(platform);
    expect(ids).not.toContain(payments);

    const archived = archivedCollectionList.parse(
      await (await call(app, "GET", "/collections/archived", { cookie: rinaCookie })).json(),
    );
    expect(archived.items.map((i) => i.id)).toEqual([platform]);

    // Archive is not a permission change.
    expect((await items(payments, rinaCookie)).status).toBe(200);

    await call(app, "POST", `/collections/${payments}/archive`, { cookie: rinaCookie });
    const blocked = await call(app, "POST", `/collections/${payments}/restore`, {
      cookie: rinaCookie,
    });
    expect(blocked.status).toBe(409);

    await call(app, "POST", `/collections/${platform}/restore`, { cookie: rinaCookie });
    await call(app, "POST", `/collections/${payments}/restore`, { cookie: rinaCookie });
    const restored = (await tree(rinaCookie)).items.map((i) => i.id);
    expect(restored).toEqual(expect.arrayContaining([platform, payments]));
  });

  it("can't create inside an archived collection", async () => {
    const platform = await create("Platform", null);
    await call(app, "POST", `/collections/${platform}/archive`, { cookie: adminCookie });
    const res = await call(app, "POST", "/collections", {
      cookie: adminCookie,
      body: { name: "X", parentId: platform },
    });
    expect(res.status).toBe(409);
  });
});

describe("admin permissions", () => {
  it("applies a diff, resets to inherit with null, and returns the graph", async () => {
    const platform = await create("Platform", null);
    let graph = await grant(null, "view");
    graph = await grant(platform, "none");
    expect(graph.grants).toEqual(
      expect.arrayContaining([
        { collectionId: null, groupId: allUsers, level: "view" },
        { collectionId: platform, groupId: allUsers, level: "none" },
      ]),
    );
    expect((await items(platform, rinaCookie)).status).toBe(404);

    graph = await grant(platform, null);
    expect(graph.grants).toEqual([{ collectionId: null, groupId: allUsers, level: "view" }]);
    expect((await items(platform, rinaCookie)).status).toBe(200);
  });

  it("updates an existing root grant instead of duplicating it", async () => {
    await grant(null, "view");
    await grant(null, "edit");
    const rows = await db.select().from(collectionGrants);
    expect(rows).toEqual([expect.objectContaining({ collectionId: null, level: "edit" })]);
  });

  it("rejects grants for Administrators and unknown groups", async () => {
    const [admins] = await db.select().from(groups).where(eq(groups.systemKey, "admins"));
    const res = await call(app, "PUT", "/admin/permissions", {
      cookie: adminCookie,
      body: { changes: [{ collectionId: null, groupId: admins?.id, level: "view" }] },
    });
    expect(res.status).toBe(400);
    const unknown = await call(app, "PUT", "/admin/permissions", {
      cookie: adminCookie,
      body: {
        changes: [
          { collectionId: null, groupId: "0190c3a4-0000-7000-8000-000000000000", level: "view" },
        ],
      },
    });
    expect(unknown.status).toBe(404);
  });

  it("lists shared collections only (no personal ones)", async () => {
    await create("Platform", null);
    const graph = permissionGraph.parse(
      await (await call(app, "GET", "/admin/permissions", { cookie: adminCookie })).json(),
    );
    expect(graph.collections.map((c) => c.name)).toEqual(["Platform"]);
    expect(graph.groups.map((g) => g.name)).toEqual(["Administrators", "All Users"]);
  });

  it("checks a user's effective access with reasons", async () => {
    const platform = await create("Platform", null);
    await grant(null, "view");
    await grant(platform, "edit");
    const res = await call(app, "GET", `/admin/permissions/check?userId=${rinaId}`, {
      cookie: adminCookie,
    });
    const check = accessCheck.parse(await res.json());
    expect(check.user).toMatchObject({ email: RINA.email, isAdmin: false });
    expect(check.root.level).toBe("view");
    expect(check.collections).toEqual([
      expect.objectContaining({
        id: platform,
        level: "edit",
        reason: expect.objectContaining({ kind: "grant", groupName: "All Users" }),
      }),
    ]);

    const me = (await (await call(app, "GET", "/auth/me", { cookie: adminCookie })).json()) as {
      user: { id: string; email: string };
    };
    expect(me.user.email).toBe(ADMIN.email);
    const adminCheck = accessCheck.parse(
      await (
        await call(app, "GET", `/admin/permissions/check?userId=${me.user.id}`, {
          cookie: adminCookie,
        })
      ).json(),
    );
    expect(adminCheck.root).toEqual({ level: "edit", reason: { kind: "admin" } });
  });

  it("is admin-only", async () => {
    expect((await call(app, "GET", "/admin/permissions", { cookie: rinaCookie })).status).toBe(403);
  });
});
