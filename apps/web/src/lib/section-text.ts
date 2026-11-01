import type { DocNode } from "@jangka/shared/document";
import { getSchema } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { sectionExtensions } from "./editor-extensions";
import { type FlatText, flatten } from "./text-anchor";

let schema: Schema | undefined;

/** A saved section's flattened text, as its editor would see it; null if it can't be read. */
export function sectionText(content: DocNode): FlatText | null {
  try {
    schema ??= getSchema(sectionExtensions(null));
    return flatten(ProseMirrorNode.fromJSON(schema, content));
  } catch {
    return null;
  }
}
