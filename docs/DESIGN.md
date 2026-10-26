# Jangka — UX/UI Design

|         |                                                               |
| ------- | ------------------------------------------------------------- |
| Product | Jangka                                                        |
| Status  | Draft v0.1                                                    |
| Related | `docs/PRD.md` (requirements), `docs/SPEC.md` (technical spec) |

## 1. Design principles

1. **The document is the hero.** Chat, outline, and admin chrome support the document; they never compete with it.
2. **Show gaps, don't hide them.** Missing and partial sections are visible at a glance. Empty is an honest state, not an error.
3. **The assistant proposes, the human decides.** LLM output arrives as drafts and diffs the user accepts; nothing silently overwrites human edits.
4. **Precise, calm, technical.** Like a drafting table: grid, straight lines, few colors, monospace for anything with an ID.
5. **Predictable access.** Users always know why they can or can't see something ("Restricted document", visible inherited permissions).

## 2. Brand

**Name.** _Jangka_ is the drafting compass engineers and architects use to draw precise plans.
The product is the instrument for drawing precise specs before building.

**Tagline.** _Precise specs for product & engineering teams._

**Logo concept.** A drafting compass reduced to an inverted "V" with a pivot dot, which also reads as the
"a" in the wordmark: `jΛngka`. Wordmark in lowercase, geometric sans. Icon works at 16 px (favicon) as the compass glyph alone.

**Voice.** Direct, short, technical. Prefer verbs over adjectives. Say what happened and what to do next.
- ✅ "3 required sections still missing. Answer the questions or draft anyway."
- ❌ "Oops! Looks like your amazing document isn't quite ready yet 🚀"

**Motif.** Faint blueprint grid (8 px minor, 40 px major lines) used only in empty states, setup, and login backgrounds. Never behind document text.

## 3. Design tokens

Defined as CSS variables on `:root`, overridden under `[data-theme="dark"]` and `prefers-color-scheme: dark`.
shadcn/ui components consume these via the Tailwind theme.

### Color

| Token               | Light       | Dark        | Use                                           |
| ------------------- | ----------- | ----------- | --------------------------------------------- |
| `--bg`              | `#FAFAF9`   | `#0C0F14`   | App background ("paper")                      |
| `--surface`         | `#FFFFFF`   | `#141922`   | Panels, cards, editor                         |
| `--surface-2`       | `#F4F4F2`   | `#1B2130`   | Sidebars, hover rows                          |
| `--border`          | `#E5E5E2`   | `#262D3A`   | Dividers, inputs                              |
| `--surface-hover`   | `#ECECE9`   | `#222938`   | Hover on `--surface-2` (sidebar rows)         |
| `--border-strong`   | `#DCDCD8`   | `#2F3747`   | Tree guide lines                              |
| `--text`            | `#1A1A19`   | `#E7E9EE`   | Primary text                                  |
| `--text-muted`      | `#5C5C58`   | `#9AA3B2`   | Secondary text, metadata                      |
| `--primary`         | `#1D4ED8`   | `#6E9BFF`   | Blueprint blue: primary actions, links, focus |
| `--primary-fg`      | `#FFFFFF`   | `#0C0F14`   | Text on primary                               |
| `--grid`            | `#1D4ED80F` | `#6E9BFF14` | Blueprint grid minor lines (8 px)             |
| `--grid-major`      | `#1D4ED81A` | `#6E9BFF24` | Blueprint grid major lines (40 px)            |
| `--status-empty`    | `#A8A29E`   | `#5B6473`   | Section: empty                                |
| `--status-partial`  | `#B45309`   | `#F0A14A`   | Section: partial, warnings                    |
| `--status-complete` | `#15803D`   | `#4ADE80`   | Section: complete, success                    |
| `--danger`          | `#B91C1C`   | `#F87171`   | Errors, destructive actions                   |
| `--diff-add`        | `#DCFCE7`   | `#13301F`   | Diff insertions                               |
| `--diff-del`        | `#FEE2E2`   | `#3A1618`   | Diff deletions                                |

Status is never communicated by color alone: always paired with an icon and label (○ Empty, ◐ Partial, ● Complete).

