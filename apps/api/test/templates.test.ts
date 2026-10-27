import { auditLogs, documents, templates } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import { documentDetail, documentSummary, templateList } from "@jangka/shared/document";
import { templateDetail, templateFamilyList } from "@jangka/shared/templates";
import { and, eq } from "drizzle-orm";
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
afterAll(async () => {
  await pool.end();
});

let app: TestApp;
let admin: string;
let builtinPrdId: string;

beforeEach(async () => {
  await truncateAll(pool);
  app = buildApp(db, pool).app;
  admin = await setupInstance(app, db);
  const [prd] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.docType, "prd"), eq(templates.version, 2)));
  builtinPrdId = prd?.id ?? "";
});

async function req(method: string, path: string, body?: unknown, cookie = admin) {
  return call(app, method, path, { cookie, body });
}

async function duplicate(name = "Acme PRD") {
  const res = await req("POST", `/admin/templates/${builtinPrdId}/duplicate`, { name });
  expect(res.status).toBe(201);
  return templateDetail.parse(await res.json());
}

async function saveDraft(id: string, body: unknown) {
  return req("PUT", `/admin/templates/${id}`, body);
}

const extraSection = {
  title: "Rollout Plan",
  required: false,
  guidance: "Phases and flags.",
  interviewHints: ["How will it roll out?"],
};

describe("template lifecycle", () => {
  it("duplicates, edits, publishes, versions and publishes again", async () => {
    const draft = await duplicate();
    expect(draft).toMatchObject({
      name: "Acme PRD",
      version: 1,
      published: false,
      isBuiltin: false,
    });

    const edited = templateDetail.parse(
      await (
        await saveDraft(draft.id, {
          name: "Acme Product Spec",
          sections: [...draft.sections.slice(0, 3), extraSection, ...draft.sections.slice(3)],
        })
      ).json(),
    );
    expect(edited.name).toBe("Acme Product Spec");
    expect(edited.sections[3]).toMatchObject({ key: "rollout_plan", title: "Rollout Plan" });

    const published = await req("POST", `/admin/templates/${draft.id}/publish`);
    expect(templateDetail.parse(await published.json())).toMatchObject({ published: true });
    // Published versions are frozen, and the family keeps its name from now on.
    expect((await saveDraft(draft.id, { sections: edited.sections })).status).toBe(409);
    expect((await req("DELETE", `/admin/templates/${draft.id}`)).status).toBe(409);

    const next = templateDetail.parse(
      await (await req("POST", `/admin/templates/${draft.id}/new-version`)).json(),
    );
    expect(next).toMatchObject({ version: 2, published: false, familyPublished: true });
    expect((await req("POST", `/admin/templates/${draft.id}/new-version`)).status).toBe(409);
    const renamed = await saveDraft(next.id, { name: "Other", sections: next.sections });
    expect(renamed.status).toBe(409);
    const keepTitle = next.sections.map((s) =>
      s.key === "rollout_plan" ? { ...s, title: "Launch Plan" } : s,
    );
    const saved = templateDetail.parse(
      await (await saveDraft(next.id, { sections: keepTitle })).json(),
    );
    // Renaming a section keeps its key.
    expect(saved.sections.find((s) => s.title === "Launch Plan")?.key).toBe("rollout_plan");
    expect((await req("POST", `/admin/templates/${next.id}/publish`)).status).toBe(200);

    const { items } = templateFamilyList.parse(await (await req("GET", "/admin/templates")).json());
    const family = items.find((f) => f.name === "Acme Product Spec");
    expect(family?.versions.map((v) => [v.version, v.published])).toEqual([
      [2, true],
      [1, true],
    ]);
    expect(family?.draftId).toBeNull();
  });

  it("refuses to change built-ins and duplicate family names", async () => {
    expect((await saveDraft(builtinPrdId, { sections: [extraSection] })).status).toBe(409);
    expect((await req("POST", `/admin/templates/${builtinPrdId}/new-version`)).status).toBe(409);
    expect((await req("POST", `/admin/templates/${builtinPrdId}/archive`)).status).toBe(409);
    await duplicate("Acme PRD");
    const clash = await req("POST", `/admin/templates/${builtinPrdId}/duplicate`, {
      name: "Acme PRD",
    });
    expect(clash.status).toBe(409);
  });

  it("validates requirement kinds at publish and deletes drafts", async () => {
    const draft = await duplicate();
    const twoFrSections = [
      ...draft.sections,
      { ...extraSection, title: "More Requirements", requirementKind: "functional" },
    ];
    expect((await saveDraft(draft.id, { sections: twoFrSections })).status).toBe(200);
    const publish = await req("POST", `/admin/templates/${draft.id}/publish`);
    expect(publish.status).toBe(400);
    expect(await publish.json()).toMatchObject({
      error: {
        code: "invalid_template",
        details: [{ message: "Only one section per requirement kind" }],
      },
    });
    expect((await req("DELETE", `/admin/templates/${draft.id}`)).status).toBe(204);
    expect(await db.select().from(templates).where(eq(templates.id, draft.id))).toEqual([]);
  });

  it("is admin only", async () => {
    await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
    const rina = await login(app, "rina@acme.co", "rina-password-123");
    expect((await req("GET", "/admin/templates", undefined, rina)).status).toBe(403);
    expect(
      (await req("POST", `/admin/templates/${builtinPrdId}/duplicate`, { name: "X" }, rina)).status,
    ).toBe(403);
  });
});

