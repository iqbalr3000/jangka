import { documents, requirements, templates } from "@jangka/db";
import type { DocumentRef } from "@jangka/shared/document";
import type { RequirementView, TraceResponse, UpstreamRef } from "@jangka/shared/trace";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../lib/session";
import { zValidate } from "../lib/validate";
import { loadAccess, resolveDocLevel } from "../services/access";
import { linkedSource, viewableDocument } from "../services/documents";
import { definitionOf } from "../services/templates";
import type { AppEnv, RouteDeps } from "../types";

const idParam = z.object({ id: z.uuid() });

type RequirementRow = typeof requirements.$inferSelect;

export function traceRoutes({ db }: RouteDeps) {
  async function requirementsOf(documentIds: string[]): Promise<RequirementRow[]> {
    if (documentIds.length === 0) return [];
    return db
      .select()
      .from(requirements)
      .where(inArray(requirements.documentId, documentIds))
      .orderBy(asc(requirements.position));
  }

  return new Hono<AppEnv>().get("/:id/trace", zValidate("param", idParam), async (c) => {
    const auth = requireAuth(c);
    const data = await loadAccess(db, {
      userId: auth.user.id,
      isAdmin: auth.user.isAdmin,
      groupIds: auth.groupIds,
    });
    const doc = await viewableDocument(db, data, c.req.valid("param").id);
    const upstream = await linkedSource(db, data, doc);

    // Upstream codes resolve only against a source the viewer can see.
    const sourceRequirements = new Map(
      upstream && "id" in upstream
        ? (await requirementsOf([upstream.id])).map((r) => [r.code, r])
        : [],
    );
    const resolve = (code: string): UpstreamRef => {
      if (upstream && "restricted" in upstream) return { code, status: "restricted" };
      const found = sourceRequirements.get(code);
      return found && upstream && "id" in upstream
        ? { code, status: "linked", text: found.text, documentId: upstream.id }
        : { code, status: "missing" };
    };

    // Restricted downstream documents are left out entirely (no titles, no counts).
    const children = (
      await db
        .select()
        .from(documents)
        .where(and(eq(documents.sourceDocumentId, doc.id), isNull(documents.archivedAt)))
        .orderBy(asc(documents.createdAt))
    ).filter((row) => resolveDocLevel(data, row) !== "none");
    const downstream: DocumentRef[] = children.map((row) => ({
      id: row.id,
      title: row.title,
      docType: row.docType,
    }));
    const citing = await requirementsOf(children.map((row) => row.id));

    const [template] = await db.select().from(templates).where(eq(templates.id, doc.templateId));
    const sectionOrder = new Map(
      (template ? definitionOf(template).sections : []).map((s, i) => [s.key, i]),
    );
    const own = (await requirementsOf([doc.id])).sort(
      (a, b) =>
        (sectionOrder.get(a.sectionKey) ?? 0) - (sectionOrder.get(b.sectionKey) ?? 0) ||
        a.position - b.position,
    );

    const response: TraceResponse = {
      upstream,
      downstream,
      requirements: own.map(
        (r): RequirementView => ({
          code: r.code,
          kind: r.kind,
          text: r.text,
          priority: r.priority,
          sectionKey: r.sectionKey,
          upstream: r.upstreamCodes.map(resolve),
          downstream: citing
            .filter((d) => d.upstreamCodes.includes(r.code))
            .map((d) => ({ documentId: d.documentId, code: d.code, text: d.text })),
        }),
      ),
    };
    return c.json(response);
  });
}