### Typography

| Token         | Value                                   | Use                                                |
| ------------- | --------------------------------------- | -------------------------------------------------- |
| `--font-sans` | Inter, system-ui, sans-serif            | UI and document body                               |
| `--font-mono` | JetBrains Mono, ui-monospace, monospace | Requirement IDs, code, Mermaid source, setup token |
| Scale         | 12 / 13 / 14 / 16 / 20 / 24 / 32 px     | 14 = UI default, 16 = document body                |
| Document body | 16 px / 1.7 line-height, max width 72ch | Editor and PDF export                              |
| Weights       | 400, 500, 600                           | No 700+ in UI                                      |

### Spacing, radius, elevation

- Spacing: 4 px base (`4, 8, 12, 16, 24, 32, 48`).
- Radius: `--radius-sm 4px` (inputs, chips), `--radius-md 8px` (cards, dialogs). No pill buttons.
- Elevation: borders first; shadows only for floating layers (menus, dialogs, toasts): `0 4px 16px rgb(0 0 0 / 0.08)`.
- Motion: 120–180 ms ease-out for UI. Streamed chat replies are revealed with a fast, even typing animation plus a
  blinking caret; before the first token the reply bubble shows a thinking indicator (wave dots, shimmer label). Respect
  `prefers-reduced-motion` (text shown whole, indicator static).

## 4. Information architecture

```
/setup                      First-run wizard (token → org → admin → LLM, optional)
/login                      Password and/or SSO buttons
/                           Home: recent documents + collections browser
├── /c/:collectionId        Collection view (sub-collections + documents)
├── /personal               My personal collection
├── /d/:documentId          Document workspace
│   ├── ?panel=chat         Interview / revise chat (default)
│   ├── ?panel=history      Section versions
│   ├── ?panel=trace        Traceability (Phase 2)
│   └── ?panel=comments     Comments (Phase 3)
├── /search                 Search titles and content (viewable docs only)
└── /admin
    ├── /users              Users & invites
    ├── /groups             Groups & members
    ├── /permissions        Groups × collections matrix
    ├── /llm                LLM providers & default model
    ├── /auth               Password login & OIDC providers
    ├── /templates          Template library (Phase 3)
    ├── /audit              Audit log (Phase 2)
    └── /settings           Org name, defaults
```

## 5. App shell

Visual reference: `docs/design/Jangka Mockups.dc.html` (artboard 1c).

```
┌──────────────────────────────────────────────────────────────────────────┐
│ jΛngka   [⌘K Search documents…]                        [+ New]  (IR) ▾  │  56px top bar
├──────────────┬───────────────────────────────────────────────────────────┤
│ (A) Acme     │                                                           │
│ Home         │                     Main content                          │
│ Personal     │                                                           │
│ COLLECTIONS +│                                                           │
│ ▸ Product 12 │                                                           │
│ ▾ Platform   │                                                           │
│  │ ▸ Payments│                                                           │
│ ▸ Archive    │                                                           │
│              │                                                           │
│ ‹‹ Collapse ⌘B                                                           │
└──────────────┴───────────────────────────────────────────────────────────┘
  240px sidebar, collapsible to 56px icons
```

- Wordmark `jΛngka`: 19 px, weight 600, letter-spacing −0.03em, `Λ` in `--primary`.
- Sidebar: org block (initial, org name, host) on top; Home / Personal; `COLLECTIONS` header (mono, 11 px) with `+`;
  tree with document counts and `--border-strong` guide lines; active collection = surface bg + `--primary` inset left bar.
- **Admin lives in the profile menu** (avatar ▾: name/email/role, Profile & preferences, Theme, Admin panel, Sign out),
  not in the sidebar. Admin pages swap the sidebar for an admin nav with "← Back to documents".
- `⌘B` collapses the sidebar (state remembered per browser). Theme: System / Light / Dark, remembered per browser.
- `+ New` opens the New document dialog (type, title, collection, optional source document).
- `⌘K` command palette: jump to document, collection, admin page; actions like "New PRD".
- Collections the user can't view never appear in the tree.

