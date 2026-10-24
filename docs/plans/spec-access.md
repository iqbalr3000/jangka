# Spec — access

Status: agreed 2026-10-24. Feature #3 (SPEC §11). Builds on `auth`. Next: `llm-providers`.
UI reference: `docs/design/Jangka Mockups.dc.html` — 1e (permissions matrix), 1c (shell + collection tree).
Semantics: SPEC §4 (unchanged unless stated here).

## Goal

Admins organize users into groups and grant groups `No access` / `View` / `Edit` on a collection tree.
Everyone has a private personal collection. Every content route resolves access through
`packages/permissions`, so `document` and later features only have to call it.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Resolver extra | `explainAccess()` returns level + reason (admin / owner / group grant + where it was set) | "Access: Edit (via Engineering)" and "Check a user's access" need the reason, not just the level |
| Root grants | `collection_grants.collection_id = null` = root, unique `NULLS NOT DISTINCT` | Plain unique treats NULLs as distinct → duplicate root grants |
| Admins group | No grant rows; always `edit`, locked in UI; a change targeting it → 400 | Admin access is implicit (SPEC §4) |
| Personal collections | Created eagerly in the user-creation transaction (setup, invite accept); migration backfills existing users | Every user always has one; no lazy-create paths |
| Personal root | Cannot be renamed, moved, or archived; may hold sub-collections | It is the user's identity space |
| Move into personal subtree | Allowed; grants on the moved subtree are deleted in the same transaction, the dialog says so | Moving to Personal means "make it private"; grants there would be dead rows |
| Move requirements | `edit` on the collection, its current parent, and the destination; destination not self/descendant | SPEC "edit on source and destination" |
| Hidden ancestors | A viewable collection whose parent isn't viewable is shown at the top level of the tree; parent name never leaked | Explicit child grant under a `none` parent |
| Not viewable | `404 not_found`; viewable but not editable → `403 forbidden` | Don't leak existence |
| Archive | Marks only that collection; descendants are hidden with it. Restore requires `edit`; if an ancestor is still archived → `409 conflict` "Restore the parent first" | No silent move to root (that would change permissions) |
| Matrix save | `PUT /admin/permissions` takes a diff of changed cells, no revision lock | Concurrent admin edits are rare; last write per cell wins |
| Last admin | Cannot remove yourself from Administrators (`409`) | With "cannot deactivate self", an active admin always remains |
| System groups | Cannot be renamed or deleted; `All Users` membership is implicit (read-only list) | SPEC §3 |
| Document counts | Not shown until `document`; tree/matrix show sub-collection structure only | No documents table yet |
| E2E | Collection-based: member can't see a collection until granted | Documents arrive in `document`; that feature extends the e2e |
| Admin view of others' personal collections | Reachable by URL and via "Check a user's access"; no listing UI | Deferred |

## Data model (migration `0001_access`)

- **collections** — `id`, `parent_id uuid null fk collections`, `name text not null`,
  `personal_owner_id uuid null unique fk users`, `archived_at null`, timestamps. Index on `parent_id`.
  Check: `personal_owner_id is null or parent_id is null` (personal collections are top-level).
- **collection_grants** — `id`, `collection_id uuid null fk collections on delete cascade`,
  `group_id fk groups on delete cascade`, `level text` check in (`none`,`view`,`edit`), timestamps.
  `unique nulls not distinct (collection_id, group_id)`.
- Backfill (custom SQL in the same migration): one personal collection per existing user, using Postgres 18 `uuidv7()`.
- Personal collection name: `"<user name>'s personal collection"`; the owner sees it labelled "Personal".

## `packages/permissions` (tests first, no I/O)

```ts
type Level = "none" | "view" | "edit";
type CollectionNode = { id: string; parentId: string | null; personalOwnerId: string | null };
type GrantRow = { collectionId: string | null; groupId: string; level: Level };
type AccessReason =
  | { kind: "admin" }
  | { kind: "owner" }
  | { kind: "grant"; groupId: string; collectionId: string | null }
  | { kind: "none" };

createContext(input: { userId; isAdmin; groupIds: string[]; collections: CollectionNode[]; grants: GrantRow[] }): PermissionContext
explainAccess(ctx, collectionId: string | null): { level: Level; reason: AccessReason }
resolveLevel(ctx, collectionId: string | null): Level
can(ctx, check: Check): boolean
  // Check = { action: "view" | "edit"; collectionId }
  //       | { action: "move_document"; from; to }
  //       | { action: "move_collection"; collectionId; to }
filterViewable<T extends { collectionId: string | null }>(ctx, items: T[]): T[]
personalOwnerOf(ctx, collectionId): string | null      // owner of the personal tree it belongs to
isSelfOrDescendant(ctx, ancestorId, collectionId): boolean
```

- Callers pass `groupIds` including the implicit `All Users` group; grants of other groups are ignored.
- Per group: nearest explicit grant walking up to root wins; none found → `none`. User level = max over groups;
  reason = the first group reaching that max.
- Unknown collection id → `none`. Parent-cycle safe (visited set).
- Archived state is not an input (archive ≠ permission change).

## `packages/shared/access` (new subpath)

Zod schemas: `level`, `accessReasonView` (reason with `groupName` / `collectionName` resolved for display),
`collectionSummary { id, name, parentId, personalOwnerId, level }`, `collectionList { rootLevel, items }`,
`collectionDetail { collection: summary | null (root), breadcrumbs: { id, name }[], access: { level, reason },
children: summary[], archivedAt }`, `createCollectionRequest { name, parentId }`,
`updateCollectionRequest { name?, parentId? }`, `group { id, name, systemKey, memberCount }`,
`groupList`, `createGroupRequest { name }`, `updateGroupRequest { name }`, `groupMember { id, name, email }`,
`groupMemberList { implicit, items }`, `addMemberRequest { userId }`,
`permissionGraph { groups, collections: { id, name, parentId }[], grants }`,
`permissionChanges { changes: { collectionId, groupId, level: Level | null }[] }` (null = inherit),
`accessCheck { user, root: { level, reason }, collections: { id, name, parentId, level, reason }[] }`.

