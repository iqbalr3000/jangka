import { templateList } from "@jangka/shared/document";
import {
  type TemplateFile,
  templateDetail,
  templateFamilyList,
  templateFile,
} from "@jangka/shared/templates";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./api";

export const templatesKey = ["templates"] as const;

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

/** What the picked file turned out to be: a template, or why it isn't one. */
export type PickedFile = { name: string } & ({ file: TemplateFile } | { error: string });

/** Reads a picked file in the browser; the server validates it again on import. */
export async function readTemplateFile(file: File): Promise<PickedFile> {
  try {
    const parsed = templateFile.safeParse(JSON.parse(await file.text()));
    if (parsed.success) return { name: file.name, file: parsed.data };
    return { name: file.name, error: parsed.error.issues[0]?.message ?? "Not a template file" };
  } catch {
    return { name: file.name, error: "This file isn't JSON" };
  }
}

/** Download link for one template version as a portable JSON file. */
export const templateExportUrl = (templateId: string) =>
  `/api/v1/admin/templates/${templateId}/export`;
