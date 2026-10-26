# Spec — editor & chat polish

Status: agreed 2026-10-26. Phase 4 item. Builds on `assistant`, `document`.
Technical reference: `spec-assistant.md` (SSE, generation lock, coverage), DESIGN §3 (motion), §6.3.

## Goal

1. Chat: the composer is usable again as soon as the reply is written — coverage assessment no longer holds the
   Stop button or the document lock. Streamed text is revealed with a fast, even typing animation, and the wait
   before the first token shows a proper "thinking" state.
2. Editor: Notion-like blocks — every block is visibly a row that can be deleted, moved, duplicated or turned into
   another type; formatting floats over the selection instead of shifting the layout; `/` inserts blocks. No
   change to the content whitelist, markdown serializer or export.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Composer release | New SSE event `reply_done` after the reply is saved; the client switches Stop → Send on it | Coverage (second LLM call) is advisory and was blocking the next turn |
| Lock | The chat route releases the generation lock at `reply_done`; coverage runs unlocked | Otherwise the next send gets `409 generation_in_progress` |
| Stale coverage | Coverage is saved only if the reply is still the thread's latest message | A slow assessment of an older transcript must not overwrite a newer one |
| Send during coverage | The client aborts the coverage-phase stream, then starts the new turn; the next turn reassesses | One stream per document client-side; no queued work |
| Draft during coverage | Draft / Revise actions stay disabled until `coverage` (or `done`) arrives | Draft gate reads coverage state |
| Typing animation | Client-side buffered reveal of streamed text (rAF), not delayed reply | User option 1A; no fake wait on top of real latency |
| Thinking state | Animated indicator in the assistant bubble until the first `text` delta, label reflects phase | User request |
| Reduced motion | Reveal is immediate and indicator is static under `prefers-reduced-motion` | DESIGN §3 |
| Trailing empty line | `StarterKit.configure({ trailingNode: false })`; clicking below the last block appends a paragraph | TrailingNode forced an undeletable empty paragraph after tables/diagrams/code |
| Formatting toolbar | Replaced by a BubbleMenu (`@tiptap/react/menus`) on text selection | Floating; no layout shift in the heading row |
| Block handle | Custom gutter (`+` and `⋮⋮` menu), no drag-and-drop | User option 2B rejected: official drag handle pulls Yjs/collaboration peers |
| Slash menu | `@tiptap/suggestion` + React popup positioned with `@floating-ui/dom` | User option 3A; official, small |
| New dependencies | `@tiptap/suggestion@3.32.0`, `@floating-ui/dom` (already installed as a peer; made explicit) | Only these two |

## Chat

### Server — `apps/api/src/routes/assistant.ts`

- `generate()` passes the `run` callback an idempotent `unlock()` in addition to `send` and `signal`; `finally` still
  calls it (no-op if already released).
- `POST /:id/chat` sequence: `message_start` → `references`? → `text`* → save reply → `reply_done { messageId }` →
  `unlock()` → `assessCoverage` → save state (guarded) → `coverage` → `done`.
- Guard: before `saveState`, read the thread's latest message id; save and send `coverage` only if it equals
  `messageId`. Otherwise skip both and send `done`.
- Provider error / abort during the reply: unchanged (no `reply_done`).
- Draft and revise routes are unchanged.

### Shared — `packages/shared/src/assistant.ts`

- `assistantEvent` gains `z.object({ type: z.literal("reply_done"), messageId: z.string() })`.

### Client — `apps/web/src/lib/use-assistant.ts`

- New state `phase: "coverage" | null` (exposed as `assistant.coverageUpdating`). On `reply_done` for kind `chat`:
  `running` → `null`, `phase` → `"coverage"`, invalidate the chat query. The stream keeps running for `coverage`.
- `run()`: if a stream is open only for coverage, abort it and start the new run immediately. Each run carries a
  generation token; the `finally` of an older run must not clear state that belongs to a newer run.
- Stop button shows only while `running !== null`; `canGenerate` (Draft / Revise / section actions) is also false
  while `coverageUpdating`.
- `stop()` is unchanged; Esc does nothing during the coverage phase.

### State across navigation (added 2026-10-26)

