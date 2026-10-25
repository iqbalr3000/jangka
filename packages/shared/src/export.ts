import { z } from "zod";

export const exportFormat = z.enum(["pdf", "docx"]);
export type ExportFormat = z.infer<typeof exportFormat>;

export const exportStatus = z.enum(["queued", "running", "done", "failed"]);
export type ExportStatus = z.infer<typeof exportStatus>;

export const createExportRequest = z.object({
  format: exportFormat,
  includeCover: z.boolean().default(true),
  includeAppendix: z.boolean().default(true),
});

export const exportJob = z.object({
  id: z.string(),
  documentId: z.string(),
  format: exportFormat,
  status: exportStatus,
  includeCover: z.boolean(),
  includeAppendix: z.boolean(),
  fileName: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
});
export type ExportJob = z.infer<typeof exportJob>;

export const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
