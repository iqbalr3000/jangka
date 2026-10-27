import { auditLogs, interviewStates, requirements, templates } from "@jangka/db";
import { truncateAll } from "@jangka/db/testing";
import {
  type DocNode,
  documentDetail,
  documentSummary,
  section,
  templateUpgradePreview,
} from "@jangka/shared/document";
import { type DraftSection, templateDetail } from "@jangka/shared/templates";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildApp,
  call,
  createCollection,
  createUser,
  grantAllUsers,
  login,
  ORIGIN,
  paragraph,
  setupInstance,
  type TestApp,
  tableDoc,
  testDatabase,
} from "./helpers";

const { db, pool } = testDatabase();
afterAll(() => pool.end());

let app: TestApp;
let admin: string;
let v1: string;
let docId: string;

const text = (value: string): DocNode => ({ type: "doc", content: [paragraph(value)] });

async function req(method: string, path: string, body?: unknown, cookie = admin) {
  return call(app, method, path, { cookie, body });
}

async function detail(cookie = admin) {
  const res = await req("GET", `/documents/${docId}`, undefined, cookie);
  expect(res.status).toBe(200);
  return documentDetail.parse(await res.json());
}

async function write(key: string, content: DocNode) {
  const current = (await detail()).sections.find((s) => s.key === key);
  const res = await req("PUT", `/documents/${docId}/sections/${key}`, {
    content,
    revision: current?.revision ?? 0,
  });
  expect(res.status).toBe(200);
  return section.parse(await res.json());
}

/**
 * "Acme PRD" v1 = the built-in PRD v2. v2 drops `risks` and `open_questions`, adds "Rollout Plan",
 * renames Goals and stops indexing functional requirements.
 */
async function publishV2(): Promise<string> {
  const draft = templateDetail.parse(
    await (await req("POST", `/admin/templates/${v1}/new-version`)).json(),
  );
  const sections: DraftSection[] = draft.sections
    .filter((s) => s.key !== "risks" && s.key !== "open_questions")
    .map((s) => {
      if (s.key === "goals") return { ...s, title: "Goals" };
      if (s.key === "functional_requirements") {
        const { requirementKind: _dropped, ...rest } = s;
        return rest;
      }
      return s;
    });
  sections.push({
    title: "Rollout Plan",
    required: false,
    guidance: "Phases and flags.",
    interviewHints: [],
  });
  expect((await req("PUT", `/admin/templates/${draft.id}`, { sections })).status).toBe(200);
  expect((await req("POST", `/admin/templates/${draft.id}/publish`)).status).toBe(200);
  return draft.id;
}

beforeEach(async () => {
  await truncateAll(pool);
  app = buildApp(db, pool).app;
  admin = await setupInstance(app, db);
  const [builtin] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.docType, "prd"), eq(templates.version, 2)));
  const copy = await req("POST", `/admin/templates/${builtin?.id}/duplicate`, { name: "Acme PRD" });
  v1 = templateDetail.parse(await copy.json()).id;
  expect((await req("POST", `/admin/templates/${v1}/publish`)).status).toBe(200);

  const created = await req("POST", "/documents", {
    title: "Refunds",
    collectionId: null,
    docType: "prd",
    templateId: v1,
  });
  docId = documentSummary.parse(await created.json()).id;
  await write("goals", text("Refunds within 5 days."));
  await write("risks", text("Fraudulent refund requests."));
  await write(
    "functional_requirements",
    tableDoc([
      ["ID", "Requirement", "Priority", "Upstream"],
      ["FR-001", "Customers request a refund in the app", "Must", ""],
      ["FR-002", "Agents approve refunds", "Should", ""],
    ]),
  );
});

