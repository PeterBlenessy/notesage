# PRD: UI Refresh — The Quiet Composer

|  |  |
| --- | --- |
| **Date** | 2026-04-21 |
| **Status** | Draft |
| **Priority** | High — moves the product away from "feature-rich IDE" toward "premium native writing tool" |
| **Impact** | Every user-facing surface. Defines the visual and interaction identity of Notesage 1.0. |
| **Mockups** | [ui-exploration/](../design/ui-exploration/) — A (Quiet Writing), B (Ambient Command), C (Focused Workshop), **D (Synthesis)**, E (Settings), F (Focus mode), G (Heavy compose), H (Permission card), I (Pinned panel), J (First run), K (AI settings), L (Sidebar interactions) |
| **Research** | Linear redesign, iA Writer, Bear, Ulysses, Raycast, Cursor, Things 3, Granola, 7 UX Patterns for Ambient AI Agents |
| **Tasks** | [ui-refresh-phase1-tasks](../tasks/2026-04-21-ui-refresh-phase1-tasks.md) (100 tasks, Phase 1 preview), [ui-refresh-rollout-tasks](../tasks/2026-04-21-ui-refresh-rollout-tasks.md) (16 tasks, Phase 2 + 3 rollout), [sidebar-simplification-tasks](../tasks/2026-04-27-sidebar-simplification-tasks.md) (24 tasks, post-Phase-1 sidebar program — TreeOverlay removal + Folders section + persistent search), [quiet-composer-bugs-tasks](../tasks/2026-04-27-quiet-composer-bugs-tasks.md) (14 tasks, post-Phase-1 standalone bugs from 2026-04-27 audit — Actions in StatusTray, TaskMode grouping, agent-orb toast, macOS unfocused window, project-lock tooltip) |

## Problem

Notesage today looks and feels like a capable but generic developer tool. The sidebar reads as a filesystem explorer. A persistent tab strip dominates the top of the workspace. The chat panel is a heavy 400-pixel column that steals horizontal real estate whether or not the user is currently talking to an agent. The activity strip is another vertical rail. Focus mode hides the sidebar but lets the document expand under the macOS traffic lights. Keyboard-mode palettes (⌘1, ⌘2, ⌘3, ⌘4) open separate surfaces that duplicate what the chat input already does.

The cumulative effect: a professional user says "it works." A visual critic says "it looks like VS Code with more features." That's not the product Notesage wants to be. The existing design system doc (`docs/design-system.md`) is already explicit:

> This is not optional. Every component, every view, every interaction must look polished and professional. Do not write "functional but ugly" code. If a component doesn't look good, it's not done.

We've held the line on palette, typography, and shadcn adherence. What we haven't done is question **the layout itself** — the durable decisions about what's on screen at all times, what's summoned, what fades, and what uses which entry point.

Three observations motivate this refresh:

1. **Chrome is the enemy of content.** Every permanent UI element — tab strip, chat panel, activity rail, sidebar tree — is competing for the user's attention with the document they're trying to write. A writing-first tool should make the document the dominant element 95% of the time.
2. **The modern AI surface is one morphing input, not a static panel.** Cursor, Claude desktop, ChatGPT, and Granola all converged on the same pattern: a single invokable composer that handles chat, commands, search, and attachment in one affordance. Notesage currently has three separate surfaces for these.
3. **Trees are 1980s filing cabinets.** The sidebar file tree was built for a workflow where users organize and then navigate. In practice, they work on the same handful of pinned/recent files and use search for everything else. The tree earns very little of the space it occupies — but it's there all day.

The refresh takes a clear position: **quiet by default, summonable on demand, one composer for all agent and navigation actions**. A "Quiet Composer" UI.

## Goals

1. **Make the document the dominant on-screen element at all times.** Chrome collapses to the minimum the current activity requires, and gets out of the way completely when the user is typing.
2. **Unify all chat/command/search entry points into one floating composer bar** (⌘K, ⌘1, ⌘2, ⌘3, ⌘4, slash commands, agent reference). One input surface, many muscle-memory paths in.
3. **Replace the persistent chat panel, activity rail, and tab strip with lighter-weight successors.** Chat unfolds above the composer. Background agent tasks live in an ambient orb. Open-doc inventory moves to Pinned/Recent in the sidebar.
4. **Flatten the sidebar from a tree to curated lists** (Pinned, Projects, Recent, Tags). Preserve the tree as a *summonable* tool via hover-peek and a ⌘⇧E full overlay.
5. **Fix focus mode** so it actually delivers the "only the document" promise — including hiding the sidebar, respecting the window title-bar safe zone, and dimming (not removing) ambient agent status.
6. **Rebuild settings** as a calm, searchable, spacious two-pane shell with grouped rows and live-preview where relevant.
7. **Ship safely.** No user should be forced into the new UI on upgrade day. Rollout is opt-in preview first, gradual default-on later.
8. **One knob for personalization — accent color.** A single user-selectable accent (Default / Orange / Blue / System) replaces today's black-in-light / white-in-dark primary in buttons, ON toggles, focus rings, and dirty indicators. Chrome and surfaces stay neutral. "System" follows the macOS accent setting (mirroring the Light/Dark/System theme pattern).

## Non-Goals

