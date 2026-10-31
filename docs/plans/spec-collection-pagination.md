# Spec — collection-pagination

Status: agreed 2026-10-31. Phase 4 enhancement. Builds on `access`, `document`.
Found by `pnpm test:perf`: `GET /collections/:id/items` returned every document (p95 144 ms at 5,000 in one
collection), against the API convention (cursor pagination, default 50, max 200).

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Shape | New `GET /collections/:id/documents?cursor=&limit=` → `{ items, nextCursor }`; `/items` keeps the collection, breadcrumbs, access and children but drops `documents` | Later pages don't recompute the tree |
| Order | Most recently updated first, ties by id (`updated_at desc, id desc`) | Unchanged list order; matches the Updated column |
| Cursor | Opaque keyset cursor of the last row's `(updated_at, id)` (base64url JSON, Zod-validated; invalid → `400`) | Stable paging over a non-unique sort key |
| Index | `documents_collection_updated_idx` on `(collection_id, updated_at desc, id desc)` where `archived_at is null` (migration `0013`) | The keyset query reads the index in order |
| Moving rows | A document edited while someone pages may move to page one and be skipped or repeated later | Inherent to "recently updated"; pages already loaded don't jump |
| UI | First 50, then **Load more** (as Audit log); the list heading shows the total (`Documents · 1,240`) from the existing per-collection counts | Consistent with existing paging; counts cost nothing |
| Access | Same as `/items`: viewable collection (root: viewable root), non-archived documents only | Unchanged rules, through `packages/permissions` |

## API

- `collectionDocumentsQuery { cursor?: string, limit: 1–200 = 50 }`; `collectionDocumentList { items: DocumentSummary[],
  nextCursor: string | null, total: number }`.
- `collectionDetail` loses `documents`.
- `services/documents.ts`: `documentsPage(db, collectionId, { cursor, limit })` replaces `documentsIn`.

## Web

- `collectionDocumentsQuery(id)` as an infinite query under `collectionsKey` (existing invalidations cover it).
- `CollectionView` renders the infinite list with **Load more** and the total in the heading; the empty state shows
  when the first page is empty.

## Tests

**api**: first page of 50 in order with `nextCursor`; following pages until `null`, no duplicates across pages;
`limit` bounds; invalid cursor `400`; archived documents excluded; viewer without access `404`; root documents;
`/items` has no `documents`. **perf**: `test:perf` measures the first page of the 5,000-document collection.
**e2e**: existing collection flows keep passing (they create fewer than 50 documents).
