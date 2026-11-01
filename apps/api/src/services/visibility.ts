import { documents } from "@jangka/db";
import { inArray, isNull, or, type SQL } from "drizzle-orm";
import { type AccessData, isHidden, resolveDocLevel } from "./access";

/**
 * Viewable documents as an SQL condition (archived collections left out), so unviewable ones are
 * never ranked, counted or read. Undefined = nothing is viewable.
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
