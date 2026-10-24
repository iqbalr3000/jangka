import { collectionGrants, groups } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { group, groupList, groupMemberList } from "@jangka/shared/access";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
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

let app: TestApp;
let adminCookie: string;
beforeEach(async () => {
  await truncateAll(pool);
  app = buildApp(db, pool).app;
  adminCookie = await setupInstance(app, db);
});

const RINA = { name: "Rina", email: "rina@acme.co", password: "rina-password-123" };

async function systemGroupId(key: "admins" | "all_users"): Promise<string> {
  const [row] = await db.select().from(groups).where(eq(groups.systemKey, key));
  if (!row) throw new Error(`${key} missing`);
  return row.id;
}

async function createGroup(name: string): Promise<string> {
  const res = await call(app, "POST", "/admin/groups", { cookie: adminCookie, body: { name } });
  expect(res.status).toBe(201);
  return group.parse(await res.json()).id;
}

async function listGroups() {
  const res = await call(app, "GET", "/admin/groups", { cookie: adminCookie });
  return groupList.parse(await res.json()).items;
}

describe("admin groups", () => {
  it("is admin-only", async () => {
    await createUser(db, RINA);
    const cookie = await login(app, RINA.email, RINA.password);
    expect((await call(app, "GET", "/admin/groups", { cookie })).status).toBe(403);
  });

  it("lists system groups first with member counts", async () => {
    await createUser(db, RINA);
    await createUser(db, { ...RINA, email: "off@acme.co", isActive: false });
    await createGroup("Engineering");
    const items = await listGroups();
    expect(items.map((g) => [g.name, g.systemKey, g.memberCount])).toEqual([
      ["Administrators", "admins", 1],
      ["All Users", "all_users", 2],
      ["Engineering", null, 0],
    ]);
  });

  it("creates, renames and deletes custom groups; names are unique", async () => {
    const id = await createGroup("Engineering");
    const dup = await call(app, "POST", "/admin/groups", {
      cookie: adminCookie,
      body: { name: "Engineering" },
    });
    expect(dup.status).toBe(409);

    const rename = await call(app, "PATCH", `/admin/groups/${id}`, {
      cookie: adminCookie,
      body: { name: "Platform Eng" },
    });
    expect(rename.status).toBe(204);
    expect((await listGroups()).map((g) => g.name)).toContain("Platform Eng");

    const del = await call(app, "DELETE", `/admin/groups/${id}`, { cookie: adminCookie });
    expect(del.status).toBe(204);
    expect((await listGroups()).map((g) => g.name)).not.toContain("Platform Eng");
  });

  it("deleting a group removes its grants", async () => {
    const id = await createGroup("Engineering");
    await call(app, "PUT", "/admin/permissions", {
      cookie: adminCookie,
      body: { changes: [{ collectionId: null, groupId: id, level: "edit" }] },
    });
    await call(app, "DELETE", `/admin/groups/${id}`, { cookie: adminCookie });
    expect(
      await db.select().from(collectionGrants).where(eq(collectionGrants.groupId, id)),
    ).toHaveLength(0);
  });

  it("refuses to rename or delete system groups", async () => {
    const admins = await systemGroupId("admins");
    const allUsers = await systemGroupId("all_users");
    for (const id of [admins, allUsers]) {
      expect(
        (
          await call(app, "PATCH", `/admin/groups/${id}`, {
            cookie: adminCookie,
            body: { name: "X" },
          })
        ).status,
      ).toBe(409);
      expect(
        (await call(app, "DELETE", `/admin/groups/${id}`, { cookie: adminCookie })).status,
      ).toBe(409);
    }
  });
});

describe("group members", () => {
  it("adds (idempotently) and removes members", async () => {
    const rinaId = await createUser(db, RINA);
    const id = await createGroup("Engineering");
    for (let i = 0; i < 2; i++) {
      const res = await call(app, "POST", `/admin/groups/${id}/members`, {
        cookie: adminCookie,
        body: { userId: rinaId },
      });
      expect(res.status).toBe(204);
    }
    let members = groupMemberList.parse(
      await (await call(app, "GET", `/admin/groups/${id}/members`, { cookie: adminCookie })).json(),
    );
    expect(members.implicit).toBe(false);
    expect(members.items.map((m) => m.email)).toEqual([RINA.email]);

    const del = await call(app, "DELETE", `/admin/groups/${id}/members/${rinaId}`, {
      cookie: adminCookie,
    });
    expect(del.status).toBe(204);
    members = groupMemberList.parse(
      await (await call(app, "GET", `/admin/groups/${id}/members`, { cookie: adminCookie })).json(),
    );
    expect(members.items).toHaveLength(0);
  });

  it("rejects unknown users", async () => {
    const id = await createGroup("Engineering");
    const res = await call(app, "POST", `/admin/groups/${id}/members`, {
      cookie: adminCookie,
      body: { userId: "0190c3a4-0000-7000-8000-000000000000" },
    });
    expect(res.status).toBe(404);
  });

  it("All Users lists every active user and can't be edited", async () => {
    const rinaId = await createUser(db, RINA);
    const allUsers = await systemGroupId("all_users");
    const members = groupMemberList.parse(
      await (
        await call(app, "GET", `/admin/groups/${allUsers}/members`, { cookie: adminCookie })
      ).json(),
    );
    expect(members.implicit).toBe(true);
    expect(members.items).toHaveLength(2);
    expect(
      (
        await call(app, "POST", `/admin/groups/${allUsers}/members`, {
          cookie: adminCookie,
          body: { userId: rinaId },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(app, "DELETE", `/admin/groups/${allUsers}/members/${rinaId}`, {
          cookie: adminCookie,
        })
      ).status,
    ).toBe(409);
  });

  it("can't remove yourself from Administrators, but can promote and demote others", async () => {
    const rinaId = await createUser(db, RINA);
    const admins = await systemGroupId("admins");
    const me = (await (await call(app, "GET", "/auth/me", { cookie: adminCookie })).json()) as {
      user: { id: string };
    };
    expect(
      (
        await call(app, "DELETE", `/admin/groups/${admins}/members/${me.user.id}`, {
          cookie: adminCookie,
        })
      ).status,
    ).toBe(409);

    await call(app, "POST", `/admin/groups/${admins}/members`, {
      cookie: adminCookie,
      body: { userId: rinaId },
    });
    const rinaCookie = await login(app, RINA.email, RINA.password);
    expect((await call(app, "GET", "/admin/groups", { cookie: rinaCookie })).status).toBe(200);

    await call(app, "DELETE", `/admin/groups/${admins}/members/${rinaId}`, { cookie: adminCookie });
    expect((await call(app, "GET", "/admin/groups", { cookie: rinaCookie })).status).toBe(403);
  });
});
