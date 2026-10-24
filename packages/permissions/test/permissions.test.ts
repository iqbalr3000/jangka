import { describe, expect, it } from "vitest";
import {
  type CollectionNode,
  can,
  createContext,
  explainAccess,
  filterViewable,
  type GrantRow,
  isSelfOrDescendant,
  personalOwnerOf,
  resolveLevel,
} from "../src/index";

const ALL_USERS = "g-all";
const ENGINEERING = "g-eng";
const PRODUCT = "g-product";

// root
// ├ product
// ├ platform
// │ └ payments
// │   └ gateway
// ├ archive (archived; irrelevant to permissions)
// ├ ada-personal (owner ada)
// │ └ ada-drafts
// └ rina-personal (owner rina)
const collections: CollectionNode[] = [
  { id: "product", parentId: null, personalOwnerId: null },
  { id: "platform", parentId: null, personalOwnerId: null },
  { id: "payments", parentId: "platform", personalOwnerId: null },
  { id: "gateway", parentId: "payments", personalOwnerId: null },
  { id: "archive", parentId: null, personalOwnerId: null },
  { id: "ada-personal", parentId: null, personalOwnerId: "ada" },
  { id: "ada-drafts", parentId: "ada-personal", personalOwnerId: null },
  { id: "rina-personal", parentId: null, personalOwnerId: "rina" },
];

function ctxFor(
  grants: GrantRow[],
  options: { userId?: string; isAdmin?: boolean; groupIds?: string[] } = {},
) {
  return createContext({
    userId: options.userId ?? "rina",
    isAdmin: options.isAdmin ?? false,
    groupIds: options.groupIds ?? [ALL_USERS],
    collections,
    grants,
  });
}

describe("resolveLevel", () => {
  it("root without any grant is none", () => {
    const ctx = ctxFor([]);
    expect(resolveLevel(ctx, null)).toBe("none");
    expect(resolveLevel(ctx, "product")).toBe("none");
  });

  it("root view to all_users makes every non-personal collection view", () => {
    const ctx = ctxFor([{ collectionId: null, groupId: ALL_USERS, level: "view" }]);
    for (const id of ["product", "platform", "payments", "gateway", "archive"]) {
      expect(resolveLevel(ctx, id)).toBe("view");
    }
    expect(resolveLevel(ctx, "ada-personal")).toBe("none");
  });

  it("explicit none on a child overrides parent edit; grandchild inherits none", () => {
    const ctx = ctxFor([
      { collectionId: null, groupId: ALL_USERS, level: "edit" },
      { collectionId: "payments", groupId: ALL_USERS, level: "none" },
    ]);
    expect(resolveLevel(ctx, "platform")).toBe("edit");
    expect(resolveLevel(ctx, "payments")).toBe("none");
    expect(resolveLevel(ctx, "gateway")).toBe("none");
  });

  it("nearest explicit grant wins, also when it raises the level", () => {
    const ctx = ctxFor([
      { collectionId: null, groupId: ALL_USERS, level: "none" },
      { collectionId: "payments", groupId: ALL_USERS, level: "edit" },
    ]);
    expect(resolveLevel(ctx, "platform")).toBe("none");
    expect(resolveLevel(ctx, "gateway")).toBe("edit");
  });

  it("takes the max across the user's groups", () => {
    const grants: GrantRow[] = [
      { collectionId: "platform", groupId: ENGINEERING, level: "view" },
      { collectionId: "platform", groupId: PRODUCT, level: "edit" },
    ];
    expect(resolveLevel(ctxFor(grants, { groupIds: [ALL_USERS, ENGINEERING] }), "platform")).toBe(
      "view",
    );
    expect(
      resolveLevel(ctxFor(grants, { groupIds: [ALL_USERS, ENGINEERING, PRODUCT] }), "platform"),
    ).toBe("edit");
  });

  it("ignores grants of groups the user is not in", () => {
    const ctx = ctxFor([{ collectionId: null, groupId: ENGINEERING, level: "edit" }]);
    expect(resolveLevel(ctx, "platform")).toBe("none");
  });

  it("gives non-owner non-admins none on a personal collection, even with root edit", () => {
    const grants: GrantRow[] = [{ collectionId: null, groupId: ALL_USERS, level: "edit" }];
    const ctx = ctxFor(grants, { userId: "rina" });
    expect(resolveLevel(ctx, "ada-personal")).toBe("none");
    expect(resolveLevel(ctx, "ada-drafts")).toBe("none");
  });

  it("ignores grants stored on a personal subtree", () => {
    const ctx = ctxFor([{ collectionId: "ada-drafts", groupId: ALL_USERS, level: "edit" }]);
    expect(resolveLevel(ctx, "ada-drafts")).toBe("none");
  });

  it("gives the owner edit on their personal subtree", () => {
    const ctx = ctxFor([], { userId: "ada" });
    expect(resolveLevel(ctx, "ada-personal")).toBe("edit");
    expect(resolveLevel(ctx, "ada-drafts")).toBe("edit");
  });

  it("gives admins edit everywhere, including someone's personal collection", () => {
    const ctx = ctxFor([], { userId: "boss", isAdmin: true });
    expect(resolveLevel(ctx, null)).toBe("edit");
    expect(resolveLevel(ctx, "gateway")).toBe("edit");
    expect(resolveLevel(ctx, "ada-personal")).toBe("edit");
    expect(resolveLevel(ctx, "ada-drafts")).toBe("edit");
  });

  it("resolves unknown collections to none, even for admins", () => {
    expect(resolveLevel(ctxFor([], { isAdmin: true }), "missing")).toBe("none");
  });

  it("does not loop forever on a corrupted parent cycle", () => {
    const ctx = createContext({
      userId: "rina",
      isAdmin: false,
      groupIds: [ALL_USERS],
      collections: [
        { id: "a", parentId: "b", personalOwnerId: null },
        { id: "b", parentId: "a", personalOwnerId: null },
      ],
      grants: [{ collectionId: null, groupId: ALL_USERS, level: "view" }],
    });
    expect(resolveLevel(ctx, "a")).toBe("none");
  });
});

