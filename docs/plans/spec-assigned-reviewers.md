# Spec — assigned-reviewers

Status: agreed 2026-11-01. Phase 4, second of three from the `review` deferrals (after notifications, before
text-anchored comments). Builds on `review` (status workflow), `notifications`, `access`. PRD persona "Reviewer /
Stakeholder: reads, comments, approves. Mostly view-only"; DESIGN §5 deferred "Needs my review".

## Goal

Editors assign reviewers to a document; reviewers (view access is enough) approve or request changes while it's in
review; the document can only be approved once every counted reviewer has approved. Reviewers find what's waiting
for them under **Reviews** in the sidebar and get notified.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Who assigns | Editors of the document; candidates are active users who can view it (same rule as mention suggestions); not while approved | Reviewers must be able to read it; approved is frozen |
| Who reviews | Any assigned user with view access, including viewers | PRD persona; reviewers are mostly view-only |
| Verdicts | `approved` or `changes_requested`, only while `in_review`, by the reviewer themself; changeable until the document leaves review. Reasons go in comments | One action, no separate note field |
| Approval gate | `→ approved` also requires every **counted** reviewer to have `approved`, else `409 pending_reviews` (details: pending reviewers). Counted = active and still able to view; others show as "No access" so an editor can remove them | Nothing approved over a reviewer; revoked access can't lock a document |
| Self | An editor who is also a reviewer still needs their own verdict | No silent self-approval |
| Rounds | Moving back to `draft` (Back to draft, Reopen) clears every verdict; edits during review don't | A new round starts deliberately, without noise on every save |
| Notifications | `review_requested` → reviewers when the document enters review, or when assigned while it's in review; `review_verdict` → the document's creator. Usual rules: never yourself, access-filtered | Reviewers learn they're needed; the author learns the outcome |
| Reviews page | Sidebar **Reviews** with a count: documents in review where I'm a reviewer and haven't approved | DESIGN's "Needs my review" |
| Audit | `review.assign`, `review.unassign`, `review.verdict` | Mutations are audited |

## Data model (migration `0016_assigned_reviewers`)

**document_reviewers** — `id`, `document_id fk documents cascade`, `user_id fk users`, `assigned_by fk users`,
`verdict text null` (check: `approved`, `changes_requested`), `decided_at null`, `created_at`;
unique `(document_id, user_id)`, index `(user_id)`.

**notifications** — the kind check gains `review_requested` and `review_verdict` (drop and re-add the constraint);
`status` holds the verdict for `review_verdict`.

## `packages/shared` (`review` subpath)

`reviewVerdict = approved | changes_requested`; `reviewerView { user: { id, name }, verdict, decidedAt, counted }`;
`reviewerList { items, canManage, isReviewer }`; `setVerdictRequest { verdict }`; `myReviewList { items: { id, title,
docType, collectionName, myVerdict, requestedAt } }`; `pendingReviewsDetails { reviewers }`. `notificationKind` gains
the two kinds and `notificationView.verdict`.

## API

| Endpoint | Behavior |
|---|---|
| `GET /documents/:id/reviewers` | View access; reviewers in assignment order with `counted` |
| `PUT /documents/:id/reviewers/:userId` | Edit access, not approved; the user must be active and able to view (else `400`); idempotent `204`; notifies if in review |
| `DELETE /documents/:id/reviewers/:userId` | Edit access, not approved; `204` |
| `POST /documents/:id/review` | `{ verdict }`; caller must be a reviewer (`403`), document `in_review` (`409`); notifies the creator on a change |
| `GET /reviews` | Own pending reviews (in review, verdict not `approved`, document viewable and not archived), newest status change first, max 200 |
| `POST /documents/:id/status` | `→ in_review` notifies reviewers; `→ draft` clears verdicts; `→ approved` checks open comments, then reviewers (`409 pending_reviews`, details `{ reviewers: [{ id, name }] }`) |

## Web

- **Header**: reviewer avatars (initials) with a verdict mark (✓ approved, ! changes requested, ○ pending, muted
  "No access"); click opens a popover listing reviewers; editors get "Add reviewer" (the mention suggestions, so not
  themselves; the API allows self-assignment) and remove. Assigned reviewers in review see **Approve** / **Request changes** buttons next to the status.
- **Status menu**: the blocked-approval dialog handles both `open_comments` and `pending_reviews`.
- **Sidebar**: "Reviews" under Personal with a count badge (refreshed with the notification poll); `/reviews` lists the
  documents with my verdict and when review was requested.
- **Notifications panel**: "Ada requested your review on Refund PRD", "Rina approved Refund PRD" / "Rina requested
  changes on Refund PRD".

## Tests

**api**: only editors assign/unassign; candidates must view the document and be active; no changes while approved;
verdict only by a reviewer, only in review, view access suffices; approval blocked by a pending or
changes-requested reviewer and allowed once all approved; uncounted reviewers (revoked access, deactivated) don't
block; back to draft / reopen clears verdicts; `review_requested` on entering review and on assignment during review;
`review_verdict` to the creator; `/reviews` lists only own pending, viewable reviews; audit rows written.
**e2e**: the admin assigns the member to a PRD and requests review; the member sees it under Reviews, approves; the
admin's approval goes through.

## Out of scope

Review due dates or reminders; required reviewer counts or groups as reviewers; per-section sign-off; review history
across rounds beyond the audit log.
