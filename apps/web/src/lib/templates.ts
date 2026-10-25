import { templateList } from "@jangka/shared/document";
import { templateDetail, templateFamilyList } from "@jangka/shared/templates";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./api";

export const templatesKey = ["templates"] as const;

/** Published templates of one type for the New document dialog. */
export const templatePickerQuery = (docType: "brd" | "prd" | "tsd") =>
  queryOptions({
    queryKey: [...templatesKey, "picker", docType],
    queryFn: () => apiFetch(`/templates?docType=${docType}`, { schema: templateList }),
  });

export const templateFamiliesQuery = queryOptions({
  queryKey: [...templatesKey, "admin"],
  queryFn: () => apiFetch("/admin/templates", { schema: templateFamilyList }),
});

export const templateDetailQuery = (id: string) =>
  queryOptions({
    queryKey: [...templatesKey, "admin", id],
    queryFn: () => apiFetch(`/admin/templates/${id}`, { schema: templateDetail }),
  });