- **Changing the core visual identity.** Surfaces stay neutral (no blue headers, no chromatic backgrounds). Destructive stays red. Editor content colors (diffs, syntax, highlights) are unchanged. Type pairings, spacing scale, density values, and a single user-selectable accent color ARE in scope — see Goal 8.
- **New agent or AI capabilities.** No new skills, no new providers, no new agent protocols. We're refurbishing the container, not the contents.
- **Re-architecting ProseMirror, markdown round-tripping, or any file-system behaviour.** The document engine and storage model are stable; touching them is explicitly out of scope.
- **Mobile support.** Notesage is desktop-first; mobile is a future initiative with its own design cycle.
- **A Windows/Linux-specific redesign.** macOS remains the primary target; Windows/Linux get the same layout without the macOS-specific traffic-light treatment.
- **Removing power-user affordances.** Everything that exists today must still be reachable — often through a better path. We are not amputating features; we are re-hosting them.
- **A replacement for "Preview as HTML".** The existing toggle is being *removed* (it's a half-measure — styled preview of markdown). A proper native HTML renderer with JS execution belongs to a separate future PRD. Deletion is in scope of this refresh; the replacement is not.
- **Banners as UX affordances.** We are actively removing the remaining banners (external-change dirty-tab banner, cross-project-mode banner). Persistent or blocking notifications move to action toasts, inline diff review, or context-row indicators — see Detailed changes.

## User Stories

 1. **As a long-form writer**, I open Notesage to draft an essay. The second I start typing, the tabs, formatting toolbar, and status line vanish. The sidebar stays but reads as a calm list of my pinned files, not a file tree. The document is nearly the entire window. When I move the mouse, the chrome comes back.

 2. **As an AI power user**, I press ⌘K to open a command bar at the bottom of the page. I type "summarize this doc for the team"; the agent's answer unfolds above the bar without opening a side panel. When the conversation is done I hit Escape; the bar collapses and the document is whole again.

 3. **As someone coming from VS Code**, I notice there are no tabs. I briefly miss them. I press ⌘K, type two letters of a file name, and Enter. I realise I was paying a permanent chrome tax for something one keystroke solves. My Pinned section in the sidebar has the four files I actually care about. I never manually close a tab again.

 4. **As a research user**, I press ⌘? (aka ⌘4) and a research-search popover opens inside the command bar. I pick a source, it becomes an attachment chip, and I ask the agent to cite it. Same flow for ⌘! (tasks), ⌘@ (references), ⌘# (tags). One surface, four muscle-memory doors — and the glyph in the shortcut *is* the prefix mode.

 5. **As a power user comparing doc and chat side-by-side**, I click the pin icon in the composer's context row. The floating bar detaches into a right-edge panel, resizable, with the same conversation intact. Click again to unpin back to floating. My window, my choice.

 6. **As a user who picks up the app after years of macOS Blue everything**, I visit Settings → Appearance → Accent and pick "System". The primary button in my permission cards, the focus ring when I tab through settings, the dirty-dot on my unsaved file — they all pick up the Mac's accent. The rest of the app is still neutral. One knob, immediate personality.

 7. **As a user who delegated three comments to the agent**, I don't see a chat panel. I see a pulsing orb in the bottom-right corner with a "3" badge. I click it; a small panel slides up showing the running tasks, each with a title, elapsed time, and spinner. When a task finishes, the orb pulses once and the badge drops. I never lose track of what's happening in the background — but it also never steals my screen.

 8. **As a user who loves focus mode**, I press ⌘. and the sidebar slides out, the formatting toolbar fades, the doc-head hides, and the document gets extra top-padding so text never runs under the traffic lights. A small pill at the top tells me I'm in focus mode and ⌘. exits. The orb stays visible at 30% opacity — I still want to know if the agent finishes something — but it doesn't demand attention.

 9. **As a user with a 2–5-deep folder structure**, I hover a project item in the sidebar and a popover shows one level of children. That's usually enough. When I need the full tree, I press ⌘⇧E and a proper tree slides in from the left. Esc dismisses it. The tree is a tool I can summon, not a permanent fixture.

10. **As a new user opening settings for the first time**, I see a clean two-pane dialog with a search box at the top of the nav. I type "contrast"; the matching row in Appearance highlights. I drag the contrast slider and the live preview at the bottom of the page updates instantly. The settings dialog feels like a different surface from the editing app — deliberate, quiet, spacious — not a dense config form.

## Vision — What the new Notesage looks like, in one sitting

*(Read this section as a walk-through of Mockup D with prose; open* `docs/design/ui-exploration/mockup-d-synthesis.html` *alongside.)*

Notesage opens. The user sees three things: a quiet sidebar at the left, a document in the centre, and a muted breadcrumb across the top that reads `Notesage / essays / drafts / On Attention.md`. There is no tab strip. There is no chat panel. There is no activity rail. The sidebar has four sections — **Pinned**, **Projects**, **Recent**, **Tags** — each a flat list of rows with small icons and counts. No carets, no indentation, no expand toggles.

The user starts typing. The breadcrumb fades. The floating formatting pill at the top of the document fades. The status line at the bottom fades. For 1.2 seconds after the last keystroke there is *nothing* between the user and the page — just text on paper. Move the mouse or stop typing and the chrome ghosts back in.

Hovering over `Research` in the Projects list makes a small popover unfold to the right after \~200 ms. It shows folder names one level deep — `papers`, `interviews` — plus a few recent files and a footer hint: `⌘⇧E for full tree`. Mouse away, popover fades.

Pressing ⌘⇧E slides a properly-structured tree panel in from the left over the sidebar. The user can expand into `Research → papers → cognitive-science → attention → 2024-burkeman.md` — five levels deep, all visible at once, no UI tax. Press Escape; tree dismisses.

Pressing ⌘K focuses a floating bar near the bottom of the document. Typing "summarize this draft" causes an answer to stream above the bar in the same surface, styled like a quiet conversation. The user hits Escape; the bar collapses to its compact state. The conversation is preserved, but out of the way.

Typing `/` in the bar shows Notesage skills: `web-search`, `download-webpage`, `save-research`, `generate-presentation`. Typing `@` shows a merged reference picker — files, people, comments — and clicking a file turns it into a small chip above the input ("▤ on-attention.md ×") that the agent will see as attached context. Typing `#` searches tags. Typing `?` searches research. Typing `>` opens the command palette. Pressing ⌘1 / ⌘2 / ⌘3 / ⌘4 does the same with `!`, `@`, `#`, `?` pre-filled — one bar, many doors.

In the bottom-right corner, a small pulsing orb indicates two agent tasks are running. Clicking it reveals a panel with each task: "Summarizing draft into key arguments — 0:14", "Drafting reply for comment — 1:02", "Fetched 3 sources — ✓". When a task completes, the orb pulses once and updates the badge count. The user never loses awareness of what's happening, but the agent never demands screen space it doesn't need.

Pressing ⌘. enters focus mode: the sidebar slides out, every piece of chrome disappears, the document gets a generous top-padding that keeps text clear of the macOS traffic lights, and the orb dims to 30% but stays available. A small "Focus · ⌘. to exit" pill is the only reminder. ⌘. again returns to the default layout.

The Settings command (from `>` palette or ⌘,) opens a floating dialog that feels like a different app — a two-pane card with a search box, grouped nav entries, and airy rows of settings with a live preview panel at the bottom. The user adjusts density, contrast, editor font, and sees the preview update immediately.

That's it. That's the whole pivot.

## Design principles

These principles sit above every component-level decision in this PRD. When a future question arises about this UI, these are the tiebreakers.

### 1. The document is the page

Every chrome element must justify its permanent existence. If it can be:

- Derived from context (breadcrumb instead of tab)
- Summoned on demand (tree overlay instead of persistent tree)
- Ambient and compressed (orb instead of activity rail)
- Invoked on keystroke (composer instead of chat panel)

— then it should be. The default state is the document with the *minimum* chrome required to know where you are and whom you're working with.

### 2. One composer, many doors

The floating command bar is the single input surface for agent chat, skill invocation, reference attachment, search, and commands. Every entry point that used to open a separate palette now focuses the bar with an appropriate prefix pre-filled. Users learn one surface, not six.

### 3. Ambient, not absent

Background work (agent tasks, external change detection, model downloads) gets a *small persistent indicator* — never a panel that steals screen space, never a toast that disappears. The orb pattern: a pulsing dot that tells you something is happening, an invitation to inspect, and no interruption. This is borrowed verbatim from Benjamin Prigent's "7 UX Patterns for Ambient AI Agents".

### 4. Fade, don't toggle

Chrome should *gently yield* while the user is engaged with content. Typing fades the tabs, toolbar, and status. Mouse movement brings them back. No hard toggles, no explicit "hide UI" modes except the one deliberate escape (focus mode). The user doesn't manage chrome; the chrome manages itself.

### 5. Flatten before nesting

Hierarchy is the last resort, not the first. Any list we can render flat (Pinned, Recent, Projects, Tags, chat history, skills) is flat. Any tree we can summon is summoned. Indentation in a permanent sidebar is a design smell.

### 6. Preserve power-user semantics

The existing Notesage prefix conventions — `/` for skills, `@` for references (was agents), `#` for tags — are honoured. New prefixes (`!` for tasks, `?` for research, `>` for palette) use punctuation the user has already internalized as the shift-form of ⌘1/⌘2/⌘3/⌘4. No prefix is arbitrary.

### 7. Settings is a different room

The settings dialog is deliberately dissimilar from the editor. It is not a panel grafted onto the main app; it is a floating, card-shaped, quiet, spacious modal with macOS-like nav+detail layout. When a user enters settings they should feel they've stepped into a different space and can think deliberately.

### 8. One knob for personalization

The accent color is the single chromatic choice the user owns. Four presets: Default (neutral black/white), Orange, Blue, System (follows macOS accent). No custom picker, no per-element overrides, no "secondary color". It appears on the handful of elements where affordance needs to *pop* — primary buttons, ON toggles, focus rings, dirty dots — and nowhere else. Personalization without overwhelm.

## Detailed changes by surface

Each section below gives the *argument* for the change, the *specific visual/interaction* decision, and a pointer to the mockup.

### Sidebar — from tree to curated lists

**Argument.** File trees reward organizers and punish writers. They force every file to commit to a single location before you even know what the file is. They also waste vertical space on folder chrome (carets, indent guides, expand state) that gets very little use. Trees still have a genuine role — "where does this live?" — but that's a *summonable* question, not an always-on one.

**Change.** The sidebar becomes a flat, scrollable column of four sections with small uppercase labels:

- **Pinned** — 3–5 files the user explicitly pinned. Manual ordering. This is the working-set replacement for the tab strip.
- **Projects** — flat list of top-level project folders with file counts. No expand.
- **Recent** — 5–8 files ordered by last-touched.
- **Tags** — flat list of tags with counts.

Hovering a Projects item opens a small popover to the right after \~220 ms that shows one level of children plus a few recent files inside that project. Pressing ⌘⇧E summons a proper tree overlay, sliding in from the left, with a search box at the top, standard caret-triangle expand/collapse, and Escape to dismiss. The overlay supports arbitrary depth (we verified with a 5-deep sample: `Research → papers → cognitive-science → attention → 2024-burkeman.md`).

**Mockup.** D (main view), tree overlay behind ⌘⇧E.

### Tabs — removed

**Argument.** Tabs solve four problems: working-set inventory, fast switching, dirty-state indication, and visual scan of open documents. Every single one is solved better by an adjacent mechanism the app already has.

| Tab job | Better replacement |
| --- | --- |
| Working set | Pinned in sidebar (explicit, persistent, reorderable) |
| Fast switching | ⌘K + two letters + Enter (faster than a click) |
| Dirty state | Dot next to filename in doc-head breadcrumb |
| Visual inventory | Recent section in sidebar |

The permanent 44-pixel tab strip was a tax paid against *every* document the user opened. Removing it buys that strip back — for content — at a cost of muscle-memory adjustment. Linear has no tabs. Things has no tabs. Bear has no tabs. Nobody misses them there.

**Change.** Tab strip removed entirely. Replaced by a minimal `DocHead` breadcrumb: `Notesage / essays / drafts / On Attention.md ·` with a tiny "dirty" dot and a right-aligned `saved 40 s ago` marker. The breadcrumb fades on type alongside the formatting toolbar and status line.

For users who want to preview closed-to-reopen or across-session persistence: files stay in Recent (and Pinned for the ones they care about). For users who need two docs side-by-side: a future mockup will explore a split-view for that specific case — not a resurrection of the tab strip.

**Escape hatch for muscle memory.** ⌘⇧\[ / ⌘⇧\] cycle through Recent, so the "Ctrl+Tab between docs" habit still works without any visual tab strip.

**Mockup.** D (doc-head breadcrumb at top of document).

### Chat panel — absorbed into the floating composer

**Argument.** The existing 400-pixel chat panel is expensive chrome: it's there whether or not the user is currently talking to an agent, and it halves the horizontal space available for the document. The industry has settled on a different pattern — a floating invokable composer — for good reason: it matches the actual frequency of agent interaction (spurts, not constant), it preserves document width, and it unifies chat with navigation/command actions.

**Change.** Chat panel removed from the default layout. Replaced by a **floating command bar** pinned to the bottom-centre of the workspace:

- **Compact state** (default): \~640 px wide, a single input row with a mode pill on the left ("Ask · current file"), the input field, and a `⌘K` kbd hint on the right.
- **Expanded state** (when focused or actively in conversation): the bar slides up slightly and unfolds a chat stream region above the input. Messages render with the same typography we use in the current chat panel (markdown, segments, tool calls, thinking blocks). Max stream height is \~50 vh to keep the document visible.
- **Prefix morph**: typing `/`, `@`, `#`, `!`, `?`, `>` as the first character switches the bar's mode, updates the left pill, and shows a typed filter picker below the input.
- **Attachment chips**: a row above the input row holds chips for each `@`-attached file/person/comment, with an × to remove. Chips survive across messages until explicitly removed or chat is cleared.
- **Dismissal**: Escape collapses the bar to compact. Focus elsewhere collapses it. ⌘K brings it back from anywhere.

The chat stream above the bar is the same chat conversation today's panel shows — same branching, same segment rendering, same permission cards (inline). We're changing the container, not the conversation.

**Mockup.** D (floating bar at bottom; type `/`, `@`, `#`, `!`, `?`, `>` to see it morph).

#### Context row — where the ChatFooter goes

**Argument.** Today's ChatFooter carries provider, project multi-select, permission mode, and history entry. Dropping the chat panel without rehoming these controls is a regression. They all live inside the composer's expanded state, above the chat stream — dense but not noisy.

**Change.** When the bar is expanded (focused, has a stream, or has active attachments), a **context row** appears at the top of the bar. Exact layout:

| Side | Control | Interaction |
| --- | --- | --- |
| Left | Provider pill (icon + name + caret) | Click → dropdown to switch provider (same context-isolation flow as today) |
| Left | Divider |  |
| Left | Project chip(s) — one per selected project, with `🔒` if `aiLock`'d and `×` to remove | Click × removes from scope |
| Left | Dashed `+ project` button | Click → project picker to widen scope |
| Right | Mode pill (shield icon + name + caret) | Click → Read Only / Agent / Full Access / Plan |
| Right | Clock icon | Switches the chat stream to a History view (list of past conversations) |
| Right | Pin icon | Toggles pinned-side-panel mode (see [Break-out](#break-out--pinned-side-panel) and Mockup I) |

**Compact-state summary.** When the bar is collapsed (no context row), the mode pill on the input row reads `Claude · Essays · Agent` — a single-line summary of the current provider + scope + mode. Click or focus the bar to expand and reveal the full context row.

**No redundant "Ask" pill.** When the context row is visible, the input-row mode pill is suppressed entirely — the context row above already communicates provider, scope, and permission mode. The pill reappears only when a **prefix** is active (e.g. `/` → "Skill", `@` → "Reference") as a filter indicator for the current dropdown. This avoids duplication: the permission dropdown in the context row is the single source of truth for what the agent will do with the next message.

**Mockup.** D (focus the bar, the context row appears above the stream).

#### Break-out — pinned side panel

**Argument.** Some workflows are doc-and-chat-side-by-side: comparing a draft to a summary, reviewing an agent-proposed diff while reading the surrounding prose, copying sources from the chat stream into the doc. The floating composer collapses when you focus elsewhere, so it's the wrong tool for sustained side-by-side work. The answer is a **pinned** state — the composer detaches into a right-edge panel.

**Change.** The composer has three states: compact, expanded-floating, **pinned-side-panel**.

- Click the pin icon in the context row → bar detaches and docks to the right edge of the workspace. Resizable via a drag handle on its left edge. Default width 400 px. State persists per window.
- Context row appears at the top of the panel in this mode, same content, vertically stacked layout.
- Agent orb **hides** in pinned mode — the panel *is* the ambient surface; no need for a redundant indicator.
- Unpin via the × button in the panel's title bar → returns to floating mode, conversation intact.
- ⌘K still focuses the composer whether floating or pinned.

**Mockup.** I (pinned-side-panel state in full).

#### Behaviour with non-markdown files

**Argument.** Notesage opens PDFs, EPUBs, DOCX, PPTX, code files, and plain text. The new composer must work for all of them. The rule is simple: the viewer is what you're *looking at*; the composer is what you're *doing*. They never fight for the centre.

**Change.**

- The viewer (PDF, EPUB, DOCX, PPTX, CodeMirror, plain text) stays the centre of the workspace, unchanged from today.
- The composer attaches the active file as context regardless of type.
- The agent sees file-type metadata in context; the skill system routes to the right skill automatically based on file type + user intent.

**Action set by file type:**

| File type | Writeable | Action set exposed to the composer |
| --- | --- | --- |
| Markdown (`.md`) | yes | Full — edit, summarize, extract, search, apply diff, insert, format |
| Plain text (`.txt`, `.log`) | yes | Full, minus Tiptap-specific formatting |
| Code files (`.ts`, `.py`, `.rs`, 22+ languages) | yes | Edit, explain, refactor, diagnose, add tests |
| PDF / EPUB / DOCX | no (read-only) | Summarize, extract, search-within, cite |
| PPTX | no (read-only) | Summarize slides, extract text, search-within |
| Image (`.png`, `.jpg`) | no | Describe, OCR, attach for vision models |

#### What happens when the user changes documents

**Argument.** Auto-restarting the conversation on every document switch is aggressive (users tab-switch to read, not to reset context). Keeping the conversation silently bound to the wrong document is worse (the user asks a question about the new doc, the agent answers about the old one).

**Change.**

- Conversation state persists across document changes. No auto-restart.
- A subtle breadcrumb appears at the top of the chat stream when the active doc differs from the conversation's original context: `Conversation was about: On Attention.md · [Start new for current doc]`.
- Attachment chips persist unless the user removes them. The previously-active doc stays in context until explicitly detached.
- The "Start new for current doc" link is one click; creates a fresh conversation with the current doc auto-attached.

#### Interaction details — spec decisions

These are the small but important interaction rules for the composer. Resolving them in the PRD avoids ambiguity in task specs.

**Attachment chips on send.** Mirrors today's image-attachment behavior.

- On send: chips **clear** from the input's chip row.
- The attached items **appear as thumbnails/pills below the user message** in the chat stream, so the conversation history permanently records what was attached.
- Chips persist across sends only if the user explicitly leaves them (i.e., user sends a message, the chips stay visible as "context for this thread" — carry-over is opt-in via not-removing).
- **Decision:** default is **clear on send** to match image-attachment pattern. Users who want context to persist across a multi-turn exchange re-attach or mark a chip "pin to thread" (secondary affordance, v2).

**⌘K when the composer is pinned as side panel.** Just focuses the panel's input in-place. Does not un-pin. Users un-pin via the panel's × / pin-toggle button. This respects the user's explicit layout choice.

**Focus mode exit — clickable pill + Esc fall-through.**

- The focus-mode pill at the top of the window (`Focus · ⌘. to exit`) is **clickable** — clicking it exits focus mode. The × affordance on the pill is the visual cue.
- `⌘.` toggles focus mode from any state (canonical shortcut).
- `Esc` **exits focus mode with fall-through priority:** if a popover, command bar, or inline edit is open, `Esc` dismisses that first. Only when nothing else is dismissable does `Esc` exit focus mode. This is the OS convention — `Esc` always exits the most-current mode; focus mode is a mode.

**Prefix character behavior — stays visible, works mid-text, varies by prefix on send.**

*Triggering behavior:*

- Autocomplete for `/` `@` `#` `!` `?` `>` triggers when the prefix character is **at start of input OR preceded by whitespace**. Prevents false positives inside URLs, numeric tags, etc.
- Typing past a non-matching character dismisses the autocomplete; the literal character stays.
- `Esc` dismisses the autocomplete; the literal prefix+text stays in the input.

*On send, behavior varies by prefix:*

| Prefix | Stays in sent message text | Becomes an attachment chip | Notes |
| --- | --- | --- | --- |
| `/skill-name` | ✓ | — | Agent parses `/skill-name` tokens anywhere in message text (not just position 0). **Backend change required** — today's skill-detection reads first-char-only; task will extend to whitespace-preceded matches throughout the message. |
| `@reference` | — (text removed on selection) | ✓ | File / person / comment attached as context; the user-visible message no longer contains `@name` text |
| `#tag` | ✓ | — | Rendered as a styled tag chip inline in the sent message; visible in chat stream as a pill, same as in editor body |
| `!task` | — | ✓ (when selected for reference) | Selecting a task either **navigates** to it (if no active chat) or **inserts a task-reference chip** (if composing) |
| `?research` | — | ✓ | Research source attached like a file |
| `>` palette | n/a | — | Runs the selected command immediately; no message is sent |

**Mid-text** `/skill` **— backend note.** Today's skill-detection code reads only the first character. The new behavior requires a regex scan of the outgoing message for `(?:^|\s)/[a-z0-9-]+` tokens. This is an explicit backend task in the breakdown, not a free consequence of the UI change.

### Agent activity — the pulsing orb

**Argument.** The activity strip and the activity panel together occupy one vertical rail on the right of the app. For users with one active task, that's wasted screen. For users with zero active tasks, it's a rail of nothing. The Claude web / Superhuman / Granola pattern is better: ambient indicator, invitational click, panel on demand.

**Change.** Activity strip and panel replaced by:

- **Agent orb** — a 46 px circle in the bottom-right corner, constant-visible. It pulses (CSS keyframe, no JS timer) while one or more agent tasks are running. A small count badge ("2") shows running-task count. Idle state: no pulse, no badge, dim.
- **Agent panel** — 340 px wide popover that appears above the orb on click. Shows the same tasks today's activity panel shows (spinner, title, metadata, elapsed time, final ✓). Cap at 6 recent; "Open full activity" link goes to ⌘⇧A for the historical view.

Agent completions that used to require a sidebar glance now arrive as a single-pulse animation on the orb plus (optionally) a system notification. For multi-task users the panel is one click away; for single-task users the orb is enough.

**Preserved.** The existing `activity-store`, `useAgentTaskOperations`, and agent-status state machine don't change. Only the rendering surface does.

**Mockup.** D (orb in bottom-right; click to open panel).

### Focus mode — done right

**Argument.** Current focus mode (`Cmd+.`) partially hides chrome but lets the document expand under the macOS traffic lights. This is the user's own stated complaint. A proper focus mode must (a) hide the sidebar, (b) hide every other chrome element, (c) preserve a safe zone at the top of the document so text doesn't collide with window controls, and (d) still offer a clear exit.

**Change.**

- `Cmd+.` toggles an `.app.focus-mode` class on the root.
- In focus mode: sidebar fades and slides left (out of the column). Doc-head, formatting toolbar, and status line hide with opacity 0. Document gets +110 px top-padding to keep text clear of the traffic-light zone.
- Agent orb dims to 30% opacity but remains interactive on hover.
- A small "Focus · ⌘. to exit" pill appears at the top-centre of the window for the duration.
- Command bar stays (user may still want to talk to the agent during focus).

This is *distraction-free mode*, not iA-Writer-style per-sentence dimming. If we want per-paragraph dimming later, it's a separate setting (`Dim surrounding blocks` switch in the Editor section).

**Mockup.** D (press `⌘.` to engage; `⌘.` again to exit).

### Settings — the quiet room

**Argument.** The current Settings dialog is a dense, tab-heavy config form that feels continuous with the editor's chrome. It should feel *different* — a deliberate, calm modal where the user steps out of editing and into configuration.

**Change.** New settings shell (see Mockup E):

- **Floating dialog** — max 1040 px wide, 24 px margin from the window edge, 14 px rounded corners, a soft 28 px drop shadow. Feels like a card, not a full-screen takeover.
- **Two-pane layout** — 236 px nav column with grouped sections (Notesage / Workspace / About) and \~1 fr content column.
- **Search-first** — `⌘F` focuses a search input at the top of the nav. Typing filters both nav items and content rows with matching highlights.
- **Row pattern** — label (13 px, weight 500), description (12 px, muted, max 460 px wide), control right-aligned. 1 px hairline between rows in a group; 40 px gap between groups; group label (10.5 px uppercase) above each group.
- **Controls** — proper segmented pill, real switches (smooth thumb slide), custom-styled sliders with monospace numeric readout, calm selects, muted buttons.
- **Live preview** — Appearance section includes a preview card at the bottom showing the user's chosen font, size, line-height, and theme in real time.

**Content reorg.** Sections become: General, Appearance, Editor, AI & Agents, Skills, Projects, Privacy, Advanced, About. Most today-Settings subsections map one-to-one; a few consolidate. Per-section redesign is a follow-up PRD. This PRD owns the *shell*.

**Mockup.** E (open `mockup-e-settings.html`).

### Inline creation — no dialogs

**Argument.** Today's new-note, new-project, and new-file flows open modal dialogs asking for names, templates, and destinations. Dialogs break flow, take a beat, and are overkill for the common case (just make me a file). We have the inline rename pattern already; the create flow should mirror it.

**Change — new note.**

- Click the `+` next to a project name in the sidebar, OR press `⌘N` with a document open
- A new row appears **in the sidebar** at the right location, already in edit mode with a text input
- Type the name, `Enter` commits and opens the file
- `Esc` cancels and removes the row. **No file is created on disk until Enter is pressed.**
- `⌘N` behavior: creates in the *same folder as the currently open document*. No folder picker.
- `+` next to a project: creates in the *root of that project*.
- For users who want a specific subfolder: use the hover-peek on the project (already in D) to navigate into the subfolder first, then `⌘N`. Or drag the created file afterward.

**Change — new project.**

- Click the `+` next to the Projects section header, OR press `⌘⇧N`
- A new row appears in the Projects section, already in edit mode
- Type the name, `Enter` commits and creates `~/Notesage/<name>/` on disk (always in the local library; users move to iCloud later via Settings &gt; Sync)
- `Esc` cancels, row disappears, **nothing written to disk**
- Projects are created empty — no template picker, no starter folder hierarchy. Users add structure as they need it. Templates (Research, Writing, etc.) become skill-driven scaffolders users invoke explicitly via `/scaffold-project`, not blocking dialogs.

**Change — open folder.**

- `⌘O` unchanged — native folder picker dialog. This one dialog remains because it's a system-provided affordance for navigating the filesystem; replacing it would be worse.

**Removed.**

- `NewNoteDialog.tsx` — deleted
- `NewProjectDialog.tsx` — deleted
- Template picker in `NewProjectDialog` — pattern moves to skills

### Viewer toolbars — same floating pill pattern

**Argument.** The PDF, EPUB, DOCX, and PPTX viewers each have their own toolbars today — zoom, page navigation, bookmarks, search, etc. — rendered as dense chrome bars that don't match the editor's Quiet Composer treatment. They should feel like siblings to the editor toolbar, not separate UI worlds.

**Change.** Each viewer gets a floating pill toolbar at the top of the document area (same visual treatment as the editor's formatting pill), with only the controls relevant to that file type. All pills share: floating position at top-center, rounded-999 pill shape, `backdrop-filter: blur(14px)`, same icon sizing and hover states. They fade on **scroll** (viewers don't have a "typing" signal); mouse movement or scroll near zero restores them.

| Viewer | Pill contents |
| --- | --- |
| PDF | Zoom (−/+/fit-width/fit-page), page navigation (← / page N of M / →), bookmarks, search |
| EPUB | TOC, bookmarks, paginated ↔ scroll toggle, search |
| DOCX | Zoom, search, "Convert to Markdown" |
| PPTX | Zoom (−/+/fit), slide navigation (← / slide N / →), speaker notes toggle, search |
| Code files | Language indicator (e.g. "TypeScript"), find (⌘F already does this, no extra button), line-number toggle |
| Plain text | No pill — plain text is plain |

**Preserved.** Each viewer's full functionality (EPUB bookmarks persistence, PDF page-state, PPTX speaker notes) is unchanged; only the chrome moves.

### External change detection — toast-only, gated by one setting

**Argument.** Banners have been actively removed from the app across multiple releases. The `DiffReviewBanner` above the editor is the last holdover in the main editor surface. It gets deleted. Behavior is governed by a single user setting that already exists today — `externalChangeDiffReview` — whose meaning is clarified here.

**Change.**

Single setting: **Settings &gt; Editor &gt; "Review external diff"** (toggle, default OFF). Governs all external-change behavior uniformly — no separate clean-vs-dirty logic in UI.

**When OFF (default):**

- File changes on disk → silent auto-reload, overwriting any in-memory edits
- **Info toast**: `<name>.md reloaded from disk` — no actions, auto-dismisses after \~3 s
- Same behavior for clean and dirty tabs. Users who want protection against losing in-memory edits turn the setting ON.

**When ON:**

- File changes on disk → inline diff decorations appear in the editor (red strikethrough for deletions, green for insertions) — the existing `external-change-store` + `InlineDiff` plugin
- **Sticky action toast** (no auto-dismiss): `<name>.md changed externally`
  - **Accept** → apply all external edits, clear decorations, hide toast
  - **Reject** → keep in-memory version, clear decorations, hide toast
  - **Dismiss** → hide toast only; decorations remain in the editor for per-hunk accept/reject via the existing inline controls

**Removed:**

- `DiffReviewBanner.tsx` — deleted entirely
- `docs/features/workspace.md` line 108 ("Dirty tabs: show reload/keep banner for user decision") — docs cleanup required
- Cross-project-mode banner above the chat input — replaced by a compact warning pill in the composer's context row (no vertical chrome)

**Preserved:**

- `external-change-store`, `InlineDiff` plugin, per-hunk accept/reject inline controls — all unchanged. Previously a beta behind a setting; now the canonical path when "Review external diff" is ON.
- The setting's storage key, default value, and migration behavior are unchanged. Only its scope broadens (was: gate on clean-tab diff view. Now: gate on all external-change conflict UX).

### Status tray — the editor HUD

**Argument.** Today's status bar is a passive information strip (word count, save state). The new design makes it an active, click-to-reveal surface — the one place users go for editor-level status and quick toggles that don't belong in the main composer.

**Change.**

**Status bar strip** (bottom-center, fades on type as today): a single minimal line.

```
2,184 words · saved 40 s · ⌘K ask · ⌘. focus
```

**Clicking anywhere in the strip** opens a popover above it (\~320 px wide) grouped into four sections:

| Group | Contents |
| --- | --- |
| **Completions** | Segmented picker: `[Off · Copilot · Local AI · Ollama]`. Live status: "Local AI: ● Running · qwen2.5-coder · 200 ms median" with a link to Settings &gt; AI. A single toggle replaces per-tab "disable inline completion" (still available per-tab via right-click but simplified here). |
| **Comments** | "3 open · 12 resolved" — click the "3 open" row to expand into the comment list inline. Each comment: author, first line of text, delegate status. Click → jumps to anchor in editor. |
| **Session** | Local AI server: ● Running · Start/Stop. Tool calling: ● Enabled. Active recording indicator (only visible when recording). Each item has a small link to the relevant settings panel. |
| **Help** | Word count breakdown (words, characters, reading time). Keyboard shortcuts icon → opens the full cheatsheet modal. Focus-mode toggle. |

**Indicator semantics.** A small dot on the status bar surfaces ambient state without opening the popover:

- ● Green dot when Local AI server is running and set as the active provider
- ● Orange dot when inline completions are active on this doc
- ● Red dot (rare) when voice recording is live Position: inline with the status text. User learns to glance at the dot; clicking opens the detail.

**Components relocated here (from today's UI):**

- Local AI running indicator (was in Settings-only today) → Status tray + provider pill dot
- Inline completion per-tab toggle → Status tray (doc-level), right-click tab for per-tab (kept for power users)
- Voice recording indicator → Status tray (already partially exists)
- "N comments" count → Status tray (previously scattered across doc-head and comment popover)
- Keyboard shortcuts dialog (`⌘7`) → Status tray entry + `⌘⇧K` binding + `>shortcuts` palette entry

### Accent color — the one knob

**Argument.** The strict-neutral palette is the right default and should stay the default, but shipping a pro-tool in 2026 with zero personalization is leaving value on the floor. The lightest-possible move — a single accent picker that colors the handful of spots where affordance needs to pop — gives users ownership without letting chromaticity overrun the app.

**Change.** A single Accent setting in Settings &gt; Appearance. Four options:

| Option | Value | Source |
| --- | --- | --- |
| **Default** | Neutral black (light) / white (dark) — as today | Built-in |
| **Orange** | `oklch(68% 0.16 55)` | Curated |
| **Blue** | `oklch(62% 0.15 245)` | Curated |
| **System** | Follows macOS accent via `NSColor.controlAccentColor` (Tauri bridge) | macOS |

**Where the accent appears** (everywhere else stays neutral):

| Element | Today | With accent picked |
| --- | --- | --- |
| Primary button (`Allow`, `Save`, etc.) | `--fg` bg | Accent bg |
| Switch (ON state) | `--fg` track | Accent track |
| Focus ring | Grey | Accent |
| Link color (editor) | Grey | Accent |
| Dirty dot (unsaved) | `--fg` | Accent |
| Running-task ring on orb | `--orb` | Accent |
| Selected-row active band (sidebar) | `--line` | Accent-tinted |
| Destructive | Red | Red (always — accessibility) |
| Backgrounds, borders, type | Neutral | Neutral (no change) |

**CSS token.** A new `--accent` variable in `globals.css`, applied per-theme so light/dark both look good. The existing `--primary` stays as a neutral-only token; accent is additive, not a replacement. Dark-mode oklch values for each curated color are tweaked independently to preserve AA contrast.

**Mockup.** Demonstrated across D (dirty dot + primary buttons) once the accent picker lands; currently shown at `--fg` (neutral default).

### Keyboard shortcuts — consolidated

**Argument.** Today's keyboard map has four separate palettes (⌘1 actions, ⌘2 mentions, ⌘3 tags, ⌘4 research) plus a main command palette (⌘K). That's five surfaces for five shortcuts, duplicating most of the picker/filter/navigate logic. A single composer with prefix modes does this cleaner.

**Change.** All five shortcuts focus the floating command bar. The non-⌘K shortcuts pre-fill a prefix:

| Shortcut (press) | Glyph form (displayed) | Prefix | Mode |
| --- | --- | --- | --- |
| `⌘K` | `⌘K` | *(none)* | Ask / type to search files + actions |
| `⌘1` (or `⌘⇧1`) | `⌘!` | `!` | Open tasks (unchecked todos, workspace-wide) |
| `⌘2` (or `⌘⇧2`) | `⌘@` | `@` | Reference — files, people, comments |
| `⌘3` (or `⌘⇧3`) | `⌘#` | `#` | Tags |
| `⌘4` (or `⌘⇧4`) | `⌘?` | `?` | Research |
| `⌘⇧P` | `⌘⇧P` | `>` | Notesage command palette |
| — | `/` | `/` | Invoke a skill |

Both the unshifted and shifted variants are bound to the same action. Users press ⌘1 or ⌘⇧1 — both work. In documentation, tooltips, and menus, the **glyph form is preferred** (⌘! / ⌘@ / ⌘#) because the symbol IS the prefix mode — a visual mnemonic that tells users what they're summoning.

**Double-tap ⌘** — either ⌘ key, double-tapped within \~300 ms, also focuses the command bar. Borrowed from Claude Desktop's double-tap-option; ergonomic for one-handed summoning. Coexists with ⌘K, doesn't replace it. In-app only (global quick-capture stays on ⌘⇧Space, per today's keymap).

### Prefix reassignment — `@` becomes Reference

**Argument.** Cursor, Claude web, ChatGPT, and Cline all use `@` for "attach a file / reference something". Notesage today uses `@` for sub-agent invocation on direct-API connections (and pass-through on ACP connections). The sub-agent-invocation use is increasingly obsolete because modern agents auto-route to specialists based on intent. The file-reference use is one of the top-three chat actions and deserves the prime prefix.

**Change.**

- `@` in the floating bar opens a unified Reference picker showing **files**, **people**, and **comments**, with icons that distinguish type.
- Clicking a result adds it as a chip above the input. Chips go with the next message as attachments (files) or context (people, comments).
- Direct-API sub-agent-via-`@` path is **removed**. Agent auto-routing is the primary mechanism; explicit agent selection moves to a dedicated ⌘-shortcut or an `>` palette entry in a future iteration.
- ACP pass-through behaviour for `@agent-name` is **preserved**. Provider-side subagents (Claude Code's, Codex's, etc.) continue to work by verbatim forwarding. Our `@` popover is the preferred path; `@verbatim-provider-subagent` is a fallback for power users.

**Prefix map (final).**

| Prefix | Bar mode | Source |
| --- | --- | --- |
| *(none)* | Ask the agent | default |
| `/` | Skill — explicit invocation | Notesage |
| `@` | Reference — files, people, comments | new |
| `#` | Tag | editor parity |
| `!` | Open task | ⌘1 |
| `?` | Research | ⌘4 |
| `>` | Command palette | palette entry |

### Quiet chrome — presets and granular toggles

**Argument.** iA Writer, Bear, and Ulysses share a fade-on-type behaviour and users consistently describe it as "the feature that made writing feel different". It's cheap to implement and the perceived-polish return is outsized. But one fade rule doesn't fit every user — some want aggressive quiet, some want the sidebar to stay no matter what. The solution: presets plus a granular toggle panel for power users.

**Change.** Four presets in Settings &gt; Appearance &gt; Quiet chrome:

| Preset | Fades on type | Sidebar | Orb | Note |
| --- | --- | --- | --- | --- |
| Relaxed | Toolbar + status | stays | stays | Minimal fade |
| Default | Toolbar + status + doc-head | stays | stays | Recommended; balanced |
| Aggressive | Everything, including sidebar | fades out | dims to 30% | For deep writing sessions by default |
| Focus mode (⌘.) | Everything | slides out | dims to 30%, locked until ⌘. | Commitment mode |

A 1200 ms inactivity-after-keystroke timer adds a `.typing` class to the app root. Each element subscribes to fade via `.app.typing .element { opacity: 0 }`. Fade-back triggers: mouse move, wheel scroll, focus change, or typing-timer expiry. Transition 340 ms ease.

**Granular advanced panel.** Settings &gt; Appearance &gt; Quiet chrome &gt; Advanced exposes per-element toggles (toolbar, doc-head, status, sidebar, orb). For users who want custom combinations beyond the four presets.

**Hard rule — the composer never fades.** If the user is copying content from the chat stream, rapid keystrokes in the document must not cause the composer to vanish. The floating bar and its expanded stream stay fully visible regardless of typing state. Explicit in the CSS — no `.cmdbar` element has a `.app.typing` rule.

### Sidebar — inline interactions

**Argument.** Today's sidebar delegates most file operations to dialogs. Reveal-in-Finder and Copy-path are missing entirely. The flat-list sidebar reclaims horizontal space we can now spend on fast inline interactions that power users will reach for every day.

**Changes.**

- **Inline rename** — F2 or double-click turns the label into a text input in place; Enter commits, Esc cancels. No modal dialog.
- **Inline create** — `+` icon next to section headers, and `⌘N` on a selected project. A placeholder row appears in place with an input; type name, Enter creates. Works for both files and projects.
- **Copy absolute path** — right-click → Copy path. Shortcut: `⌘⌥C`. Toast on success: `Copied /Users/peter/…/file.md`.
- **Reveal in Finder** — right-click → Reveal in Finder. Shortcut: `⌘⌥R`.
- **Drag-to-pin / drag-to-reorder** — drag a Projects or Recent item into the Pinned section to pin. Drag within Pinned to reorder.
- **Type-to-filter** — with sidebar focus, type to filter each section inline; Escape clears. Matches Linear's list-filter pattern.
- **Hover preview** — hover a file for \~500 ms → popover to the right with first \~10 lines. Same pattern as the Projects hover-peek.
- **Right-click context menu** — shadcn `context-menu` primitive consolidates all of the above plus Duplicate, Move to…, Delete.

**Composition — caps and toggles.** Users with many tags or deep recents don't want them flooding the sidebar. Each section has a cap and can be hidden entirely.

| Section | Default cap | User control |
| --- | --- | --- |
| Pinned | unlimited | fixed (it's explicit) |
| Projects | unlimited | fixed |
| Recent | top 5 | slider 3–15 |
| Tags | top 5 by usage | slider 3–15, or hide |
| Goals | top 3 | slider 0–10, or hide |

"Show more" at the bottom of any capped section expands it in place. Full, unfiltered access to every list is always ⌘K away (file search) or via the appropriate prefix mode (#tags, ?research, !tasks, @references).

Settings &gt; Appearance &gt; Sidebar composition exposes the caps and section-hide toggles.

**Sidebar keyboard shortcuts:**

| Key | Action |
| --- | --- |
| `F2` | Rename selected |
| `⌘N` | New note in selected project |
| `⌘D` | Duplicate |
| `⌘⌥C` | Copy absolute path |
| `⌘⌥R` | Reveal in Finder |
| `⌘⌫` | Move to trash (confirm) |
| `↑ ↓` | Navigate |
| `Space` / `Enter` | Open |

## Accessibility

Notesage serves professional users including those who rely on assistive technology. The new UI must hold WCAG 2.1 Level AA as a floor and behave predictably for keyboard-only, screen-reader, and reduced-motion users. This section is prescriptive — not a generic checklist, but the specific things each new surface must deliver.

### Primer — the four concerns

Accessibility on a desktop app breaks into four independent concerns. A mature component addresses all four:

- **Keyboard navigation.** Every interactive element reachable without a mouse. Visible focus indicator. No "hover-only" affordances — if hovering reveals something, a keyboard path must reveal the same thing.
- **Screen reader.** Every element has a name, a role, and a state. VoiceOver (macOS's built-in) is the primary target. Live-updating regions use `aria-live` at appropriate urgency.
- **Reduced motion.** Users with vestibular sensitivity set `prefers-reduced-motion` in macOS System Settings &gt; Accessibility &gt; Display. Our animations must detect this and skip transitions, not just shorten them.
- **Color contrast.** WCAG AA requires 4.5:1 for body text and 3:1 for large text and UI controls, in both light and dark. Our contrast slider gives users their own lever; our defaults must still pass without it.

### Per-surface requirements

**Floating command bar**

- `⌘K` and double-tap ⌘ focus the bar from anywhere
- Screen reader announces the active mode ("Skill picker", "Reference picker", "Ask") when the prefix changes
- Suggestion list uses `role="listbox"` with `aria-activedescendant`; `↑`/`↓` navigate, `Enter` selects
- When a chat stream is expanded, new messages are announced via `aria-live="polite"` — heard, but not interrupting
- `Esc` always collapses the bar; tab order is input → suggestions → chips → context row
- The compact-state mode pill summary ("Claude · Essays · Agent") is an accessible name for the whole bar

**Agent orb**

- Rendered as a real `<button>`, reachable via Tab, activated by Space/Enter
- `aria-label="Agent — N tasks running"`, updated as count changes; changes announced `aria-live="polite"`
- Pulse animation disabled when `prefers-reduced-motion` is set — the circle remains static, the count badge remains
- Panel opens on Enter; traps focus while open; `Esc` closes and returns focus to the orb

**Sidebar**

- Arrow keys navigate within a section; Tab moves between sections (Pinned → Projects → Recent → Tags → overlay button)
- Inline rename is keyboard-initiated via `F2`; screen reader announces "Renaming *filename*"; `Enter` commits, `Esc` cancels
- **Hover-peek has a keyboard equivalent.** Pressing `→` on a Projects item expands an inline peek (one-level children); `←` collapses. Crucial — a hover-only affordance is invisible to keyboard users and must have this path.
- Right-click context menu also opens via the macOS Menu key or `⌘⇧,` shortcut

**Tree overlay (⌘⇧E)**

- Focus trapped inside overlay while open
- Search input auto-focused on open
- Tree uses `role="tree"` with proper `aria-expanded` / `aria-level` attributes per node
- `Esc` closes and restores focus to whatever triggered the overlay

**Pinned panel mode**

- `role="region" aria-label="Chat panel"` — landmark, navigable via VoiceOver rotor
- Focus does *not* trap — users can Tab out into the document; this is a side surface, not a modal
- Resize handle: keyboard-focusable, `←`/`→` adjust width in 20 px increments, uses `aria-valuenow`/`aria-valuemin`/`aria-valuemax`
- Unpin button: `aria-label="Return chat to floating bar"`

**Permission card (inline in stream)**

- Wrapper has `aria-live="assertive"` — appearance interrupts whatever was being announced, because permission is a blocking gate
- Buttons labeled with full intent: `aria-label="Allow write_file to /Users/peter/Notesage/Essays/drafts/on-attention.md"` — not just "Allow"
- Countdown updates `aria-live="polite"` with throttled phrasing: "auto-deny in 30 seconds" once on appearance, then only at 10 s and 5 s — we don't spam
- Focus auto-moves to the primary Allow button when the card appears
- Tier dropdown is keyboard-reachable

**Focus mode**

- Entering: announce "Focus mode on. Press Command period to exit."
- Focus pill is `aria-hidden="true"` (it's decorative; the announcement already did the work)
- Exiting: announce "Focus mode off. Chrome restored." Focus returns to the pre-focus-mode element
- With `prefers-reduced-motion`, the sidebar slide-out becomes an instant hide

**Quiet chrome fade-on-type**

- Respects `prefers-reduced-motion`: transitions disabled, chrome stays visible (the calm comes from the layout, not the animation)
- Hidden chrome uses `visibility: hidden`, not `display: none` — screen readers still know the structure; they only announce re-appeared content when re-appearing

**Accent color**

- All four options (Default / Orange / Blue / System) pass AA in both light and dark. Dark-mode oklch values tweaked independently; contrast audited via automated scan.
- Critical affordances never rely on accent color alone. The dirty dot has a *position* (next to the filename); the running-task ring has a *pulse animation*; a button state has a *shape* change. A user who can't distinguish the accent still perceives the signal.

**Settings dialog**

- Focus trap on open; `Esc` closes
- Each row: label is the control's accessible name; description text is `aria-describedby` the control
- Search results announce a "N matches" count when the filter changes
- Live preview marked `aria-hidden="true"` — it's decorative for sighted users; settings are the actual interactive targets

### Testing we commit to before Phase 1

- **VoiceOver walk-through** of every user story in this PRD, once per main surface (D, E, I). Any blocker findings become tasks.
- **Keyboard-only walkthrough** — mouse disconnected, five representative flows completed end-to-end. Any flow that requires the mouse is a blocker.
- **Reduced-motion sweep** — every animation has a verified no-animation fallback.
- **Automated contrast audit** — every color pair in `globals.css` scanned against AA thresholds; findings block merge.

### Out of scope for this PRD

- Custom typography for dyslexia (OpenDyslexic and similar) — noted for future
- Voice Control.app — should work via proper ARIA; we verify but don't engineer adaptations
- High-contrast mode beyond what our existing contrast slider provides

## Performance budgets

Notesage already has performance benchmarks in `src/perf/` and a recorded baseline in `docs/performance-baseline.md`. The new components must inherit that rigor or the Quiet Composer risks feeling slower than the UI it replaces. This section states the budgets; enforcement is via the existing benchmark harness (extended with new suites) and real-world instrumentation via the existing `[perf:*]` logger.

### Budgets for new components

| Component / interaction | Budget (dev, 1× multiplier) | Measurement |
| --- | --- | --- |
| Floating bar focus (compact → expanded) | ≤ 100 ms wall-clock | `[perf:cmdbar]` on first expanded frame |
| Floating bar dismiss (expanded → compact) | ≤ 80 ms | `[perf:cmdbar]` |
| Prefix morph (`/` → skill picker, etc.) | ≤ 50 ms | `[perf:cmdbar]` — includes MODES lookup, suggest render |
| Attachment chip add (click `@` result) | ≤ 30 ms | `[perf:cmdbar]` |
| Orb pulse animation | Pure CSS keyframe, **0 ms/frame JS cost** | Chrome DevTools Performance panel — no scripting during pulse |
| Orb panel open | ≤ 120 ms | `[perf:orb]` |
| Status-tray popover open | ≤ 150 ms | `[perf:status]` |
| Sidebar type-to-filter (500 items) | ≤ 50 ms first keystroke, ≤ 20 ms subsequent | `[perf:sidebar]` — matches existing palette-filter budget |
| Hover-peek unfurl (after 220 ms delay) | Render ≤ 60 ms | `[perf:peek]` |
| Tree overlay open (5 000 nodes) | ≤ 200 ms | `[perf:tree-overlay]` |
| Focus mode enter / exit | 340 ms CSS transition; 0 ms JS beyond class toggle | Visual only |
| Fade-on-type class toggle | ≤ 1 ms added to typing pipeline | `[perf:typing]` — typing latency must not regress |
| Context row initial render (3 projects) | ≤ 20 ms | `[perf:cmdbar]` |
| Theme switch (incl. accent change) | ≤ 200 ms | `[perf:theme]` — matches today's baseline |
| Pinned-panel resize drag | 60 fps, zero dropped frames | Chrome DevTools frame timeline |
| Settings dialog open | ≤ 250 ms cold, ≤ 150 ms warm | `[perf:settings]` |

### Budgets for existing components (no regression)

These already have baselines; the new UI must not make them slower:

- **Markdown parse / serialize** — all 4 sizes stay within `markdown.perf.test.ts` budgets
- **Decoration rebuild (search, tags)** — stay within `decorations.perf.test.ts` (all under 2 ms)
- **Store ops** — `updateTabContent` (now `updateDocumentContent`), `listDirectory`, palette filter — stay within current budgets
- **Startup** `phase1-ready` — ≤ current baseline (\~6.3 s on Apple M3 24 GB per `performance-baseline.md`). New chrome must not add &gt; 100 ms.
- **Tab load** — ≤ current baseline per file type
- **AI chat first-token latency** — unchanged (backend path unchanged)

### New benchmark suites required

- `cmdbar.perf.test.ts` — focus / dismiss / prefix morph / chip add
- `orb.perf.test.ts` — panel open with N tasks
- `status-tray.perf.test.ts` — popover open, comments list expand, segmented picker click
- `sidebar-filter.perf.test.ts` — type-to-filter at N = 100 / 500 / 2 000 items

### CI gates

- Unit + perf suites run on every PR
- Perf regressions (new budget exceeded OR existing baseline + 20 %) block merge
- Real-world `[perf:*]` logs captured on every release build; regression against baseline triggers release hold

### Philosophy

We ship perceived-polish improvements (fade-on-type, orb pulse, slide transitions) on top of a codebase that's already fast. If any animation adds measurable lag to typing, we scale back the animation, not the budget. The document typing path is sacred — every other feature exists to serve the act of writing, and the act of writing must feel instant.

## Component inventory

All affected components, with change type and file path. "Preview-gated" means behind the `newUiPreview` setting during Phase 1.

### New components

| Component | Proposed location | Purpose |
| --- | --- | --- |
| `FloatingCommandBar` | `src/components/cmd/FloatingCommandBar.tsx` | The unified input. Hosts compact and expanded states, prefix morphing, attachment chips, chat stream. |
| `CommandBarModes` | `src/components/cmd/modes/*` | One sub-component per prefix mode (`SkillMode`, `ReferenceMode`, `TagMode`, `TaskMode`, `ResearchMode`, `PaletteMode`). |
| `AttachmentChips` | `src/components/cmd/AttachmentChips.tsx` | Chip strip above the input; file/person/comment chips with remove. |
| `AgentOrb` | `src/components/activity/AgentOrb.tsx` | Pulsing bottom-right status indicator. |
| `AgentPanel` | `src/components/activity/AgentPanel.tsx` | Click-out popover above the orb with running tasks. |
| `TreeOverlay` | `src/components/sidebar/TreeOverlay.tsx` | Full summonable tree via `⌘⇧E`. |
| `FolderPeek` | `src/components/sidebar/FolderPeek.tsx` | Hover popover showing one level of a Projects item. |
| `DocHead` | `src/components/editor/DocHead.tsx` | Breadcrumb + dirty dot + `saved` hint at top of document. |
| `FocusPill` | `src/components/editor/FocusPill.tsx` | "Focus · ⌘. to exit" indicator. |
| `SettingsShell` | `src/components/settings/v2/SettingsShell.tsx` | Two-pane dialog shell (nav + content). |
| `SettingsRow`, `SettingsGroup` | `src/components/settings/v2/*` | Primitive row/group components with the label/desc/control pattern. |
| `StatusTray`, `StatusTrayPopover` | `src/components/editor/StatusTray.tsx` | Click-target for the status bar; popover with Completions / Comments / Session / Help groups. Also renders the ambient dots on the strip itself. |
| `ViewerToolbarPill` | `src/components/editor/viewers/ViewerToolbarPill.tsx` | Shared floating pill primitive adopted by PDF / EPUB / DOCX / PPTX / code viewers. |
| `SidebarInlineEdit` | `src/components/sidebar/SidebarInlineEdit.tsx` | Shared inline rename + create input component. Used for F2 rename, `⌘N` new note, `⌘⇧N` new project, sidebar `+` buttons. Handles Enter-commits-writes-FS, Esc-cancels-no-FS-write semantics. |
| `ExternalChangeToast` | `src/lib/notifications.ts` (helper) | Sonner action-toast config for "Review external diff = ON" flow. No new component file; just a reusable `toastExternalChange({ onAccept, onReject, onDismiss })` helper. |

### Modified components

| Component | File | Change |
| --- | --- | --- |
| `Sidebar` | `src/components/sidebar/Sidebar.tsx` | Switch from tree-based render to four flat lists (Pinned, Projects, Recent, Tags). |
| `FileTree`, `FileTreeItem`, `ExplorerFolderItem` | `src/components/sidebar/*` | Logic moves into `TreeOverlay`; the flat-list sidebar replaces the tree view in the default layout. |
| `Toolbar` | `src/components/editor/Toolbar.tsx` | Becomes a floating pill, fades on type. |
| `StatusBar` | `src/components/editor/StatusBar.tsx` | Simplified content; fades on type; updated keyboard hints. |
| `Layout` | `src/components/Layout.tsx` | Remove chat panel column, remove activity strip column, remove tab bar row. Add command bar portal target, add orb portal target. |
| `Settings` (all sub-panels) | `src/components/settings/*` | Adopt new `SettingsShell` + `SettingsRow` primitives. Content mostly preserved; wrapper changes. |
| `BubbleMenu` | `src/components/editor/BubbleMenu.tsx` | Still used for AI actions on selection; unchanged behaviourally. |
| `PdfViewer`, `EpubViewer`, `DocxViewer`, `PptxViewer` | `src/components/editor/viewers/*` | Each adopts `ViewerToolbarPill` replacing its current dense toolbar. All existing viewer functionality preserved; only chrome changes. |
| `CodeEditor` | `src/components/editor/viewers/CodeEditor.tsx` | Gains a lightweight language-indicator pill (same visual family as `ViewerToolbarPill`). CodeMirror content itself unchanged. |
| Skill-detection parser (backend) | `src-tauri/src/commands/skills_tool_parser.rs` *or* frontend skill store | Extend match to any `/skill-name` token preceded by whitespace or at start of message — today matches first char only. See "Interaction details — prefix character behavior". |

### Removed / relocated components

| Component | Change |
| --- | --- |
| `TabBar`, `Tab` (`src/components/tabs/*`) | Removed from default layout (preview-gated). Code retained behind the preview flag during Phase 1, removed in Phase 3. |
| `ChatPanel` (`src/components/chat/ChatPanel.tsx`) | Removed. Its rendering logic (messages, streaming, branching, permission cards) moves into the command bar's expanded stream. |
| `ActivityStrip`, activity panel (`src/components/activity/*`) | Replaced by `AgentOrb` + `AgentPanel`. Same data source (`activity-store`). |
| `CommandPalette` (`src/components/CommandPalette.tsx`) | Absorbed into command bar as `>` mode. The palette becomes a *mode* of the bar, not a separate component. |
| `ChatFooter` (`src/components/chat/ChatFooter.tsx`) | Project multi-select, provider dropdown, mode picker move into the command bar's expanded header row (shown when a chat is active). |
| `NewNoteDialog` (`src/components/NewNoteDialog.tsx`) | **Deleted** entirely. Replaced by inline create (see "Inline creation — no dialogs"). |
| `NewProjectDialog` (`src/components/NewProjectDialog.tsx`) | **Deleted** entirely. Templates (Research / Writing / etc.) move to skills. |
| `DiffReviewBanner` (`src/components/editor/DiffReviewBanner.tsx`) | **Deleted** entirely. External change flow becomes toast-only, gated by "Review external diff" setting. |
| Cross-project-mode banner | **Deleted** entirely. Replaced by a compact warning pill in the composer's context row. |
| `HtmlViewer` / Preview-as-HTML mode | **Removed** — in-app HTML preview deleted. HTML *export* stays. Native HTML rendering deferred to separate future PRD. |

### Shared / state

| Item | Change |
| --- | --- |
| `editor-store` | `openTabs` becomes `openDocuments` (semantically the same set). UI no longer renders a tab strip over it, but keyboard navigation (⌘⇧\[ / ⌘⇧\]) still cycles. |
| `chat-store` | Unchanged data model. Only the renderer moves. `ConversationSegment` boundaries still drive provider-context isolation. |
| `activity-store` | Unchanged. Feeds `AgentOrb` + `AgentPanel`. |
| `settings-store` | **New flag**: \`uiPreview: "legacy" |
| Keyboard shortcuts hook | ⌘1, ⌘2, ⌘3, ⌘4 all route to `focusCommandBar(prefix)`. ⌘⇧P opens palette mode. ⌘⇧E toggles `TreeOverlay`. ⌘. toggles `.app.focus-mode`. |
| Theme tokens | No palette changes. Fix the `html[data-theme]` vs `body[data-theme]` mismatch discovered during mockup work (same bug likely exists in app; audit and standardize). |
| Focus-mode hook | Proper implementation in `src/hooks/useFocusMode.ts` — toggles class, persists state in session, respects reduce-motion setting. |

### Docs that must change

| Doc | Update required |
| --- | --- |
| `docs/design-system.md` | Add Quiet Composer layout section; codify "fade on type" as a design primitive; document the orb + peek + tree-overlay patterns. |
| `docs/features/editor.md` | Tabs removed; doc-head breadcrumb; new keyboard shortcuts. |
| `docs/features/ai-workflows.md` | Chat panel → floating composer; activity strip → orb. |
| `docs/features/workspace.md` | Sidebar model (flat + summonable tree). |
| `docs/keyboard-shortcuts.md` | ⌘1–4 route to command bar prefixes; ⌘⇧E added; ⌘K unchanged. |
| `docs/architecture.md` | Component tree updates. |

## Rollout strategy — my recommendation

**Short answer: opt-in preview, then default-on for new installs, then remove the legacy path.** Not big-bang, not piecewise.

### Why not big-bang

This refresh touches every surface the user interacts with. Shipping it in one release on one Tuesday means every existing user wakes up to a different app. Notesage is a tool people rely on for daily writing — muscle memory matters. A big-bang release invites "I hate the new UI" discourse, forces us to ship the entire refactor perfectly on day one, and leaves no escape hatch if something is wrong.

### Why not piecewise

Because the pieces don't make sense on their own. Removing tabs without shipping the command bar leaves users without fast document switching. Flattening the sidebar without the tree overlay leaves power users marooned. The floating bar without the fade-on-type chrome feels like one more panel on top of the existing chrome. The design *is* a unified vision; half-delivering it is worse than not shipping at all. Piecewise ships a series of half-broken UIs; the final vision never actually lands because each release has a "wait, where did X go?" regression.

### Opt-in preview is the right fit

Google does this constantly — Material You preview, Drive new home, Gmail redesign. It's a mature pattern for a specific reason: *the new UI is a unified vision that needs to ship intact, but you can't force it on everyone*. A preview flag says: "this is how the app will work in the future — try it, tell us what breaks, switch back if you hate it". It respects the user's agency and gives us a feedback loop before we commit irreversibly. The page-header-footer refactor already uses a similar pattern in Notesage (per memory notes), so the precedent is there.

### The proposed three phases

**Phase 1 — Preview (v0.40 — target \~6 weeks after start).**

- `newUiPreview` setting in Settings &gt; Advanced, default **off** for existing installs. A small "Try the new UI" button in the default location.
- **All today's user flows work in the new UI** — open / edit / save documents, chat with AI (direct API + ACP), tool calling, agent delegation, dictation, exports, focus mode, tag/mention/research search, settings, skills management. The new UI is a unified vision shipped intact (per "Why not piecewise" above) — that means it must be functionally complete on its own, not a hollow shell. Switching the toggle on must not regress any existing user flow.
- All new components behind the flag. Old tab strip, chat panel, activity strip, and settings shell still work when flag is off.
- Changelog and release notes explicitly call this out as opt-in.
- In-app invitation (tasteful, one-time, dismissible) on first launch of v0.40.
- Documentation refresh: design-system, feature docs, keyboard-shortcuts, architecture all reflect the new UI.

**Implementation milestones for Phase 1.** The Phase 1 task breakdown (`docs/tasks/2026-04-21-ui-refresh-phase1-tasks.md`) groups the work into milestones M1.1–M1.X. Foundation milestones (M1.1–M1.10 — built the new shell, surfaces, and design system) landed first. Functionality milestones (M1.11+ — wire the editor + chat into the new shell, polish trial findings, run manual a11y QA) close Phase 1 by satisfying the success criteria below. **Phase 1 ships as one release** — Foundation alone is not shippable because the new UI is non-functional without the editor and chat mounted.

**Phase 2 — Default on for new installs (target \~10 weeks after Phase 1).**

- New installs default to `quiet-composer`. Existing installs still default to `legacy` unless they've opted in.
- All blocking issues from Phase 1 trial feedback resolved; the preview is no longer "preview".
- In-app banner on legacy installs: "You're using the classic UI. The new UI is now our recommended default — \[Try it\]".
- Preview flag promoted out of Advanced into a top-level Appearance section toggle.

**Phase 3 — Removal of legacy (≥3 months after Phase 2).**

- Legacy tab strip, chat panel, activity strip components removed from the codebase.
- Preview flag removed.
- Default layout is Quiet Composer.
- Users who *still* want the legacy layout get a read-only "classic look" preset that restores only the easily-preservable bits (e.g., `Show sidebar as tree` setting) — but the fundamental layout is the new one.

Each phase's entry is gated on concrete criteria (see Success Criteria below), not on a calendar date.

### Note on user-base reality (added 2026-04-23)

When this PRD was first drafted, the rollout strategy borrowed Google's preview / default / removal pattern and assumed a non-trivial user base providing feedback signal. **Today, the user base is effectively one person (the project lead, on a single laptop).** No public posts about the app exist on social media; no GitHub forks; downloads are limited to the lead's own dev machine.

This affects the original Phase 2 / Phase 3 wording around "user feedback", "subjective sentiment", and "&lt;5% of active users on legacy":

- **Phase 1 trial signal** comes from the project lead alone for now. No telemetry / call-home is needed at this scale — the lead reports findings directly.
- **Phase 2 / Phase 3 sentiment criteria** become moot when there's no user base to measure. Treat them as placeholders that activate once the app is publicly known and downloaded.
- **Lightweight "call home" idea (deferred):** if/when a wider user base materializes, a single-endpoint usage-counter ping (e.g., `POST` to a GitHub-hosted endpoint or a static file in a public repo via PR) would give Phase 2/3 the signal without committing to a SaaS analytics service. Not analyzing options now — capturing the thought so it's not lost.

Update Phase 2 / Phase 3 success criteria below to reflect this reality.

### What if Phase 1 feedback is hostile?

Then we iterate inside the preview. Phase 2 is gated on feedback quality, not on time. If users reject the vision wholesale (genuinely reject, not just first-day friction), we retreat — the preview has given us the data to know that without imposing it on everyone. That's the whole point.

## Additional mockups to build before task planning

The existing five mockups (A, B, C, D, E) cover the main app shell and settings shell. Before we plan implementation tasks, four more would materially reduce risk:

| Mockup | Purpose | Priority |
| --- | --- | --- |
| **F — Focus mode fully engaged** | Show exactly what's on screen in focus mode (with and without the orb, the focus pill, the bottom safe zone). Static one-state view. | High — easy to build, resolves the "does this actually look clean?" question. |
| **G — Command bar in multi-attachment compose mode** | Bar with 4 attachment chips, a long conversation stream, permission card inline, quick-reply chips. Demonstrates that the bar doesn't visually collapse under heavy use. | High — this is the failure case to pressure-test. |
| **H — ACP permission card inline** | Shows what a tool-call approval request looks like inside the bar's expanded stream (currently it lives in `ChatPanel`). Critical interaction we must not lose. | High — security-critical flow. |
| **I — Narrow window (≤900 px)** | How the layout responds at narrower widths. Sidebar collapses to icon rail? Command bar hugs edges? | Medium — defers to Phase 1 but worth sketching. |
| **J — First-run state** | Empty workspace, empty pinned, empty recent. How does the user discover the command bar exists? A small callout near the bar. | Medium — onboarding matters. |
| **K — Settings subsection density test** | Build the AI & Agents settings page (\~15 rows) to stress-test the row pattern on a genuinely dense panel. | Low — can wait until Phase 1 implementation. |

I'd recommend building **F, G, H** before task planning; defer I, J, K.

## Open questions

1. **⌘ shortcut collisions in the browser.** The mockups' keyboard shortcuts use raw ⌘1–4, which browsers often consume for tab switching. In the Tauri app this works (WebKit respects preventDefault on accelerators) but we should verify on Windows/Linux WebView2 / WebKitGTK targets.
2. **Split view for two documents side-by-side.** Removing tabs raises the question: how do advanced users put two docs next to each other? Option A: ignore for now (open in a second window). Option B: a `⌘\\` split command that halves the workspace. Recommend deferring to a separate "multi-document" PRD.
3. **Where does the project/provider multi-select live?** Currently in `ChatFooter`. Options: (a) inside the command bar's expanded header, (b) as a compact pill in the doc-head, (c) a dropdown on the agent orb. Lean (a).
4. **"Currently editing" context.** Today the AI auto-attaches the current file to every message. With a proper `@` attachment pattern, should auto-attach stay? Lean yes (convenience), but make it visible as an implicit chip the user can remove.
5. **Mobile target timing.** This refresh implicitly narrows the path to a mobile or iPad-optimized version (the floating bar + flat sidebar + orb work beautifully at narrow widths). Out of scope for this PRD but worth noting for product planning.
6. **Theme-toggle placement in-app.** The mockups use a dev-mode corner pill; the real app puts theme in Settings. Confirm the doc-head does *not* need a theme-toggle affordance.
7. **Telemetry.** Do we want any opt-in usage signals during Phase 1 (e.g., "command bar used X times per session") to inform Phase 2 defaults? Previous Notesage work has been telemetry-avoidant; recommend staying so.

## Today → tomorrow · Regression audit

Every flow that exists today must continue to work in the Quiet Composer. This table walks the key flows, notes where the path changes, and flags the ones that need extra care during Phase 1. The critical rule: **no existing user workflow may become impossible**, only relocated or redesigned.

| Flow | Today's path | Quiet Composer path | Risk |
| --- | --- | --- | --- |
| **Open a specific file** | Click a tab, or click a file in the sidebar tree | `⌘K` + two letters + `Enter`, OR click the file in Pinned / Recent | **Medium** — tab muscle memory |
| **See which docs are dirty / unsaved** | Dot on the tab | Dot next to filename in the doc-head breadcrumb; sidebar item also shows dot for off-screen dirty docs | Low |
| **Close a document** | `×` on tab, or `⌘W` | `⌘W` only (no visual close affordance by default — Pinned items have a right-click "Close" option) | Low — same keystroke |
| **Switch between 3+ open docs** | Click tabs | `⌘K` + filename, OR `⌘⇧[` / `⌘⇧]` cycle Recent | **Medium** — retraining tab-cycle habit |
| **Watch an agent working** | Activity strip + panel (right edge, always visible) | Pulsing orb (bottom-right) + click for panel, OR switch to pinned-panel composer mode for persistent visibility | **Medium** — first-time discoverability; covered by onboarding tour + one-time "your agent is working here" callout |
| **See chat history** | History tab inside the chat panel | Clock icon in composer's context row → stream switches to history view | **Medium** — affordance relocates; ⌘⇧H as a secondary binding |
| **Start a fresh conversation** | `+` in chat panel header | `New conversation` button in context row, OR clear attachments + `⌘K` | **Medium** — affordance relocates |
| **Tag / mention / research search** | Command palette in the right mode (⌘2/3/4) | Composer with `@` / `#` / `?` pre-filled (same result, unified surface) | Low |
| **Delegate a comment to an agent** | Right-click selection → Delegate | Unchanged — task surfaces in orb instead of activity panel | Low flow, Medium UI surface |
| **Switch AI provider mid-chat** | ChatFooter provider dropdown | Context row provider pill (click to open) | Low — identical pattern, location moves |
| **Resend / edit a message** | Per-message controls | Unchanged | Low |
| **Branch a conversation** | Per-message branch button | Unchanged | Low |
| **New note (⌘N)** | `NewNoteDialog` modal with folder picker + name input | Inline — `⌘N` creates a row in the sidebar in edit mode in the current doc's folder; file written to disk only on `Enter`. `Esc` cancels, nothing written | **Improvement** — dialog removed; matches rename pattern |
| **New project (⌘⇧N)** | `NewProjectDialog` modal with template picker | Inline — `+` next to Projects header (or `⌘⇧N`) creates row in edit mode; folder created under `~/Notesage/<name>/` on `Enter`. `Esc` cancels. Projects start empty; iCloud migration and templates move elsewhere | **Improvement** — dialog removed |
| **Open folder (⌘O)** | Native folder picker | Unchanged — OS-provided dialog stays | Low |
| **Open a PDF / EPUB / DOCX / PPTX** | Sidebar click → opens as a tab with a dense per-viewer toolbar | Sidebar click → opens in center (no tab). Viewer toolbar is a **floating pill** at top, same visual pattern as the editor toolbar. Fades on scroll. Only controls relevant to that format | Low — toolbars adopt the new pattern |
| **Open a code file** | Sidebar click → opens as tab with CodeMirror | Same, no tab; CodeMirror gets a lightweight language-indicator pill | Low |
| **Find in document (⌘F)** | Floating find bar | Unchanged | Low |
| **Export (⌘⇧E)** | Export dialog (PDF/DOCX/PPTX/HTML) | Unchanged dialog; entry point also in `>` palette. HTML *export* stays; Preview as HTML *mode* is removed | Low |
| **Preview as HTML (⌘⇧P)** | Toggle preview mode | **Feature removed** — half-measure. Native HTML rendering (with JS) deferred to a separate PRD | Removed — flag in release notes |
| **Open Settings (⌘,)** | Current Settings dialog | New two-pane shell (Mockup E), same content reorganized | Low — same entry, redesigned UI |
| **Focus mode (⌘.)** | Partial hide (known issue — doc runs under traffic lights) | Full clean hide with respected safe zone (Mockup F) | **Improvement** — fixes existing complaint |
| **Voice recording (⌘⇧R)** | Overlay + small active-recording indicator | Overlay unchanged; active-recording indicator consolidates into the **Status tray** as a red dot + "Recording" row | Low |
| **Voice transcription config (models, language)** | Settings &gt; Transcription | Same shell, new chrome (Mockup E shell + K's row pattern) | Low |
| **Local AI config (models, server lifecycle)** | Settings &gt; AI (dense existing panel) | Same shell, new chrome (Mockup K covers the panel) | Low |
| **Local AI running indicator** | Settings-only visibility | **Status tray** — ● green dot in status bar; popover shows "Running · model · latency" with Start/Stop. Also a dot on the provider pill in the context row when Local AI is the active provider | **Improvement** — was hidden, now discoverable |
| **Inline completion (ghost text) toggle** | Settings toggle + per-tab right-click | Status tray segmented picker `[Off · Copilot · Local AI · Ollama]` at doc-level; per-tab right-click preserved for power users | **Improvement** — one-click toggle surfaced |
| **Comments: create on selection (⌘⇧M)** | Bubble menu + comment popover | Unchanged | Low |
| **Comments: view list** | Popover from doc-head / editor toolbar | Moves into Status tray's Comments group (expands inline) | Medium — affordance relocates; no ⌘-shortcut today becomes `⌘7` via the shortcuts help |
| **Comments: delegate to agent** | Inside the comment popover | Unchanged | Low |
| **Comments: resolved/unresolved decorations** | Inline editor decorations | Unchanged | Low |
| **Keyboard shortcuts help (⌘7)** | Shortcuts dialog | Same dialog; entry via Status tray icon, `⌘⇧K` shortcut, or `>shortcuts` palette | Low |
| **External change — "Review external diff" OFF (default)** | Clean tab: silent auto-reload + info toast. Dirty tab: `DiffReviewBanner` blocks above the editor | Clean and dirty both: silent auto-reload + info toast (`<name>.md reloaded from disk`, no actions, \~3 s). Banner deleted | **Improvement** — uniform behavior, last banner in main surface removed |
| **External change — "Review external diff" ON** | Inline diff decorations (behind beta flag) | Inline diff decorations + **sticky action toast** (`[Accept · Reject · Dismiss]`). `Accept` = all, `Reject` = none, `Dismiss` leaves decorations for per-hunk review. Per-hunk inline controls unchanged | **Improvement** — promoted from beta to first-class option |
| **Git commit** | Commit dialog, triggered from palette or sidebar | Same dialog; entry via `>` palette or sidebar context menu | Low |
| **iCloud sync, project migration** | Settings &gt; Sync with configure-then-apply | Unchanged | Low |
| **Add a new AI connection** | Settings &gt; Connections + popover | Same shell, new settings chrome (Mockup K) | Low |
| **Enable / disable tool calling** | Settings toggle | Same (Mockup K) | Low |
| **Skills / agents management** | Settings &gt; Skills & Agents | Same | Low |
| **Add an MCP server** | Settings &gt; MCP | Same | Low |
| **Theme toggle (⌘T)** | Cycle light / dark | Unchanged; Appearance section in settings now also has Accent picker | Low |
| **First launch on upgrade (existing user)** | Immediately into current UI | Classic UI retained; `newUiPreview` flag off by default; tasteful one-time banner invites preview | **Critical path** — see Rollout |
| **Heavy tab-strip user with 8+ tabs open** | Tab strip shows all | Pinned = explicit working set (up to 5–7 realistic); `⌘K` or `⌘⇧[/]` for anything else | **High** — main behavioral retraining; mitigated by Phase 1 preview + escape-hatch keybindings |
| **"Always visible" activity rail user** | Persistent rail on right | Pin the composer as side panel (Mockup I) for same always-on visibility; or stay in orb for ambient | **Medium** — the feature exists but users must opt in; documented in release notes |

### Mitigations for Medium/High risks

- **Tab / switching muscle memory** — `⌘⇧[` / `⌘⇧]` bind to "previous Recent" / "next Recent". Ctrl+Tab-style habit carries over without a visual tab strip.
- **Activity discoverability** — one-time callout on the first agent task that highlights the orb. The quick-tour card on first launch also mentions it.
- **History discoverability** — clock icon has a `Conversation history` tooltip. `⌘⇧H` bound as a secondary shortcut.
- **Persistent visibility of chat** — pinned-panel composer mode (Mockup I) covers users who want always-on chat.
- **Critical path (upgrade)** — preview flag default OFF on upgrade; classic UI retained fully; single non-intrusive banner on upgrade release ("Try the new UI"). If banner is ignored, repeats once after 30 days, then is silent.

### The non-negotiable rule

**All legacy components stay in the codebase and remain functional throughout Phase 1 and Phase 2.** The `newUiPreview` flag gates rendering; both code paths ship. Switching back is a single Settings toggle with no data migration required. Legacy components are only deleted in Phase 3, and Phase 3's gate requires &lt;5 % of active users still on the legacy UI (measured in-memory at launch for a single release window, no persistent telemetry).

## Success criteria

### Phase 1 (Preview) ships when:

**Functional (the new UI must be a usable app, not a hollow shell):**

- [ ] Editor (Tiptap) mounts and works inside QuietLayout — open / edit / save markdown documents

- [ ] Chat works inside QuietLayout via the FloatingCommandBar — direct API + ACP + Copilot LSP all reachable

- [ ] All of today's user flows verifiable in the new UI via a manual test plan: new note, open project, delegate comment, export PDF, voice dictation, ACP agent chat, direct-API chat, inline completion, focus mode, tag / mention / research search, settings, skills management

- [ ] Switching the preview flag mid-session flips the layout cleanly (no stale state, no leaked styles, no broken IPC)

- [ ] All of today's documented keyboard shortcuts still work inside the new UI

**Foundation (the new components themselves):**

- [ ] Mockups D + E + F + G + H + I signed off visually (project-lead sign-off pending)

- [x] All new components built, typed, unit-tested (M1.1–M1.10 complete; 4103/4103 unit tests pass)

- [x] Preview flag lives in Settings &gt; Appearance and is reachable

- [x] One-time invitation banner ("Try the new UI") in legacy Layout (#97)

- [ ] Symmetric "Switch back to legacy UI" affordance in QuietLayout (dismissible) so the toggle is discoverable in both directions (#107)

**A11y + perf gates (regression-locked):**

- [ ] Manual VoiceOver run-through: 0 P0 / P1 findings (per `docs/tasks/qa/2026-04-21-voiceover-checklist.md`) — checklist drafted (#99); manual run pending (#108)

- [ ] Manual keyboard-only run-through: all 5 spec flows pass mouse-free (per `docs/tasks/qa/2026-04-21-keyboard-only.md`) — checklist drafted (#100); manual run pending (#109)

- [x] Reduced-motion: every Phase 1 animation disabled (not shortened) under `prefers-reduced-motion: reduce` (#86; 19 regression-lock tests)

- [x] Contrast audit (`pnpm audit:contrast`) passes 0 AA failures across both light and dark themes (#87; 22/22 pairs pass + new `--color-border-strong` token)

- [x] All perf benchmarks (M1.8 + existing) within budget at 1× multiplier; no existing baseline regressed by &gt; 20% (#88–#92; 43/43 perf benchmarks pass)

**Documentation:**

- [x] Updated: `design-system.md`, `editor.md`, `ai-workflows.md`, `workspace.md`, `keyboard-shortcuts.md`, `architecture.md` (#93–#96)

- [x] Phase 1 release notes drafted in `docs/history/release-vX.Y.Z.md` (set version + finalize at /release time) (#98 → `docs/history/105-release-v0.39.0.md`)

### Phase 2 (Default for new installs) ships when:

- [ ] Phase 1 has been in active use for a meaningful trial window (length scaled to actual user base — see "Note on user-base reality" in Rollout strategy above; for the current solo-user phase, the project lead's own daily use over ≥2 weeks is the trial)

- [ ] No P0/P1 issues outstanding from the trial

- [ ] Project lead (and any other active users at that time) confirms net-positive sentiment vs the legacy UI

- [ ] Every surface rebuilt under the new UI is verified pixel-polished against the design system doc and the mockups

- [ ] Settings banner copy written and approved

- [ ] (If a wider user base exists by then) lightweight call-home or GitHub-hosted usage signal in place to track flag-flip ratios

### Phase 3 (Legacy removal) ships when:

- [ ] Phase 2 has been live for a meaningful adoption window (length scaled to user base — see "Note on user-base reality")

- [ ] (If wider user base exists) &lt;5% of active users on the legacy UI, measured by a local setting-state check at app start, aggregated only in-memory for a single release window — no persistent telemetry

- [ ] Codebase delta from removal is reviewed and merged

- [ ] One-release-cycle advance notice given in release notes

## References

- **Mockups.** `docs/design/ui-exploration/mockup-{a,b,c,d,e}.html` — living artifacts. D is the target layout; E is the settings shell. F, G, H will join once built.
- **Research links.** [Ulysses Minimal Mode](https://stories.ulysses.app/keep-your-writing-focused-using-minimal-mode/), [Linear redesign — how we did it](https://linear.app/now/how-we-redesigned-the-linear-ui), [Cursor Cmd+K overview](https://docs.cursor.com/cmdk/overview), [7 UX Patterns for Ambient AI Agents](https://www.bprigent.com/article/7-ux-patterns-for-human-oversight-in-ambient-ai-agents), [Granola](https://www.granola.ai/), [Things 3 features](https://culturedcode.com/things/features/).
- **Internal.** `docs/design-system.md`, `docs/design/page-header-footer-architecture.md` (precedent for staged UI work), `docs/product-description.md`.

## Next steps (proposed)

1. Review and sign off on this PRD.
2. Build Mockups F, G, H (focus mode, heavy compose state, permission card inline).
3. Generate the task breakdown (`docs/tasks/2026-04-21-ui-refresh-tasks.md`).
4. Pick the first Phase 1 milestone and start implementation.

*Mockups linked and ready: open* `docs/design/ui-exploration/mockup-d-synthesis.html` *and* `mockup-e-settings.html` *to re-ground in the proposal before review.*