# Spec — review

Status: agreed 2026-10-25. Feature #12 (SPEC §11). Builds on `document`, `access`, `history-audit`. Next: `impact-retrieval`.
Technical reference: SPEC §3 (`documents.status`, `comments`), §4, PRD FR-073/074, DESIGN §6.3 (`Draft ▾`), §10.

## Goal

Readers comment on sections in threads; editors reply and resolve. A document moves draft → in review → approved;
an approved document is frozen until it's reopened, and it can't be approved while threads are still open.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Who comments | Anyone who can **view** the document (SPEC §4 view gains "comment") | Reviewers often have view access only; DESIGN §10 "read, comment, and export" |
| Threads | One level: root comments on a section, flat replies to a root; replying to a reply → `400` | Enough for review discussions; simple UI |
| Anchor | Section (`section_key`), not a text range | Text-range anchors need TipTap marks that survive edits; out of scope |
| Edit / delete | Author only; delete is soft (body hidden as "Comment deleted", replies stay) | Threads keep their context |
| Resolve / reopen | Root thread only; by its author or anyone with edit access | Readers can close their own questions; editors close the rest |
| Status changes | Anyone with edit access, any allowed transition: draft → in_review, in_review → approved \| draft, approved → draft ("Reopen"); same-status → no-op `400` | Small teams; who approved is in the audit log |
| Approved = frozen | Every section write (PUT, restore, draft, draft from source, revise accept) → `409 document_approved`; enforced in `saveSection` and the generation endpoints; editor read-only with a banner | Approval means the approved text doesn't change |
| Open threads | Approve → `409 open_comments` (details: section keys with open threads) | Nothing is approved with unanswered review comments |
| Comments when approved | Still allowed (questions about an approved doc are normal) | Comments aren't content |
| Notifications | None | No SMTP (SPEC §5) |

## Data model (migration `0010_review`)

- **comments** — `id`, `document_id fk cascade`, `section_key text`, `parent_id fk comments null` (root when null),
  `author_id fk users`, `body text` (1–4000), `edited_at null`, `deleted_at null`, `resolved_at null`,
  `resolved_by fk users null`, `created_at`. Indexes `(document_id, section_key)`, `parent_id`.
- **documents** — add `status_changed_at timestamptz null`, `status_changed_by fk users null`.

## `packages/permissions`

`Action` gains `"comment"` (requires view). Resolver tests: viewer can comment, `none` can't.

## `packages/shared` (`review` subpath)

`commentView { id, sectionKey, parentId, author: { id, name } | null, body: string | null (null when deleted),
editedAt, deleted, createdAt, canEdit }`, `commentThread { root: commentView, replies: commentView[], resolvedAt,
resolvedBy, canResolve }`, `commentList { threads, openCountBySection: Record<string, number> }`,
`createCommentRequest { sectionKey, parentId?, body }`, `updateCommentRequest { body }`,
`setStatusRequest { status }`, `STATUS_TRANSITIONS`. `documentDetail` gains `statusChange: { at, by } | null`.
Error codes `document_approved`, `open_comments`. `POST /documents/:id/comments` returns `{ id }` (the client refetches
the list); `POST /documents/:id/status` returns the document summary.

## API

| Endpoint | Behavior |
|---|---|
| `GET /documents/:id/comments?state=open\|all` | View access; threads oldest first per section; `openCountBySection` always over all threads |
| `POST /documents/:id/comments` | View access; `sectionKey` must exist on the document; `parentId` must be a root of the same document and section; audit `comment.create` |
| `PATCH /comments/:id` | Author only, not deleted; sets `edited_at`; audit `comment.update` |
| `DELETE /comments/:id` | Author only; sets `deleted_at`; audit `comment.delete` |
| `POST /comments/:id/resolve` / `reopen` | Root only; author or edit access; audit `comment.resolve` / `comment.reopen` |
| `POST /documents/:id/status` | Edit access; allowed transition; approve requires no open threads; sets `status_changed_*`; audit `document.status` { from, to } |
| Section writes | `409 document_approved` while approved (in `saveSection`, and before generation starts in draft/revise) |

Comment routes resolve the document from the comment and check access through `packages/permissions` (404 when the
document isn't viewable).

## Web

- **Header**: status menu (`Draft ▾` / `In review ▾` / `Approved ▾`) with the allowed transitions for editors, plain
  badge for viewers; approving with open threads shows the server's message listing the sections.
- **Approved banner** (like the view-access banner): "Approved by <name> <time>. Reopen to edit."; editors and
  generation controls are disabled.
- **Comments tab** (right panel: Chat | History | Trace | Comments): section filter (all / one), "Show resolved"
  toggle, threads (author, relative time, edited marker, body; replies indented; Reply, Edit, Delete for the author,
  Resolve / Reopen), new-comment box for the selected section.
- **Section header**: "💬 n" badge with the open-thread count; click opens Comments on that section. View users see
  the Comments tab and can comment.

## Tests

**permissions**: `comment` action levels. **api**: viewer comments and replies; non-viewer 404; reply to a reply 400;
section must exist; edit/delete author only; deleted body hidden, replies kept; resolve by author and by editor,
viewer non-author 403; status transitions (valid / invalid / same); approve blocked by open threads with section keys;
approved blocks PUT, restore, draft and revise (`409 document_approved`), comments still allowed; reopen unlocks; all
mutations audited (guard).
**e2e**: a viewer comments; the editor replies and resolves; request review → approve → section editor read-only and
banner shown → reopen → editable again.

## Acceptance

1. Threaded comments per section with resolve; status workflow draft → in_review → approved with approval freezing
   the content and requiring resolved threads.
2. `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e` pass.

## Out of scope

Text-range anchored comments; @mentions and notifications; assigned reviewers / "Needs my review"; approval by a
second person; comment reactions; exporting comments.
