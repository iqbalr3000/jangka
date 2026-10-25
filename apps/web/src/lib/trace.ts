import { traceResponse } from "@jangka/shared/trace";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./api";

export const traceKey = (documentId: string) => ["documents", documentId, "trace"] as const;

export const traceQuery = (documentId: string) =>
  queryOptions({
    queryKey: traceKey(documentId),
    queryFn: () => apiFetch(`/documents/${documentId}/trace`, { schema: traceResponse }),
  });

export const docTypeLabels = { brd: "BRD", prd: "PRD", tsd: "TSD" } as const;
