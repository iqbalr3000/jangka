import { z } from "zod";
import { ApiError } from "./api";

const issueList = z.array(
  z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }),
);

/** `sections.3.requirementKind` style API issues → per-section field messages. */
export function sectionErrors(error: unknown): Record<number, Record<string, string>> {
  if (!(error instanceof ApiError)) return {};
  const parsed = issueList.safeParse(error.details);
  if (!parsed.success) return {};
  const out: Record<number, Record<string, string>> = {};
  for (const { path, message } of parsed.data) {
    const [root, index, field] = path;
    if (root !== "sections" || typeof index !== "number") continue;
    out[index] = { ...out[index], [String(field ?? "title")]: message };
  }
  return out;
}
