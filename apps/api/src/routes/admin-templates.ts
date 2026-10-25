import { documents, instanceSettings, templates } from "@jangka/db";
import { AppError } from "@jangka/shared/errors";
import {
  duplicateTemplateRequest,
  saveTemplateDraftRequest,
  setDefaultTemplateRequest,
  type TemplateDetail,
  type TemplateFamily,
} from "@jangka/shared/templates";
import { customTemplateDefinition, sectionKeyFor, templateDefinition } from "@jangka/templates";
import { and, count, desc, eq, isNotNull, isNull, max } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/session";
import { zValidate } from "../lib/validate";
import {
  defaultTemplates,
  definitionOf,
  latestPublished,
  type TemplateRow,
} from "../services/templates";
import type { AppEnv, RouteDeps } from "../types";

const idParam = z.object({ id: z.uuid() });

export function adminTemplateRoutes({ db }: RouteDeps) {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    requireAdmin(c);
    await next();
  });

  async function findTemplate(id: string): Promise<TemplateRow> {
    const [row] = await db.select().from(templates).where(eq(templates.id, id));
    if (!row) throw new AppError("not_found", 404, "Template not found");
    return row;
  }

  function requireDraft(row: TemplateRow): void {
    if (row.publishedAt) {
      throw new AppError("conflict", 409, "Published versions can't change. Create a new version.");
    }
  }

  async function familyPublished(row: Pick<TemplateRow, "docType" | "name">): Promise<boolean> {
    const [published] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(
        and(
          eq(templates.docType, row.docType),
          eq(templates.name, row.name),
          isNotNull(templates.publishedAt),
        ),
      )
      .limit(1);
    return published !== undefined;
  }

  async function detail(row: TemplateRow): Promise<TemplateDetail> {
    return {
      id: row.id,
      docType: row.docType,
      name: row.name,
      version: row.version,
      published: row.publishedAt !== null,
      isBuiltin: row.isBuiltin,
      familyPublished: await familyPublished(row),
      sections: definitionOf(row).sections,
    };
  }

  async function assertNameFree(docType: TemplateRow["docType"], name: string): Promise<void> {
    const [taken] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(and(eq(templates.docType, docType), eq(templates.name, name)))
      .limit(1);
    if (taken) {
      throw new AppError(
        "conflict",
        409,
        `A ${docType.toUpperCase()} template named "${name}" exists`,
        [{ path: ["name"], message: "Pick another name" }],
      );
    }
  }

  /** Inserts a draft copying `definition`, as `version` of the (docType, name) family. */
  async function insertDraft(
    source: TemplateRow,
    input: { name: string; version: number; userId: string },
  ): Promise<TemplateRow> {
    const definition = definitionOf(source);
    const [row] = await db
      .insert(templates)
      .values({
        docType: source.docType,
        name: input.name,
        version: input.version,
        definition: { ...definition, name: input.name, version: input.version },
        isBuiltin: false,
        createdBy: input.userId,
      })
      .returning();
    if (!row) throw new Error("draft not created");
    return row;
  }

  return app
    .get("/templates", async (c) => {
      const rows = await db
        .select()
        .from(templates)
        .orderBy(templates.docType, templates.name, desc(templates.version));
      const counts = await db
        .select({ templateId: documents.templateId, n: count() })
        .from(documents)
        .groupBy(documents.templateId);
      const used = new Map(counts.map((r) => [r.templateId, r.n]));
      const defaults = await defaultTemplates(db);

      const families = new Map<string, TemplateRow[]>();
      for (const row of rows) {
        const key = `${row.docType}:${row.name}`;
        families.set(key, [...(families.get(key) ?? []), row]);
      }
      const items: TemplateFamily[] = [...families.values()].flatMap((versions) => {
        const [head] = versions;
        if (!head) return [];
        const chosen = defaults[head.docType];
        return [
          {
            docType: head.docType,
            name: head.name,
            isBuiltin: head.isBuiltin,
            archived: head.archivedAt !== null,
            isDefault: chosen ? chosen === head.name : head.isBuiltin,
            versions: versions.map((v) => ({
              id: v.id,
              version: v.version,
              published: v.publishedAt !== null,
              publishedAt: v.publishedAt?.toISOString() ?? null,
              documentCount: used.get(v.id) ?? 0,
            })),
            draftId: versions.find((v) => v.publishedAt === null)?.id ?? null,
          },
        ];
      });
      return c.json({ items });
    })
    .get("/templates/:id", zValidate("param", idParam), async (c) =>
      c.json(await detail(await findTemplate(c.req.valid("param").id))),
    )
    .post(
      "/templates/:id/duplicate",
      zValidate("param", idParam),
      zValidate("json", duplicateTemplateRequest),
      async (c) => {
        const auth = requireAdmin(c);
        const source = await findTemplate(c.req.valid("param").id);
        const { name } = c.req.valid("json");
        await assertNameFree(source.docType, name);
        const row = await insertDraft(source, { name, version: 1, userId: auth.user.id });
        await audit(c, {
          action: "template.duplicate",
          targetType: "template",
          targetId: row.id,
          metadata: { from: source.id, name },
        });
        return c.json(await detail(row), 201);
      },
    )
    .post("/templates/:id/new-version", zValidate("param", idParam), async (c) => {
      const auth = requireAdmin(c);
      const source = await findTemplate(c.req.valid("param").id);
      if (source.isBuiltin) {
        throw new AppError(
          "conflict",
          409,
          "Built-in templates can't change. Duplicate it instead.",
        );
      }
      const latest = await latestPublished(db, source.docType, source.name);
      if (!latest)
        throw new AppError("conflict", 409, "Publish the first version before adding another");
      const [top] = await db
        .select({ version: max(templates.version) })
        .from(templates)
        .where(and(eq(templates.docType, source.docType), eq(templates.name, source.name)));
      const [draft] = await db
        .select({ id: templates.id })
        .from(templates)
        .where(
          and(
            eq(templates.docType, source.docType),
            eq(templates.name, source.name),
            isNull(templates.publishedAt),
          ),
        );
      if (draft) throw new AppError("conflict", 409, "This template already has a draft");
      const row = await insertDraft(latest, {
        name: source.name,
        version: (top?.version ?? latest.version) + 1,
        userId: auth.user.id,
      });
      await audit(c, {
        action: "template.new_version",
        targetType: "template",
        targetId: row.id,
        metadata: { name: row.name, version: row.version },
      });
      return c.json(await detail(row), 201);
    })
    .put(
      "/templates/:id",
      zValidate("param", idParam),
      zValidate("json", saveTemplateDraftRequest),
      async (c) => {
        const row = await findTemplate(c.req.valid("param").id);
        requireDraft(row);
        const input = c.req.valid("json");
        const name = input.name ?? row.name;
        if (name !== row.name) {
          if (await familyPublished(row)) {
            throw new AppError("conflict", 409, "A published template keeps its name");
          }
          await assertNameFree(row.docType, name);
        }

        // New sections get stable keys from their titles.
        const keys = new Set(input.sections.flatMap((s) => (s.key ? [s.key] : [])));
        const sections = input.sections.map((section) => {
          if (section.key) return { ...section, key: section.key };
          const key = sectionKeyFor(section.title, keys);
          keys.add(key);
          return { ...section, key };
        });
        const parsed = templateDefinition.safeParse({
          docType: row.docType,
          name,
          version: row.version,
          sections,
        });
        if (!parsed.success) {
          throw new AppError(
            "invalid_template",
            400,
            "The template isn't valid",
            parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
          );
        }
        const [updated] = await db
          .update(templates)
          .set({ name, definition: parsed.data })
          .where(eq(templates.id, row.id))
          .returning();
        if (!updated) throw new AppError("not_found", 404, "Template not found");
        await audit(c, {
          action: "template.update_draft",
          targetType: "template",
          targetId: row.id,
          metadata: { name, sections: sections.length },
        });
        return c.json(await detail(updated));
      },
    )
    .post("/templates/:id/publish", zValidate("param", idParam), async (c) => {
      const row = await findTemplate(c.req.valid("param").id);
      requireDraft(row);
      const result = customTemplateDefinition.safeParse(row.definition);
      if (!result.success) {
        throw new AppError(
          "invalid_template",
          400,
          "Fix the highlighted sections before publishing",
          result.error.issues.map((i) => ({ path: i.path, message: i.message })),
        );
      }
      const [published] = await db
        .update(templates)
        .set({ publishedAt: new Date() })
        .where(eq(templates.id, row.id))
        .returning();
      if (!published) throw new AppError("not_found", 404, "Template not found");
      await audit(c, {
        action: "template.publish",
        targetType: "template",
        targetId: row.id,
        metadata: { name: row.name, version: row.version },
      });
      return c.json(await detail(published));
    })
    .delete("/templates/:id", zValidate("param", idParam), async (c) => {
      const row = await findTemplate(c.req.valid("param").id);
      requireDraft(row);
      await db.delete(templates).where(eq(templates.id, row.id));
      await audit(c, {
        action: "template.delete_draft",
        targetType: "template",
        targetId: row.id,
        metadata: { name: row.name, version: row.version },
      });
      return c.body(null, 204);
    })
    .post("/templates/:id/archive", zValidate("param", idParam), async (c) => {
      const row = await findTemplate(c.req.valid("param").id);
      if (row.isBuiltin)
        throw new AppError("conflict", 409, "Built-in templates can't be archived");
      await db.transaction(async (tx) => {
        await tx
          .update(templates)
          .set({ archivedAt: new Date() })
          .where(and(eq(templates.docType, row.docType), eq(templates.name, row.name)));
        const defaults = await defaultTemplates(tx);
        if (defaults[row.docType] === row.name) {
          const { [row.docType]: _cleared, ...rest } = defaults;
          await tx.update(instanceSettings).set({ defaultTemplates: rest });
        }
      });
      await audit(c, {
        action: "template.archive",
        targetType: "template",
        targetId: row.id,
        metadata: { name: row.name },
      });
      return c.body(null, 204);
    })
    .post("/templates/:id/restore", zValidate("param", idParam), async (c) => {
      const row = await findTemplate(c.req.valid("param").id);
      await db
        .update(templates)
        .set({ archivedAt: null })
        .where(and(eq(templates.docType, row.docType), eq(templates.name, row.name)));
      await audit(c, {
        action: "template.restore",
        targetType: "template",
        targetId: row.id,
        metadata: { name: row.name },
      });
      return c.body(null, 204);
    })
    .put("/settings/templates", zValidate("json", setDefaultTemplateRequest), async (c) => {
      const { docType, name } = c.req.valid("json");
      if (name !== null && !(await latestPublished(db, docType, name))) {
        throw new AppError(
          "invalid_template",
          400,
          "Pick a published, non-archived template of that type",
        );
      }
      const defaults = await defaultTemplates(db);
      const { [docType]: _previous, ...rest } = defaults;
      await db
        .update(instanceSettings)
        .set({ defaultTemplates: name === null ? rest : { ...rest, [docType]: name } });
      await audit(c, {
        action: "settings.default_template",
        targetType: "instance_settings",
        targetId: null,
        metadata: { docType, name },
      });
      return c.body(null, 204);
    });
}
