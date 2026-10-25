import { createHash } from "node:crypto";

export type DiagramTheme = "default";

/** Cache key of a render (`diagram_renders.source_hash`); shared by the api and the worker. */
export function diagramHash(source: string, theme: DiagramTheme = "default"): string {
  return createHash("sha256").update(`${theme}\n${source}`).digest("hex");
}
