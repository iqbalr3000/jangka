import { type ExportFormat, type ExportJob, exportJob } from "@jangka/shared/export";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./api";

const POLL_MS = 1000;

export const formatLabels: Record<ExportFormat, string> = { pdf: "PDF", docx: "DOCX" };

export function createExport(
  documentId: string,
  body: { format: ExportFormat; includeCover: boolean; includeAppendix: boolean },
): Promise<ExportJob> {
  return apiFetch(`/documents/${documentId}/exports`, { method: "POST", body, schema: exportJob });
}

/** Polls every second until the job settles. */
export const exportQuery = (id: string) =>
  queryOptions({
    queryKey: ["exports", id],
    queryFn: () => apiFetch(`/exports/${id}`, { schema: exportJob }),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "done" || status === "failed" ? false : POLL_MS;
    },
  });

export const downloadUrl = (id: string) => `/api/v1/exports/${id}/download`;
