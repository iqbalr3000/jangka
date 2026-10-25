import { documents, requirements, templates } from "@jangka/db";
import type { DocumentRef } from "@jangka/shared/document";
import { AppError } from "@jangka/shared/errors";
import type { RequirementView, TraceResponse, UpstreamRef } from "@jangka/shared/trace";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { audit } from "../lib/audit";
import { requireAuth } from "../lib/session";
import { zValidate } from "../lib/validate";
import { loadAccess, resolveDocLevel } from "../services/access";
import {
  linkedSource,
  requireDocEdit,
  requireNotApproved,
  viewableDocument,
} from "../services/documents";
import { changedSince, reviewBaseline } from "../services/requirements";
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

  return new Hono<AppEnv>()
    .get("/:id/trace", zValidate("param", idParam), async (c) => {
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
      const resolve = (code: string, baseline: Date): UpstreamRef => {
        if (upstream && "restricted" in upstream) return { code, status: "restricted" };
        const found = sourceRequirements.get(code);
        if (!found || !upstream || !("id" in upstream)) return { code, status: "missing" };
        const changed = changedSince(found, baseline);
        return {
          code,
          status: "linked",
          text: found.text,
          documentId: upstream.id,
          ...(changed ? { changedAt: changed.toISOString() } : {}),
        };
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

      const views = own.map((r): RequirementView => {
        const refs = r.upstreamCodes.map((code) => resolve(code, reviewBaseline(r)));
        return {
          code: r.code,
          kind: r.kind,
          text: r.text,
          priority: r.priority,
          sectionKey: r.sectionKey,
          upstream: refs,
          needsReview: refs.some((ref) => ref.status === "linked" && ref.changedAt !== undefined),
          downstream: citing
            .filter((d) => d.upstreamCodes.includes(r.code))
            .map((d) => ({ documentId: d.documentId, code: d.code, text: d.text })),
        };
      });
      const response: TraceResponse = {
        upstream,
        downstream,
        requirements: views,
        needsReviewCount: views.filter((v) => v.needsReview).length,
      };
      return c.json(response);
    })
    .post(
      "/:id/requirements/:code/reviewed",
      zValidate("param", idParam.extend({ code: z.string().regex(/^[A-Z]+-\d{3,}$/) })),
      async (c) => {
        const auth = requireAuth(c);
        const data = await loadAccess(db, {
          userId: auth.user.id,
          isAdmin: auth.user.isAdmin,
          groupIds: auth.groupIds,
        });
        const { id, code } = c.req.valid("param");
        const doc = await viewableDocument(db, data, id);
        requireDocEdit(data, doc);
        requireNotApproved(doc);
        const [updated] = await db
          .update(requirements)
          .set({ upstreamReviewedAt: new Date() })
          .where(and(eq(requirements.documentId, doc.id), eq(requirements.code, code)))
          .returning({ id: requirements.id });
        if (!updated) throw new AppError("not_found", 404, "Requirement not found");
        await audit(c, {
          action: "requirement.reviewed",
          targetType: "document",
          targetId: doc.id,
          metadata: { code },
        });
        return c.body(null, 204);
      },
    );
}