- The assistant state moves out of the page into a store per document (`createAssistantStore` in
  `apps/web/src/lib/use-assistant.ts`, kept in a module-level map for the life of the tab; `useAssistant(documentId)`
  reads it with `useSyncExternalStore`). In-app navigation no longer drops a running draft: coming back shows live
  progress, Stop, locked sections, and sections finished meanwhile. Reload / closing the tab still disconnects and
  stops it (hard rule #9).
- Section saves update the document cache through `applySavedSection` (`lib/documents.ts`, shared with human saves).
  Editor remount counters (`generations`) live in the store and are bumped through TanStack's `notifyManager`, so the
  remount renders in the same flush as the cache update.
- Draft all / Draft from source are disabled while `coverageUpdating` ("Updating coverage…").

### Typing reveal — `apps/web/src/lib/use-smooth-text.ts`

- `useSmoothText(target: string, animate: boolean): string` — a rAF loop that reveals characters from `target`.
  Characters per frame grow with the backlog: `max(2, ceil(backlog / 12))`, so a big chunk drains in about
  200 ms and a slow stream still looks typed. The pacing function is exported pure and unit-tested.
- `animate = false` or `prefers-reduced-motion` → returns `target` unchanged.
- The live reply bubble keeps rendering through `useSmoothText` after `reply_done` until the reveal catches up. It is
  then replaced by the saved message (same id; dedupe like `stopped`). If the user sends again mid-reveal, the
  reveal snaps to the full text.
- The blinking caret at the end of streaming text (DESIGN §3) stays until the reveal finishes.

### Thinking indicator — `apps/web/src/components/assistant/thinking-indicator.tsx`

- Shown in the assistant bubble while the reply is `""` (replaces the `…` placeholder).
- Three dots with a staggered wave (CSS keyframes, 1.2 s loop) and a label with a subtle shimmer:
  - after send: "Thinking…"
  - after a `references` event: "Reading N related sections…"
  - after 8 s without text: "Still thinking…"
- Reduced motion: static dots, no shimmer.
- Coverage checklist header shows a small spinner and "Updating…" while `coverageUpdating`.

## Editor

### Extensions — `apps/web/src/lib/editor-extensions.ts`

- `StarterKit.configure({ …, trailingNode: false })`.
- `SlashCommand` extension built on `@tiptap/suggestion` (char `/`, allowed at line start or after whitespace, not
  inside code blocks or table cells). Items, filtered by prefix and aliases: Text, Heading 3, Heading 4, Bulleted
  list, Numbered list, Quote, Code block, Table (3×3 with header row), Diagram (`NEW_DIAGRAM`), Divider. All map to
  existing whitelisted nodes.
- Placeholder: an empty document keeps the current texts and the dashed box. In a non-empty editable section, the
  focused empty paragraph shows "Type '/' for commands". Read-only non-empty sections show nothing.

### Click below last block — `section-editor.tsx`

- A strip about 24 px high under `EditorContent`, editable only. On mousedown: if the last top-level node is not an
  empty paragraph, append one; focus the end.

### Bubble menu — `apps/web/src/components/documents/format-menu.tsx`

- `BubbleMenu` shown for a non-empty text selection; hidden in code blocks and for node selections (diagrams).
- Items: Turn into (Text / H3 / H4 / Bulleted / Numbered / Quote), Bold, Italic, Inline code, Link.
- Link: an inline URL input inside the menu (Enter applies, Esc cancels, "Remove" when a link is active). Only
  `http`, `https` and `mailto` are accepted (same as the link extension); anything else shows an inline error.
  Replaces `window.prompt`.
- The old `Toolbar`, the `toolbarSlot` portal and the slot `div` in `section-block.tsx` are removed.

### Block gutter — `apps/web/src/components/documents/block-gutter.tsx`

- Editable only. The article's left padding is 44 px from `sm` (24 px below), and the editor frame extends into it
  (`-ml-6 pl-6 sm:-ml-11 sm:pl-11`), so `+` and `⋮⋮` (20 px each) always fit, whatever the sidebars do; below `sm`
  only `⋮⋮` shows.
- The hovered top-level block is resolved with `view.posAtCoords` → depth-1 node. Its DOM rect positions the
  gutter on the block's first line. On touch or without hover, the gutter follows the block containing the
  selection.
- `+` inserts an empty paragraph after the block and opens the slash menu.
- `⋮⋮` opens the existing `DropdownMenu`: Turn into (textblocks and lists only), Duplicate, Move up, Move down,
  Delete. While the menu is open, the block is shown as selected (`NodeSelection` styling).
- Block operations are pure transaction helpers in `apps/web/src/lib/block-commands.ts` (`moveBlock`,
  `duplicateBlock`, `deleteBlock`), unit-tested on a plain `EditorState`; `turnInto` runs editor commands and is
  covered by e2e only (a headless `Editor` needs a DOM).
- Deleting the only block leaves an empty paragraph, so the empty-section placeholder appears.

### Typography — `apps/web/src/styles.css` `.section-prose`

- Block rhythm: paragraphs `0.5em`, before headings `1.5em` (h3) / `1.2em` (h4), lists `0.2em` between items,
  nested lists tighter. Divider `1.25em` vertical margin. Blockquote and table spacing aligned with the same scale.
- `.ProseMirror-selectednode` outline (primary, 2 px) for diagrams, dividers and blocks selected from the gutter.
- Exact values are tuned with Iqbal in the UI pass.

## Docs

- DESIGN §3 Motion: streaming text uses a fast buffered typing reveal plus a caret, and a thinking indicator before
  the first token; both are disabled under reduced motion.
- DESIGN §6.3: formatting via the selection bubble menu, block gutter, and `/` commands (replaces the heading-row
  toolbar).
- `spec-assistant.md` is untouched (historical); this spec supersedes its Stop/Concurrency rows for chat.

## Tests

- API (`assistant` route tests, fake provider): `reply_done` arrives before `coverage`. A second `POST /chat` sent
  after `reply_done` but before `done` succeeds (no 409). A stale assessment is not saved and no `coverage` is sent.
- Web unit (new `apps/web` vitest project, node env): smooth-text pacing; `block-commands` (move at the edges,
  duplicate, delete the last block → empty paragraph); link normalization.
- e2e (Playwright, `editor.spec.ts`): `/table` inserts a table with no forced line after it; clicking under it
  continues the section; Bold from the bubble menu; gutter Delete; all persisted after reload. Diagram insertion in
  existing specs moved to `/diagram`. Composer release before coverage is covered by the API test (the fake provider
  assesses instantly).

## Out of scope

- Drag-and-drop reordering, table row/column controls, typing animation for section drafting and revise
  proposals, and stripping trailing empty paragraphs already saved in existing documents.