Mockup items **not adopted** (decided 2026-10-23): LLM fallback provider and per-user model choice (1f),
document-level version label "v0.4" (1a; revisions are per section until `history-audit`), "Needs my review"
sidebar item (until `review`), "Profile & preferences" page (later).

## 6. Key screens

### 6.1 Setup wizard

```
┌────────────────────── blueprint grid background ──────────────────────┐
│                         jΛngka                                         │
│              ●───────○───────○───────○                                 │
│            Token   Organization  Admin   LLM (optional)                │
│  ┌──────────────────────────────────────────────┐                      │
│  │ Setup token                                  │                      │
│  │ [ jk_setup_xxxxxxxxxxxx                    ] │  mono input          │
│  │ Find it in the container logs:               │                      │
│  │ docker logs jangka | grep "SETUP TOKEN"      │  copyable code       │
│  │                                   [Continue] │                      │
│  └──────────────────────────────────────────────┘                      │
└────────────────────────────────────────────────────────────────────────┘
```

- Step 4 (LLM) can be skipped; home then shows a banner for admins: "Add an LLM provider to start drafting."

### 6.2 Home / collection view

```
Platform / Payments                                   [+ New]  [⋯]
Access: Edit (via Engineering)                                         ← why you have access

┌ Collections ─────────────────────────────────────────────────────────┐
│ ▣ Gateway           4 docs                                           │
└──────────────────────────────────────────────────────────────────────┘
┌ Documents ───────────────────────────────────────────────────────────┐
│ TYPE  TITLE                          STATUS      COMPLETE   UPDATED  │
│ PRD   Refund self-service            In review   ●●●●●●◐○   2h ago   │
│ TSD   Refund service design          Draft       ●●●○○○○○   1d ago   │
│ BRD   Faster refunds                 Approved    ●●●●●●●●   1w ago   │
└──────────────────────────────────────────────────────────────────────┘
```

- Type badge: monospace, outlined (`BRD`, `PRD`, `TSD`), not color-coded by type.
- Completeness strip: one dot per template section.
- Empty collection: grid background, "No documents yet" + `[+ New PRD]`.

### 6.3 Document workspace (core screen)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ← Payments   PRD  Refund self-service        Draft ▾   [Draft all] [Export ▾] ⋯ │
├────────────────┬───────────────────────────────────────────┬─────────────────────┤
│ OUTLINE        │                                           │ Chat│History│Trace  │
│ ● Overview     │  ## Problem Statement                     │                     │
│ ● Problem      │                                           │ COVERAGE  7/12      │
│ ◐ Goals        │  Customers wait 5–7 days for refunds…     │ ● Overview          │
│ ○ Personas     │                                           │ ◐ Goals             │
│ ● User stories │  ## Goals & Success Metrics       ◐ [⟳]  │ ○ Personas          │
│ ◐ FR           │  ┊ Partial: success metric has no target  │ …                   │
│ ○ NFR          │                                           │ ─────────────────── │
│ ● User flow ◇  │  ## User Flow                             │ AI  Who triggers a  │
│ ○ Out of scope │  ┌ mermaid ───────────── [Source|Preview]┐│     refund: customer│
│ …              │  │   (rendered flowchart)                ││     or CS agent?    │
│                │  └───────────────────────────────────────┘│                     │
│                │                                           │ [Type a reply…   ]  │
│                │                                           │ [↑ Send]            │
├────────────────┴───────────────────────────────────────────┴─────────────────────┤
  220px              flexible, max 72ch text                       360px, resizable
