import { documentExports } from "@jangka/db";
import { AppError } from "@jangka/shared/errors";
import {
  createExportRequest,
  EXPORT_CONTENT_TYPES,
  EXPORT_TTL_MS,
  type ExportJob,
} from "@jangka/shared/export";
import { JOBS } from "@jangka/worker/jobs";
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { audit } from "../lib/audit";
import { requireAuth } from "../lib/session";
import { zValidate } from "../lib/validate";
import { loadAccess } from "../services/access";
import { viewableDocument } from "../services/documents";
import type { AppEnv, RouteDeps } from "../types";

const idParam = z.object({ id: z.uuid() });

type ExportRow = typeof documentExports.$inferSelect;

function view(row: ExportRow): ExportJob {
  return {
    id: row.id,
    documentId: row.documentId,
    format: row.format,
    status: row.status,
    includeCover: row.includeCover,
    fileName: row.fileName,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** RFC 6266: an ASCII fallback plus the exact UTF-8 name. */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function exportRoutes({ db, queue }: RouteDeps) {
  const access = (c: Context<AppEnv>) => {
    const auth = requireAuth(c);
    return loadAccess(db, {
      userId: auth.user.id,
      isAdmin: auth.user.isAdmin,
      groupIds: auth.groupIds,
    });
  };

  /** The requester's own export, while they can still view the document; 404 otherwise. */
  async function ownExport(c: Context<AppEnv>, id: string): Promise<ExportRow> {
    const auth = requireAuth(c);
    const [row] = await db.select().from(documentExports).where(eq(documentExports.id, id));
    if (!row || row.requestedBy !== auth.user.id) {
      throw new AppError("not_found", 404, "Export not found");
    }
    try {
      await viewableDocument(db, await access(c), row.documentId);
    } catch (error) {
      if (error instanceof AppError && error.status === 404) {
        throw new AppError("not_found", 404, "Export not found");
      }
      throw error;
    }
    return row;
  }

  return new Hono<AppEnv>()
    .post(
      "/documents/:id/exports",
      zValidate("param", idParam),
      zValidate("json", createExportRequest),
      async (c) => {
        const auth = requireAuth(c);
        const doc = await viewableDocument(db, await access(c), c.req.valid("param").id);
        if (doc.archivedAt)
          throw new AppError("conflict", 409, "Restore the document to export it");
        const { format, includeCover } = c.req.valid("json");
        const [row] = await db
          .insert(documentExports)
          .values({
            documentId: doc.id,
            format,
            includeCover,
            requestedBy: auth.user.id,
            expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
          })
          .returning();
        if (!row) throw new Error("export not created");
        await queue.send(JOBS.exportRun, { exportId: row.id });
        await audit(c, {
          action: "document.export",
          targetType: "document",
          targetId: doc.id,
          metadata: { exportId: row.id, format },
        });
        return c.json(view(row), 202);
      },
    )
    .get("/exports/:id", zValidate("param", idParam), async (c) => {
      return c.json(view(await ownExport(c, c.req.valid("param").id)));
    })
    .get("/exports/:id/download", zValidate("param", idParam), async (c) => {
      const row = await ownExport(c, c.req.valid("param").id);
      if (row.expiresAt.getTime() <= Date.now()) {
        throw new AppError("export_expired", 410, "This export has expired. Export again.");
      }
      if (row.status !== "done" || !row.file || !row.fileName) {
        throw new AppError("export_not_ready", 409, "The export isn't ready yet");
      }
      return c.body(new Uint8Array(row.file), 200, {
        "content-type": EXPORT_CONTENT_TYPES[row.format],
        "content-disposition": contentDisposition(row.fileName),
        "cache-control": "private, no-store",
      });
    });
}
