# Spec — text-anchored-comments

Status: agreed 2026-11-01. Phase 4, last of the three `review` deferrals (after notifications and assigned
reviewers). Builds on `review` (comments per section), `notifications` (thread focus), `requirement-chips`
(decoration pattern).

## Goal

A comment can point at the exact words it's about: select text in a section, comment, and the words are highlighted
while the thread is open. Section content, exports, history and the LLM context don't change.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Anchor model | Root comments may store `quote` (the selected text, 1–500 chars) with `prefix` / `suffix` (up to 32 chars around it); no marks in the content | Content, markdown, export and history untouched; viewers can anchor too |
| Matching | Client side: the section's text is flattened (blocks separated by `\n`), every occurrence of `quote` is scored by how much of `prefix` / `suffix` matches, the best wins; none → detached | Survives edits elsewhere; repeated phrases resolve to the right place |
| Detached | The thread stays in its section, the panel shows the old quote with "Original text changed" | Threads never vanish |
| Who | Anyone who can comment, editable or read-only, including approved documents | Reviewers are mostly view-only |
| Creating | Selecting text shows **Comment**: in the formatting menu for editors, in a small bubble otherwise. Not in code blocks or diagrams. It opens the Comments tab on that section with "Commenting on “…”" above the composer (× drops it) | One gesture from the text |
| Highlight | Open, attached threads only: a light background (`--status-partial` tint) with a bottom border; click opens the thread in the panel (the notification focus). No toggle | Visible but quiet; YAGNI |
| Replies | No anchor of their own (`400` if sent) | They belong to the root's anchor |
| Server | Stores and validates the anchor; never matches it | Matching needs the editor's text model |

## Data model (migration `0017_comment_anchors`)

**comments** gains `quote text null`, `quote_prefix text null`, `quote_suffix text null`.

## `packages/shared` (`review` subpath)

`commentAnchor { quote: 1–500 chars (trimmed of surrounding whitespace by the client), prefix: ≤ 32, suffix: ≤ 32 }`;
`createCommentRequest.anchor?: commentAnchor` (roots only); `commentView.anchor: commentAnchor | null`.

## API

`POST /documents/:id/comments` accepts `anchor` on root comments (`400` on replies); `GET /documents/:id/comments`
returns it on each comment. Editing a comment keeps its anchor. Audit metadata gains `anchored: true`.

## Web

- `lib/text-anchor.ts` (pure): `flatten(doc)` → text plus offset→position map (text nodes, `\n` between textblocks,
  code blocks and atoms skipped); `anchorFor(text, from, to)` → `{ quote, prefix, suffix }`;
  `findAnchor(text, anchor)` → `{ from, to } | null` (best prefix/suffix score).
- `CommentAnchors` TipTap extension: decorations for the open threads' anchors (index via transaction meta, like
  requirement chips), class `comment-anchor` with `data-thread`.
- `CommentBubble` (read-only editors) and a **Comment** button in `FormatMenu`: build the anchor from the selection
  and call `onCommentOnText(sectionKey, anchor)`.
- Document page: `pendingAnchor` state → Comments tab on the section; `CommentsPanel` shows it above the composer and
  sends it with the new thread. Clicking a highlight sets the comment focus.
- Threads show the quote as a small blockquote; detached ones (anchor not found in the section's current content) add
  "Original text changed".

## Tests

**shared**: anchor validation. **api**: an anchored root comment round-trips; anchors on replies are refused; edits
keep the anchor; over-long quotes fail. **web unit**: `flatten` across paragraphs, marks, lists and tables;
`anchorFor` / `findAnchor` round-trip; repeated phrases pick the occurrence by prefix/suffix; edits around the quote
still match; a removed quote returns null. **e2e**: a viewer selects words in a section and comments; the words are
highlighted for the editor; clicking the highlight opens the thread; resolving removes the highlight; after the
editor rewrites the sentence the thread shows "Original text changed".

## Out of scope

Anchors on replies; re-anchoring a detached thread; highlights in exports; comments on diagrams or code blocks;
showing resolved anchors.
