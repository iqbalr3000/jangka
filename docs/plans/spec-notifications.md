# Spec — notifications

Status: agreed 2026-11-01. Phase 4, first of three from the `review` deferrals (then assigned reviewers, then
text-anchored comments). Builds on `review` (comments, status), `access`.

## Goal

People learn in the app when someone mentions them, replies in their threads, resolves their thread or moves a
document they created to another status, and can @mention colleagues in comments. No email (SPEC §5: no SMTP).

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Delivery | In-app only: a bell in the top bar with the unread count, a notification panel; the count is polled every 60 s and when the tab regains focus | No SMTP; polling is one cheap query, no extra connection per tab |
| Events | `mention` (you're @mentioned in a comment) · `reply` (a reply in a thread you started or replied in) · `resolved` (your thread was resolved by someone else) · `status` (a document you created moved to another status). Never for your own actions; one notification per recipient per event (a mention wins over a reply) | What needs your attention, without noise |
| Mentions | Typing `@` in a comment box suggests users who can view the document (name or email prefix, top 8); stored in the body as `@[Name](user:<id>)`, rendered as a name chip; edits that add mentions notify the new ones | Stable across renames; only people who can read the thread |
| Access | Recipients are filtered with `packages/permissions` at creation; opening a notification re-checks access, and the list hides notifications for documents the reader can no longer view | Revoked access mustn't leak titles or comments |
| Content | Notifications store ids (document, section, comment, actor), not comment text; the panel shows the document title and a short, current excerpt fetched at read time | Deleted or edited comments aren't frozen in a copy |
| Read state | Opening one marks it read; "Mark all as read" | Expected inbox behaviour |
| Retention | Notifications older than 90 days are deleted when the recipient's list is loaded | No scheduler needed; bounded table |

## Data model (migration `0015_notifications`)

**notifications** — `id`, `recipient_id fk users cascade`, `kind` (check: `mention`, `reply`, `resolved`, `status`),
`document_id fk documents cascade`, `section_key text null`, `comment_id fk comments null set null`,
`actor_id fk users null`, `status text null` (the new status for `status`), `read_at null`, `created_at`.
Index `(recipient_id, id desc)` (UUIDv7 ids are time-ordered; the list pages by id) and a partial index on
`recipient_id where read_at is null`.

## `packages/shared` (`notifications` subpath)

`notificationView { id, kind, document: { id, title, docType }, sectionKey, sectionTitle, threadId, actor: { id, name }
| null, excerpt: string | null, status, read, createdAt }`, `notificationList { items, nextCursor, unreadCount }`,
`markReadRequest { ids: uuid[] } | { all: true }`, mention helpers: `mentionToken(user)`, `mentionsIn(body) → userId[]`,
`bodyParts(body) → ({ text } | { mention: { id, name } })[]`, `plainBody(body)` (mentions as `@Name`, for excerpts).

## API

| Endpoint | Behavior |
|---|---|
| `GET /notifications?cursor=&limit=` | Own notifications, newest first (cursor pagination, default 20); drops ones for documents no longer viewable; purges the caller's rows older than 90 days |
| `GET /notifications/unread-count` | `{ count }` (viewable ones only) — the polled endpoint |
| `POST /notifications/read` | `{ ids }` or `{ all: true }`; `204` |
| `GET /documents/:id/mentionable?q=` | Users who can view the document, matching `q` (name / email prefix), max 8; requires view access |
| Comment create / edit | After the write: mentions (new ones on edit) and replies notify as above |
| Resolve, status change | Notify the thread author / document creator |

`services/notifications.ts`: `notify(db, events)` resolves each recipient's access once (`memberships` +
`loadAccess`), drops self-notifications and duplicates, inserts in one statement. Failures are logged and never fail
the action. Audit: none for notifications (read state is personal, not organisational).

## Web

- **Bell** in the top bar: unread badge (99+), panel with the list (icon per kind, "Ada mentioned you in Refund PRD ›
  Goals", excerpt, time), "Mark all as read", "Load more". Clicking opens `/d/$id`, the Comments tab on that section.
- **Comment composer**: `@` opens a suggestion list (↑/↓/Enter/Tab/Esc) inserting `@Name`; the box shows names, and
  picked names become tokens on submit (editing turns tokens back into names). Tokens render as chips in threads.
- **Landing**: notification links open `/d/$id?comments=<section>&thread=<root id>`; the page opens the Comments tab on
  that section, shows resolved threads if needed, scrolls to the thread with a brief highlight, and drops the params.

## Tests

**shared**: `mentionsIn` / `bodyParts` (multiple, malformed, unknown ids). **api**: mention notifies only viewers
(a mentioned user without access gets nothing); reply notifies root author and earlier repliers but not the actor;
resolve and status notify; edit adds notifications only for new mentions; no duplicates; list hides documents
whose access was revoked; unread count; mark read (ids, all); 90-day purge; mentionable filters by access and query.
**e2e**: a member is @mentioned on a PRD, sees the bell count, opens the notification and lands on the comment.

## Out of scope

Email or browser push; notification preferences; assigned reviewers and "Needs my review" (next feature);
text-anchored comments.