```

- **Outline:** status icon + title; click scrolls to section; ◇ marks sections expecting a diagram.
- **Section header actions** (on hover/focus): `⟳ Revise`, `History`, `Copy link`.
- **Partial/empty hint:** one-line note under the heading from the completeness check, in `--status-partial` / `--status-empty`.
- **Empty section placeholder:** dashed border box: "Not enough information yet. [Ask me about this]" — clicking pre-fills the chat.
- **Editing (Notion-like):** selecting text shows a floating format menu (Turn into, bold, italic, code, link) — no
  toolbar in the layout. Hovering a block shows a gutter: `+` (wide screens) inserts below, `⋮⋮` opens Turn into /
  Duplicate / Move up / Move down / Delete. `/` opens the block menu; the focused empty line hints "Type '/' for
  commands". Clicking under the last block continues the section.
- **Coverage panel** sits at the top of Chat; collapses to a single line `Coverage 7/12 ▸` once drafting starts. While
  the last reply's coverage is assessed it shows "Updating…"; the composer is already usable.
- Panels collapse: `⌘\` toggles outline, `⌘.` toggles right panel.

### 6.4 Drafting & streaming state

```
│ ## Functional Requirements                         Drafting… [■ Stop] │
│ FR-001  Customer can request a refund from order detail page▍          │
```

- Only the active section shows the caret and a subtle left border in `--primary`.
- Queued sections show "Queued" in the outline; completed ones update status live.
- `Stop` is always visible in the top bar while any generation runs; `Esc` also stops.
- If the user starts typing in a section being drafted: pause that section's stream and ask "Keep your edit or resume drafting?".

### 6.5 Revise with diff

```
┌ Revise: Non-Functional Requirements ─────────────────────────────────────┐
│ Instruction: "Make every NFR measurable"                                 │
│ ──────────────────────────────────────────────────────────────────────── │
│ - The system should be fast.                                             │ --diff-del
│ + NFR-002  p95 refund request API latency < 300 ms at 50 rps.            │ --diff-add
│                                                                          │
│                        [Discard]   [Edit before accepting]   [Accept]    │
└──────────────────────────────────────────────────────────────────────────┘
```

- Inline in the section (not a modal), so the surrounding document stays visible.
- Toggle between inline and side-by-side diff.

### 6.6 Requirement chips & traceability

- Requirement IDs render as mono chips: `FR-003`. Hover shows title + upstream links; click opens Trace panel.
- Upstream link chip: `↑ BR-002`. Restricted: `↑ 🔒 Restricted document` (no title, no tooltip content).
- Trace panel: three columns BRD → PRD → TSD; "Needs review" items get a `--status-partial` marker.

### 6.7 Export dialog

```
┌ Export ─────────────────────────────────┐
│ Format     (●) PDF   ( ) DOCX           │
│ Include    [✓] Cover page               │
│            [✓] Requirements appendix    │
│ ⚠ 2 sections are empty and will show    │
│   as placeholders.                      │
│                       [Cancel] [Export] │
└─────────────────────────────────────────┘
```

- Then a toast with progress: "Preparing PDF…" → "Ready · Download (expires in 24h)".

### 6.8 Admin — permissions matrix

```
Permissions                                   [Discard changes]  [Save]
                     Administrators   All Users   Engineering   Product
