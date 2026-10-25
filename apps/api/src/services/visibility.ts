import { documents } from "@jangka/db";
import { inArray, isNull, or, type SQL } from "drizzle-orm";
import { type AccessData, isHidden, resolveDocLevel } from "./access";

/**
 * Documents the viewer may read, as an SQL condition: collections resolved with
 * `packages/permissions` (archived ones left out), plus the root when viewable. Applied in SQL so
 * unviewable documents are never ranked, counted or read. Undefined = nothing is viewable.
 */
export function viewableScope(data: AccessData): SQL | undefined {
  const ids = [...data.rows.keys()].filter(
    (id) => resolveDocLevel(data, { collectionId: id }) !== "none" && !isHidden(data, id),
  );
  const rootViewable = resolveDocLevel(data, { collectionId: null }) !== "none";
  return or(
    ids.length > 0 ? inArray(documents.collectionId, ids) : undefined,
    rootViewable ? isNull(documents.collectionId) : undefined,
  );
}