describe("create template", () => {
  it("creates a blank draft that saves empty, then publishes once it has a section", async () => {
    const res = await req("POST", "/admin/templates", { docType: "tsd", name: "Acme TSD" });
    expect(res.status).toBe(201);
    const draft = templateDetail.parse(await res.json());
    expect(draft).toMatchObject({ docType: "tsd", name: "Acme TSD", version: 1, published: false });
    expect(draft.sections).toEqual([]);

    expect((await saveDraft(draft.id, { sections: [] })).status).toBe(200);
    const reopened = templateDetail.parse(
      await (await req("GET", `/admin/templates/${draft.id}`)).json(),
    );
    expect(reopened.sections).toEqual([]);

    const refused = await req("POST", `/admin/templates/${draft.id}/publish`);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: { code: "invalid_template", details: [{ path: ["sections"] }] },
    });

    expect((await saveDraft(draft.id, { sections: [extraSection] })).status).toBe(200);
    const published = await req("POST", `/admin/templates/${draft.id}/publish`);
    expect(templateDetail.parse(await published.json())).toMatchObject({
      published: true,
      sections: [{ key: "rollout_plan" }],
    });

    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.action, "template.create"));
    expect(row).toMatchObject({ targetId: draft.id, metadata: { from: null, name: "Acme TSD" } });
  });

  it("saves a section without guidance, but won't publish it", async () => {
    const draft = templateDetail.parse(
      await (await req("POST", "/admin/templates", { docType: "tsd", name: "Acme TSD" })).json(),
    );
    const saved = await saveDraft(draft.id, { sections: [{ ...extraSection, guidance: "" }] });
    expect(saved.status).toBe(200);
    const refused = await req("POST", `/admin/templates/${draft.id}/publish`);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: { details: [{ path: ["sections", 0, "guidance"] }] },
    });
  });

  it("copies the sections of a published source", async () => {
    const res = await req("POST", "/admin/templates", {
      docType: "prd",
      name: "Acme PRD",
      sourceId: builtinPrdId,
    });
    expect(res.status).toBe(201);
    const draft = templateDetail.parse(await res.json());
    const builtin = templateDetail.parse(
      await (await req("GET", `/admin/templates/${builtinPrdId}`)).json(),
    );
    expect(draft.sections).toEqual(builtin.sections);
  });

  it("rejects a source that is a draft, of another type, or unknown", async () => {
    const draft = await duplicate();
    for (const body of [
      { docType: "prd", name: "A", sourceId: draft.id },
      { docType: "tsd", name: "B", sourceId: builtinPrdId },
      { docType: "prd", name: "C", sourceId: "01900000-0000-7000-8000-000000000000" },
    ]) {
      const res = await req("POST", "/admin/templates", body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "invalid_template" } });
    }
  });

  it("rejects a name already used for the type", async () => {
    await duplicate("Acme PRD");
    const res = await req("POST", "/admin/templates", { docType: "prd", name: "Acme PRD" });
    expect(res.status).toBe(409);
    expect(
      (await req("POST", "/admin/templates", { docType: "tsd", name: "Acme PRD" })).status,
    ).toBe(201);
  });

  it("is admin only", async () => {
    await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
    const rina = await login(app, "rina@acme.co", "rina-password-123");
    const res = await req("POST", "/admin/templates", { docType: "prd", name: "X" }, rina);
    expect(res.status).toBe(403);
  });
});

describe("templates for new documents", () => {
  async function publishedCopy(name = "Acme PRD") {
    const draft = await duplicate(name);
    await saveDraft(draft.id, { sections: [...draft.sections, extraSection] });
    await req("POST", `/admin/templates/${draft.id}/publish`);
    return draft.id;
  }

  async function createPrd(templateId?: string) {
    return req("POST", "/documents", {
      title: "Refunds",
      collectionId: null,
      docType: "prd",
      templateId,
    });
  }

  async function sectionKeys(res: Response) {
    const id = documentSummary.parse(await res.json()).id;
    const detail = documentDetail.parse(await (await req("GET", `/documents/${id}`)).json());
    return detail.sections.map((s) => s.key);
  }

  it("uses the chosen template, and refuses drafts, archived ones and other types", async () => {
    const custom = await publishedCopy();
    const created = await createPrd(custom);
    expect(created.status).toBe(201);
    expect(await sectionKeys(created)).toContain("rollout_plan");

    const draft = (await duplicate("Draft only")).id;
    const [brd] = await db.select().from(templates).where(eq(templates.docType, "brd"));
    for (const templateId of [draft, brd?.id]) {
      const res = await createPrd(templateId);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "invalid_template" } });
    }
    await req("POST", `/admin/templates/${custom}/archive`);
    expect((await createPrd(custom)).status).toBe(400);
    // Documents made from it keep working.
    expect(await db.select().from(documents)).toHaveLength(1);
  });

  it("defaults to the admin's choice, else the built-in", async () => {
    const custom = await publishedCopy();
    expect(await sectionKeys(await createPrd())).not.toContain("rollout_plan");

    const set = await req("PUT", "/admin/settings/templates", { docType: "prd", name: "Acme PRD" });
    expect(set.status).toBe(204);
    expect(await sectionKeys(await createPrd())).toContain("rollout_plan");
    const picker = templateList.parse(await (await req("GET", "/templates?docType=prd")).json());
    expect(picker.items.map((t) => [t.name, t.isDefault])).toEqual([
      ["Acme PRD", true],
      ["Product Requirements Document", false],
    ]);

    // Archiving the default falls back to the built-in.
    await req("POST", `/admin/templates/${custom}/archive`);
    expect(await sectionKeys(await createPrd())).not.toContain("rollout_plan");
    const after = templateList.parse(await (await req("GET", "/templates?docType=prd")).json());
    expect(after.items.map((t) => [t.name, t.isDefault])).toEqual([
      ["Product Requirements Document", true],
    ]);

    expect(
      (await req("PUT", "/admin/settings/templates", { docType: "prd", name: "Missing" })).status,
    ).toBe(400);
  });
});
