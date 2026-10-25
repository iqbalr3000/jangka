import { fixDiagramResponse } from "@jangka/shared/assistant";
import { createContext } from "react";
import { apiFetch } from "./api";

export type FixDiagram = (source: string, error: string) => Promise<string>;

/** Provided by editable section editors; diagrams elsewhere (previews, history) get no fix button. */
export const DiagramFixContext = createContext<FixDiagram | null>(null);

export async function fixDiagram(
  documentId: string,
  sectionKey: string,
  source: string,
  error: string,
): Promise<string> {
  const fixed = await apiFetch(`/documents/${documentId}/sections/${sectionKey}/fix-diagram`, {
    method: "POST",
    body: { source, error },
    schema: fixDiagramResponse,
  });
  return fixed.source;
}