describe("explainAccess", () => {
  it("points at the group and the collection where the grant was set", () => {
    const ctx = ctxFor(
      [
        { collectionId: null, groupId: ALL_USERS, level: "view" },
        { collectionId: "platform", groupId: ENGINEERING, level: "edit" },
      ],
      { groupIds: [ALL_USERS, ENGINEERING] },
    );
    expect(explainAccess(ctx, "gateway")).toEqual({
      level: "edit",
      reason: { kind: "grant", groupId: ENGINEERING, collectionId: "platform" },
    });
    expect(explainAccess(ctx, "product")).toEqual({
      level: "view",
      reason: { kind: "grant", groupId: ALL_USERS, collectionId: null },
    });
  });

  it("reports admin, owner and none", () => {
    expect(explainAccess(ctxFor([], { isAdmin: true }), "product").reason).toEqual({
      kind: "admin",
    });
    expect(explainAccess(ctxFor([], { userId: "ada" }), "ada-drafts").reason).toEqual({
      kind: "owner",
    });
    expect(explainAccess(ctxFor([]), "product")).toEqual({
      level: "none",
      reason: { kind: "none" },
    });
  });

  it("reports an explicit none as none", () => {
    const ctx = ctxFor([{ collectionId: "product", groupId: ALL_USERS, level: "none" }]);
    expect(explainAccess(ctx, "product")).toEqual({ level: "none", reason: { kind: "none" } });
  });
});

describe("can", () => {
  const grants: GrantRow[] = [
    { collectionId: "product", groupId: ALL_USERS, level: "view" },
    { collectionId: "platform", groupId: ALL_USERS, level: "edit" },
  ];
  const ctx = ctxFor(grants);

  it("checks view and edit thresholds", () => {
    expect(can(ctx, { action: "view", collectionId: "product" })).toBe(true);
    expect(can(ctx, { action: "edit", collectionId: "product" })).toBe(false);
    expect(can(ctx, { action: "edit", collectionId: "payments" })).toBe(true);
    expect(can(ctx, { action: "view", collectionId: "archive" })).toBe(false);
  });

  it("denies moving a document from edit to view", () => {
    expect(can(ctx, { action: "move_document", from: "platform", to: "product" })).toBe(false);
    expect(can(ctx, { action: "move_document", from: "product", to: "platform" })).toBe(false);
    expect(can(ctx, { action: "move_document", from: "platform", to: "payments" })).toBe(true);
  });

  it("denies moving a collection into itself or its descendant", () => {
    const admin = ctxFor([], { isAdmin: true });
    expect(can(admin, { action: "move_collection", collectionId: "platform", to: "gateway" })).toBe(
      false,
    );
    expect(
      can(admin, { action: "move_collection", collectionId: "platform", to: "platform" }),
    ).toBe(false);
    expect(can(admin, { action: "move_collection", collectionId: "payments", to: "product" })).toBe(
      true,
    );
  });

  it("requires edit on the collection, its current parent and the destination", () => {
    const local = ctxFor([
      { collectionId: "platform", groupId: ALL_USERS, level: "view" },
      { collectionId: "payments", groupId: ALL_USERS, level: "edit" },
      { collectionId: "product", groupId: ALL_USERS, level: "edit" },
    ]);
    // Edit on payments and product, but only view on payments' parent.
    expect(can(local, { action: "move_collection", collectionId: "payments", to: "product" })).toBe(
      false,
    );
    expect(can(local, { action: "move_collection", collectionId: "gateway", to: "product" })).toBe(
      true,
    );
    expect(can(local, { action: "move_collection", collectionId: "gateway", to: null })).toBe(
      false,
    );
  });

  it("archive does not change permissions: archived collections still resolve", () => {
    const local = ctxFor([{ collectionId: null, groupId: ALL_USERS, level: "view" }]);
    expect(can(local, { action: "view", collectionId: "archive" })).toBe(true);
  });
});

describe("filterViewable", () => {
  it("drops items in collections the user can't view, including restricted linked documents", () => {
    const ctx = ctxFor([{ collectionId: "product", groupId: ALL_USERS, level: "view" }]);
    const items = [
      { id: "brd", collectionId: "platform" },
      { id: "prd", collectionId: "product" },
      { id: "draft", collectionId: "ada-personal" },
      { id: "top", collectionId: null },
    ];
    expect(filterViewable(ctx, items).map((item) => item.id)).toEqual(["prd"]);
  });
});

describe("tree helpers", () => {
  const ctx = ctxFor([]);

  it("finds the owner of a personal tree", () => {
    expect(personalOwnerOf(ctx, "ada-drafts")).toBe("ada");
    expect(personalOwnerOf(ctx, "ada-personal")).toBe("ada");
    expect(personalOwnerOf(ctx, "gateway")).toBeNull();
    expect(personalOwnerOf(ctx, null)).toBeNull();
  });

  it("detects self and descendants", () => {
    expect(isSelfOrDescendant(ctx, "platform", "platform")).toBe(true);
    expect(isSelfOrDescendant(ctx, "platform", "gateway")).toBe(true);
    expect(isSelfOrDescendant(ctx, "payments", "platform")).toBe(false);
    expect(isSelfOrDescendant(ctx, "platform", null)).toBe(false);
  });
});
