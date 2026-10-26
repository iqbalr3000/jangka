import { z } from "zod";
import { documentSummary } from "./document";

export const level = z.enum(["none", "view", "edit"]);
export type Level = z.infer<typeof level>;

const nameSchema = z.string().trim().min(1, { error: "Required" }).max(100);

/** Display form of a permission reason: ids resolved to names the viewer may see. */
export const accessReasonView = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("admin") }),
  z.object({ kind: z.literal("owner") }),
  z.object({
    kind: z.literal("grant"),
    groupId: z.string(),
    groupName: z.string(),
    collectionId: z.string().nullable(),
    collectionName: z.string(),
  }),
  z.object({ kind: z.literal("none") }),
]);
export type AccessReasonView = z.infer<typeof accessReasonView>;

export const accessView = z.object({ level, reason: accessReasonView });
export type AccessView = z.infer<typeof accessView>;

export const collectionSummary = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  personalOwnerId: z.string().nullable(),
  level,
  documentCount: z.number().int(),
});
export type CollectionSummary = z.infer<typeof collectionSummary>;

export const collectionList = z.object({ rootLevel: level, items: z.array(collectionSummary) });
export type CollectionList = z.infer<typeof collectionList>;

export const collectionDetail = z.object({
  /** null = the root ("Our documents"). */
  collection: collectionSummary.nullable(),
  archivedAt: z.string().nullable(),
  /** Inside someone's personal collection (breadcrumbs start at its root). */
  inPersonalTree: z.boolean(),
  breadcrumbs: z.array(z.object({ id: z.string(), name: z.string() })),
  access: accessView,
  children: z.array(collectionSummary),
  documents: z.array(documentSummary),
});
export type CollectionDetail = z.infer<typeof collectionDetail>;

export const archivedCollectionList = z.object({
  items: z.array(collectionSummary.extend({ archivedAt: z.string() })),
  documents: z.array(documentSummary),
});

export const createCollectionRequest = z.object({
  name: nameSchema,
  parentId: z.uuid().nullable(),
});

export const updateCollectionRequest = z
  .object({ name: nameSchema.optional(), parentId: z.uuid().nullable().optional() })
  .refine((body) => body.name !== undefined || body.parentId !== undefined, {
    error: "Nothing to update",
  });

export const systemGroupKey = z.enum(["admins", "all_users"]);

export const group = z.object({
  id: z.string(),
  name: z.string(),
  systemKey: systemGroupKey.nullable(),
  memberCount: z.number().int(),
});
export type Group = z.infer<typeof group>;
export const groupList = z.object({ items: z.array(group) });

export const groupNameRequest = z.object({ name: nameSchema });

export const groupMember = z.object({ id: z.string(), name: z.string(), email: z.string() });
export type GroupMember = z.infer<typeof groupMember>;
/** `implicit`: All Users — every active user, membership can't be edited. */
export const groupMemberList = z.object({
  group,
  implicit: z.boolean(),
  items: z.array(groupMember),
});

export const addMemberRequest = z.object({ userId: z.uuid() });

export const grant = z.object({
  collectionId: z.string().nullable(),
  groupId: z.string(),
  level,
});
export type Grant = z.infer<typeof grant>;

export const permissionGraph = z.object({
  groups: z.array(group),
  collections: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      parentId: z.string().nullable(),
      documentCount: z.number().int(),
    }),
  ),
  rootDocumentCount: z.number().int(),
  grants: z.array(grant),
});
export type PermissionGraph = z.infer<typeof permissionGraph>;

/** `level: null` resets the cell to inherit. */
export const permissionChanges = z.object({
  changes: z
    .array(
      z.object({
        collectionId: z.uuid().nullable(),
        groupId: z.uuid(),
        level: level.nullable(),
      }),
    )
    .min(1)
    .max(1000),
});
export type PermissionChange = z.infer<typeof permissionChanges>["changes"][number];

export const accessCheckQuery = z.object({ userId: z.uuid() });

export const accessCheck = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string(), isAdmin: z.boolean() }),
  root: accessView,
  collections: z.array(
    z
      .object({ id: z.string(), name: z.string(), parentId: z.string().nullable() })
      .extend(accessView.shape),
  ),
});
export type AccessCheck = z.infer<typeof accessCheck>;