describe("template upgrade", () => {
  it("is offered to editors only, when a newer version exists", async () => {
    expect((await detail()).templateUpgrade).toBeNull();
    const v2 = await publishV2();
    expect((await detail()).templateUpgrade).toEqual({ templateId: v2, version: 2 });

    // The document lives in a personal collection; move it to a shared one viewers can see.
    const shared = await createCollection(app, admin, "Platform");
    await req("POST", `/documents/${docId}/move`, { collectionId: shared });
    await grantAllUsers(app, db, admin, shared, "view");
    await createUser(db, { name: "Rina", email: "rina@acme.co", password: "rina-password-123" });
    const rina = await login(app, "rina@acme.co", "rina-password-123");
    expect((await detail(rina)).templateUpgrade).toBeNull();
    const preview = await req("GET", `/documents/${docId}/template-upgrade`, undefined, rina);
    expect(preview.status).toBe(403);
  });

  it("previews added, retired, renamed sections and requirement changes", async () => {
    const v2 = await publishV2();
    const res = await req("GET", `/documents/${docId}/template-upgrade`);
    expect(res.status).toBe(200);
    expect(templateUpgradePreview.parse(await res.json())).toEqual({
      from: { templateId: v1, name: "Acme PRD", version: 1 },
      to: { templateId: v2, name: "Acme PRD", version: 2 },
      added: [{ key: "rollout_plan", title: "Rollout Plan" }],
      retired: [
        { key: "risks", title: "Risks & Mitigations", hasContent: true },
        { key: "open_questions", title: "Open Questions", hasContent: false },
      ],
      renamed: [{ key: "goals", from: "Goals & Success Metrics", to: "Goals" }],
      requirementChanges: [
        {
          key: "functional_requirements",
          title: "Functional Requirements",
          from: "functional",
          to: null,
          requirementCount: 2,
        },
      ],
    });
  });

  it("keeps every section's content, adds new ones empty and retires removed ones", async () => {
    const before = (await detail()).sections;
    const v2 = await publishV2();
    const res = await req("POST", `/documents/${docId}/template-upgrade`, { templateId: v2 });
    expect(res.status).toBe(200);
    const after = documentDetail.parse(await res.json());

    expect(after.templateUpgrade).toBeNull();
    for (const key of ["goals", "functional_requirements", "risks"]) {
      const was = before.find((s) => s.key === key);
      const now = after.sections.find((s) => s.key === key);
      expect(now?.content).toEqual(was?.content);
      expect(now?.revision).toBe(was?.revision);
    }
    expect(after.sections.find((s) => s.key === "goals")?.title).toBe("Goals");
    expect(after.sections.find((s) => s.key === "rollout_plan")).toMatchObject({
      completeness: "empty",
      retired: false,
    });

    // Template order, then retired sections with content; empty retired ones are hidden.
    const keys = after.sections.map((s) => s.key);
    expect(keys.at(-2)).toBe("rollout_plan");
    expect(keys.at(-1)).toBe("risks");
    expect(keys).not.toContain("open_questions");
    expect(after.sections.at(-1)).toMatchObject({ title: "Risks", retired: true });

    // Completeness counts the template's 11 sections only.
    expect(after.document.completeness).toHaveLength(11);
  });

  it("drops the index of sections that no longer collect requirements", async () => {
    expect(await db.select().from(requirements)).toHaveLength(2);
    const v2 = await publishV2();
    await req("POST", `/documents/${docId}/template-upgrade`, { templateId: v2 });
    expect(await db.select().from(requirements)).toEqual([]);

    // Editing that section no longer indexes it either.
    await write(
      "functional_requirements",
      tableDoc([
        ["ID", "Requirement", "Priority", "Upstream"],
        ["FR-003", "Refund status page", "Could", ""],
      ]),
    );
    expect(await db.select().from(requirements)).toEqual([]);
  });

  it("carries coverage per key and drops suggestions for retired sections", async () => {
    const sections = (await detail()).sections.map((s) => ({
      key: s.key,
      coverage: "covered" as const,
      note: "",
    }));
    await db.insert(interviewStates).values({
      documentId: docId,
      state: {
        sections,
        openQuestions: ["Who approves?"],
        readyToDraft: true,
        suggestions: [
          { key: "goals", reason: "3 days now" },
          { key: "risks", reason: "New fraud pattern" },
        ],
      },
    });
    const v2 = await publishV2();
    await req("POST", `/documents/${docId}/template-upgrade`, { templateId: v2 });

    const chat = await req("GET", `/documents/${docId}/chat`);
    const { state } = (await chat.json()) as {
      state: {
        sections: { key: string; coverage: string }[];
        suggestions: unknown[];
        openQuestions: string[];
      };
    };
    expect(state.sections.find((s) => s.key === "goals")?.coverage).toBe("covered");
    expect(state.sections.find((s) => s.key === "rollout_plan")?.coverage).toBe("missing");
    expect(state.sections.some((s) => s.key === "risks")).toBe(false);
    expect(state.suggestions).toEqual([{ key: "goals", reason: "3 days now" }]);
    expect(state.openQuestions).toEqual(["Who approves?"]);
  });

  it("a retired section stays editable; emptied, it disappears", async () => {
    const v2 = await publishV2();
    await req("POST", `/documents/${docId}/template-upgrade`, { templateId: v2 });
    await write("risks", { type: "doc", content: [paragraph("")] });
    expect((await detail()).sections.some((s) => s.key === "risks")).toBe(false);
  });

  it("refuses a stale target, a document already on the newest version, and approved documents", async () => {
    const v2 = await publishV2();
    const stale = await req("POST", `/documents/${docId}/template-upgrade`, { templateId: v1 });
    expect(stale.status).toBe(409);

    for (const status of ["in_review", "approved"]) {
      await req("POST", `/documents/${docId}/status`, { status });
    }
    const approved = await req("POST", `/documents/${docId}/template-upgrade`, { templateId: v2 });
    expect(approved.status).toBe(409);
    expect(await approved.json()).toMatchObject({ error: { code: "document_approved" } });

    await req("POST", `/documents/${docId}/status`, { status: "draft" });
    expect(
      (await req("POST", `/documents/${docId}/template-upgrade`, { templateId: v2 })).status,
    ).toBe(200);
    const again = await req("POST", `/documents/${docId}/template-upgrade`, { templateId: v2 });
    expect(again.status).toBe(409);
  });

  it("waits for the assistant: no upgrade while it works on the document", async () => {
    const v2 = await publishV2();
    await req("POST", "/admin/llm-providers", {
      kind: "fake",
      label: "Fake",
      apiKey: "",
      defaultModel: "fake-small",
    });
    const controller = new AbortController();
    const chat = await app.request(`/api/v1/documents/${docId}/chat`, {
      method: "POST",
      headers: { cookie: admin, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ message: "[slow] tell me more" }),
      signal: controller.signal,
    });
    const reader = chat.body?.getReader();
    await reader?.read();
    const res = await req("POST", `/documents/${docId}/template-upgrade`, { templateId: v2 });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "generation_in_progress" } });
    controller.abort();
    await reader?.cancel().catch(() => {});
  });

  it("the assistant can't draft a retired section", async () => {
    const v2 = await publishV2();
    await req("POST", `/documents/${docId}/template-upgrade`, { templateId: v2 });
    await req("POST", "/admin/llm-providers", {
      kind: "fake",
      label: "Fake",
      apiKey: "",
      defaultModel: "fake-small",
    });
    const res = await req("POST", `/documents/${docId}/draft`, { sections: ["risks"] });
    expect(res.status).toBe(404);
  });

  it("audits the upgrade", async () => {
    const v2 = await publishV2();
    await req("POST", `/documents/${docId}/template-upgrade`, { templateId: v2 });
    const [row] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "document.template_upgrade"));
    expect(row?.metadata).toEqual({
      from: { templateId: v1, version: 1 },
      to: { templateId: v2, version: 2 },
    });
  });

  it("upgrades a document on the built-in PRD v1 to v2 without changes to its sections", async () => {
    const [builtinV1] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.docType, "prd"), eq(templates.version, 1)));
    const created = await req("POST", "/documents", {
      title: "Old PRD",
      collectionId: null,
      docType: "prd",
      templateId: builtinV1?.id,
    });
    docId = documentSummary.parse(await created.json()).id;
    const upgrade = (await detail()).templateUpgrade;
    expect(upgrade?.version).toBe(2);

    const preview = templateUpgradePreview.parse(
      await (await req("GET", `/documents/${docId}/template-upgrade`)).json(),
    );
    expect(preview).toMatchObject({ added: [], retired: [], renamed: [], requirementChanges: [] });
    const res = await req("POST", `/documents/${docId}/template-upgrade`, {
      templateId: upgrade?.templateId,
    });
    expect(res.status).toBe(200);
    expect(documentDetail.parse(await res.json()).sections).toHaveLength(12);
  });
});