## API

`Auth` gains `groupIds` (loaded once in the session middleware together with `isAdmin`, replacing the separate
`isAdmin` query). `services/access.ts` `loadPermissionContext(db, auth)` loads all collection nodes, all grants,
and the `All Users` id — small tables, one round trip each per request that needs them.

| Endpoint | Auth | Behavior |
|---|---|---|
| `GET /collections` | user | Tree for the sidebar: non-archived, not under an archived ancestor, viewable; others' personal trees excluded. `parentId` nulled when the parent isn't in the list. Includes `rootLevel` |
| `GET /collections/personal` | user | The caller's personal collection detail |
| `GET /collections/archived` | user | Archived collections the caller can edit |
| `GET /collections/:id/items` | view | `:id` = uuid or `root`. Detail + viewable breadcrumbs + access + viewable non-archived children |
| `POST /collections` | edit on parent | `{ name, parentId }`; parent must exist and not be archived. 201 summary |
| `PATCH /collections/:id` | edit | Rename and/or move (rules above). Personal root → `409` |
| `POST /collections/:id/archive` | edit | Personal root → `409`. 204 |
| `POST /collections/:id/restore` | edit | Ancestor archived → `409`. 204 |
| `GET /admin/groups` | admin | Groups with member counts (`All Users` = active users) |
| `POST /admin/groups` | admin | Duplicate name → `409` |
| `PATCH /admin/groups/:id` | admin | Rename; system group → `409` |
| `DELETE /admin/groups/:id` | admin | System group → `409`; members and grants cascade. 204 |
| `GET /admin/groups/:id/members` | admin | `All Users` → all active users, `implicit: true` |
| `POST /admin/groups/:id/members` | admin | `{ userId }`; `All Users` → `409`; already a member → 204 (idempotent) |
| `DELETE /admin/groups/:id/members/:userId` | admin | `All Users` → `409`; yourself from Administrators → `409`. 204 |
| `GET /admin/permissions` | admin | Full graph: groups, non-personal non-archived collections, grants |
| `PUT /admin/permissions` | admin | Diff in one transaction; admins group or personal subtree target → `400`; unknown ids → `404`. Returns the graph |
| `GET /admin/permissions/check?userId=` | admin | Effective level + reason for root and every non-personal collection |

Every mutating endpoint calls `audit()`.

## Web

- **Sidebar** (documents section): Home, Personal; `COLLECTIONS` header with `+` (when `rootLevel = edit`);
  `CollectionTree` (expand/collapse remembered per browser, active item highlighted, `--border-strong` guides);
  muted "Archived" link at the bottom.
- **Routes**: `_app/index.tsx` (root collection view), `_app/c.$collectionId.tsx`, `_app/personal.tsx`,
  `_app/archived.tsx` (list + Restore).
- **`CollectionView`**: breadcrumb, title, "Access: Edit (via Engineering)" line, `+ New collection` (edit),
  `⋯` menu (Rename, Move, Archive; not for root / personal root), Collections card, documents empty state
  "No documents yet".
- **Dialogs**: collection name (create / rename), move (destination list of editable collections, excluding the
  subtree itself; warns when moving into Personal removes grants), archive confirm.
- **Admin nav**: Users & invites, Groups, Permissions.
- `/admin/groups` — table (name, members, system badge, `⋯` Rename / Delete), "New group" dialog.
  `/admin/groups/$groupId` — members table with Remove, "Add member" dialog (user select). `All Users` read-only.
- `/admin/permissions` — `PermissionMatrix` per 1e: rows = root + collection tree, columns = groups
  (Administrators locked). Cell menu: Edit / View / No access / Inherit (shows inherited value + source).
  Inherited cells muted with `↳`. Staged changes bar: count + per-change summary
  ("Engineering: No access → Edit on Platform · affects 2 sub-collections") + Discard / Save changes.
  "Check a user's access" dialog: pick user → tree with effective level and reason.

## Tests

**permissions** (first) — SPEC §4 matrix plus: root no grant → `none`; nearest explicit grant wins across levels;
explain reason points at the granting collection; owner on own personal subtree → `edit`; unknown id → `none`;
`can` view/edit thresholds; move collection to self → denied.

**api** — groups CRUD + system-group guards + membership (idempotent add, implicit all_users, can't remove self from
admins); personal collection created on setup and invite accept; collections: create needs edit on parent,
404 for invisible, 403 for view-only edit, rename, move rules (descendant, destination edit, grants removed when moved
into personal), archive / restore (+ ancestor archived → 409), tree hides archived subtrees and lifts collections
under invisible parents; permissions PUT applies diff / inherit (null) / rejects admins group & personal targets;
check endpoint reports reason; a member's tree changes after a grant.

**e2e** — `access.spec.ts` (Playwright project depending on `onboarding`): admin creates "Platform"; Rina doesn't
see it; admin grants All Users `View` on Platform in the matrix and saves; Rina sees it and can't create inside it;
Rina sees her own Personal.

## Acceptance

1. SPEC §4 test matrix green.
2. E2E: a member can't see a collection without a grant and sees it after the grant.
3. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## Out of scope

Document counts and documents in collection views (→ `document`); drag-and-drop move; listing other users' personal
collections for admins; audit persistence (→ `history-audit`).
