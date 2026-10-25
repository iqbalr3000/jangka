import { z } from "zod";
import { documentRef, linkedDocument } from "./document";

export const requirementKind = z.enum(["business", "functional", "non_functional", "technical"]);
export const requirementPriority = z.enum(["must", "should", "could"]);

/** An upstream code as written in the Upstream column, resolved for the viewer. */
export const upstreamRef = z.discriminatedUnion("status", [
  z.object({
    code: z.string(),
    status: z.literal("linked"),
    text: z.string(),
    documentId: z.string(),
    /** Set when this upstream requirement changed after the citing one was last reviewed. */
    changedAt: z.string().optional(),
  }),
  z.object({ code: z.string(), status: z.literal("restricted") }),
  /** The source has no requirement with this code (or there is no source). */
  z.object({ code: z.string(), status: z.literal("missing") }),
]);
export type UpstreamRef = z.infer<typeof upstreamRef>;

export const requirementView = z.object({
  code: z.string(),
  kind: requirementKind,
  text: z.string(),
  priority: requirementPriority.nullable(),
  sectionKey: z.string(),
  upstream: z.array(upstreamRef),
  /** A cited upstream requirement changed since this one was last edited or reviewed. */
  needsReview: z.boolean(),
  /** Requirements in viewable downstream documents that cite this one. */
  downstream: z.array(z.object({ documentId: z.string(), code: z.string(), text: z.string() })),
});
export type RequirementView = z.infer<typeof requirementView>;

export const traceResponse = z.object({
  upstream: linkedDocument.nullable(),
  /** Viewable documents generated from this one; restricted ones are omitted. */
  downstream: z.array(documentRef),
  requirements: z.array(requirementView),
  needsReviewCount: z.number(),
});
export type TraceResponse = z.infer<typeof traceResponse>;