Our documents (root)   Edit 🔒         View ▾       Edit ▾        Edit ▾
├ Product              Edit 🔒         ↳ View       ↳ Edit        Edit ▾
├ Platform             Edit 🔒         No access ▾  ↳ Edit        View ▾
│ └ Payments           Edit 🔒         ↳ No access  ↳ Edit        ↳ View
```

- `↳` = inherited (muted text). Changing a cell makes it explicit (normal text) and shows "Reset to inherit" in its menu.
- Administrators column is locked.
- Changes are staged; Save shows a summary: "Engineering: No access → Edit on Platform (affects 2 sub-collections, 14 documents)".

### 6.9 Admin — LLM providers

```
LLM providers                                              [+ Add provider]
┌──────────────────────────────────────────────────────────────────────────┐
│ Anthropic   Production key   ••••a9F2   ● Connected   Default ★         │
│ OpenRouter  Experiments      ••••7xQ1   ● Connected                     │
└──────────────────────────────────────────────────────────────────────────┘
Default model: [ claude-… ▾ ]   (populated from the provider's model list)
```

- Add flow: pick provider → paste key → `[Test connection]` (must pass before Save) → pick default model.
- Errors use normalized messages: "Key rejected by provider", "Rate limited, try again in 30s".

### 6.10 Login

- Password form shown only if enabled. SSO buttons above it: `Continue with Google`, `Continue with <Provider name>`.
- Domain-rejected SSO: "Your account (name@other.com) isn't allowed. Ask your admin to add your domain."

## 7. Components

Base: shadcn/ui (Button, Input, Dialog, DropdownMenu, Tabs, Tooltip, Toast, Table, Command).
Custom components (in `apps/web/src/components/`):

| Component                                 | Responsibility                                                  |
| ----------------------------------------- | --------------------------------------------------------------- |
| `AppShell`                                | Top bar, sidebar, command palette mount                         |
| `CollectionTree`                          | Lazy tree, drag-and-drop move (with permission check feedback)  |
| `DocTypeBadge`                            | Mono outlined `BRD`/`PRD`/`TSD`                                 |
| `CompletenessStrip` / `SectionStatusIcon` | Dots and ○ ◐ ● icons with labels                                |
| `SectionOutline`                          | Outline list with status, diagram marker, queued state          |
| `DocumentEditor`                          | TipTap with section boundaries, read-only per permission        |
| `MermaidBlock`                            | Source/Preview toggle, render error badge, "Fix with assistant" |
| `StreamingSection`                        | Renders streamed markdown into a section with caret             |
| `SectionDiff`                             | Inline / side-by-side diff with accept/discard                  |
| `CoverageChecklist`                       | Interview coverage list, collapsible                            |
| `ChatPanel`                               | Messages, composer, stop, @section mentions                     |
| `RequirementChip` / `TraceLink`           | IDs, upstream links, restricted state                           |
| `PermissionMatrix` / `PermissionCell`     | Staged grant editing with inherit display                       |
| `ExportDialog`                            | Format options, empty-section warning, job progress             |
| `EmptyState`                              | Grid background, message, one primary action                    |

## 8. States

| State                   | Treatment                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| Loading                 | Skeletons matching layout; no spinners for page loads > 300 ms                                 |
| Streaming               | Caret in active section, Stop button in top bar, outline shows Queued/Drafting                 |
| Empty section           | Dashed placeholder with "Ask me about this"                                                    |
| No LLM configured       | Draft/Revise disabled with tooltip; admins get a link to `/admin/llm`                          |
| Provider error          | Inline error in chat with normalized message + Retry; partial output kept                      |
| Revision conflict       | Banner on section: "Updated by Rina 1m ago. [View their version] [Overwrite] [Merge manually]" |
| Restricted              | Lock icon + "Restricted document"; never show titles or counts of restricted items             |
| Read-only (View access) | Editor read-only, chat and Draft hidden, banner "You have view access"                         |
| Offline / server down   | Banner under the top bar; unsaved section edits kept in the tab and saved on reconnect         |

## 9. Keyboard

| Shortcut    | Action                          |
| ----------- | ------------------------------- |
| `⌘K`        | Command palette                 |
| `N`         | New document (browsers reserve `⌘N`) |
| `⌘\` / `⌘.` | Toggle outline / right panel    |
| `⌘Enter`    | Send chat message / accept diff |
| `Esc`       | Stop generation / discard diff  |
| `⌘⇧E`       | Export                          |
| `[` `]`     | Previous / next section         |

## 10. Accessibility & responsive

- WCAG 2.1 AA contrast for all text tokens in both themes; visible 2 px `--primary` focus ring.
- Streaming text uses `aria-live="polite"` per section, throttled to avoid screen-reader spam.
- All icons with meaning have text labels or `aria-label`.
- ≥ 1280 px: three panes. 1024–1279 px: outline collapses to icons. < 1024 px: single pane with tabs (Document / Assistant / Outline).
- < 768 px: read, comment, and export only; editing and admin show "Best on a larger screen".

## 11. Export styling (PDF / DOCX)

- A4, margins 20 mm, Inter body 11 pt / 1.5, headings 600 weight, mono for IDs and code.
- Cover page: wordmark (small, top-left), document type badge, title, status, author, last updated, version.
- Header: document title (left), type + status (right). Footer: page `n / total`, org name.
- Requirement tables: ID column mono, zebra rows `--surface-2` equivalent, header repeated on page break.
- Diagrams: centered, max width 100%, caption "Figure n — Section title".
- Empty sections print as a gray box: "Not yet specified." (never silently omitted).
