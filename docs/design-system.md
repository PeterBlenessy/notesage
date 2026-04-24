# Design System

## Core Mandate

**This is not optional. Every component, every view, every interaction must look polished and professional. Do not write "functional but ugly" code. If a component doesn't look good, it's not done.**

## Component Strategy — USE SHADCN/UI FIRST

**RULE: Never build a custom component if shadcn/ui already has one.** Check the shadcn/ui docs before creating anything. This is non-negotiable.

shadcn/ui components to install and use (not an exhaustive list — check docs for more):

| Need | shadcn/ui component | DON'T build custom |
| --- | --- | --- |
| Buttons | `button` | ❌ custom `<MyButton>` |
| Dropdowns | `dropdown-menu` | ❌ custom dropdown |
| Right-click menus | `context-menu` | ❌ custom context menu |
| Modals/dialogs | `dialog` + `alert-dialog` | ❌ custom modal |
| Tab bar | `tabs` | ❌ custom tab component |
| File/folder tree | `collapsible` + custom tree | ❌ fully custom tree |
| Tooltips | `tooltip` | ❌ custom tooltip |
| Toasts/notifications | `sonner` | ❌ custom toast |
| Text inputs | `input` | ❌ custom input |
| Search/filter | `command` (cmdk) | ❌ custom search |
| Keyboard shortcut display | `kbd` (custom, tiny) | — |
| Toggle switches | `switch` | ❌ custom toggle |
| Select/combobox | `select` or `combobox` | ❌ custom select |
| Separators | `separator` | ❌ custom `<hr>` |
| Scroll areas | `scroll-area` | ❌ custom scrollbar |
| Resizable panels | `resizable` | ❌ custom splitter |
| Popovers | `popover` | ❌ custom floating div |
| Progress indicators | `progress` | ❌ custom progress bar |
| Skeleton loaders | `skeleton` | ❌ custom loading state |
| Breadcrumbs | `breadcrumb` | ❌ custom breadcrumb |

**Install components as needed:**

```bash
pnpm dlx shadcn@latest add button dropdown-menu context-menu dialog alert-dialog tabs tooltip sonner input command switch select separator scroll-area resizable popover progress skeleton collapsible breadcrumb
```

**Rules:**

1. Before writing ANY UI component, ask: "Does shadcn/ui have this?" If yes, use it.
2. Only build custom components for app-specific things that shadcn/ui doesn't cover (the editor itself, AI diff decorations, etc.)
3. When extending shadcn/ui components, compose them — don't fork and rewrite.
4. Use shadcn/ui's `cn()` utility for conditional classnames — don't install `clsx` separately.
5. If you need a component shadcn/ui doesn't have, check Radix UI primitives first before building from scratch.

## Design Philosophy

Notesage should feel like a premium native macOS application. Think: Linear, Raycast, Things 3, Bear, Craft. Not: generic Electron app with default HTML buttons.

### Visual Identity

- **Aesthetic**: Clean, refined, minimal but warm. Not cold/corporate, not playful/toy-like.
- **Inspiration apps**: Linear (layout, polish), Bear (editor warmth), Craft (document feel), Things 3 (sidebar elegance)
- **The feel**: When someone opens Notesage, the first reaction should be "this looks premium"

## Typography

- **UI font**: Use `"SF Pro Display", "SF Pro Text", system-ui` for interface elements (labels, buttons, sidebar). This gives native macOS feel.
- **Editor font**: Use a beautiful serif or sans-serif reading font for the editor content area. Consider `"iA Writer Quattro"`, `"Literata"`, `"Source Serif Pro"`, or `"Charter"`. Load via Google Fonts or bundle.
- **Monospace**: `"JetBrains Mono"`, `"SF Mono"`, or `"Fira Code"` for code blocks.
- **Font sizes**: Establish a clear type scale. Don't use arbitrary pixel values. Use Tailwind's scale: text-xs, text-sm, text-base, text-lg, text-xl, text-2xl.
- **Font weight**: Use weight deliberately. Sidebar items: medium (500). Headings: semibold (600). Body: regular (400). Never use bold (700) for UI elements unless it's a primary action label.

## Color Palette

**STRICTLY NEUTRAL — chromatic colour is opt-in only.**

The base palette is black, white, and greys. All CSS variables in globals.css use `oklch(L% 0 0)` — zero chroma, zero hue. This gives a polished, monochrome aesthetic similar to Linear or Things 3.

Two carve-outs exist, and only two: `--color-destructive` (red, errors/deletions) and `--color-accent-primary` (the user-picked accent — orange / blue / system, opt-in via the `.accent-*` classes on `<html>`). When no accent class is active the accent token falls back to neutral grey, so the default UI is byte-identical to the strict-neutral palette. See the "Accent Token Guardrails" section below for the rules that govern accent usage.

Define the palette using CSS variables in globals.css. All colors must come from this palette — no hardcoded hex values in components. **No color with chroma &gt; 0 in components except via `--color-accent-primary`, `--color-destructive`, or the editor content colour tokens (see below).**

**Editor content color exception:** Text colors, highlight marks, diff decorations, and syntax highlighting use chromatic colors because they convey semantic meaning in document content (e.g., red/green for diffs, colored highlights for user annotation, muted purple/green/blue for code syntax). These are defined as CSS variables in `globals.css` (e.g., `--color-diff-delete-bg`, `--color-highlight-yellow`, `--ns-code-keyword`) with light/dark variants, and are NOT part of the UI chrome palette. Comment highlights and date badges use neutral greys.

**Light mode:**

- Background: white `oklch(100% 0 0)`
- Text/foreground: near-black `oklch(14% 0 0)`
- Primary (buttons, active states): dark grey `oklch(20% 0 0)`
- Muted: light grey `oklch(95.5% 0 0)`
- Borders: subtle grey `oklch(90% 0 0)`
- Focus ring: medium grey `oklch(50% 0 0)` — never blue
- Hover states: gentle background shifts, not color changes

**Dark mode:**

- Background: dark grey `oklch(18% 0 0)` — not pure black
- Text/foreground: near-white `oklch(98% 0 0)`
- Primary (buttons, active states): light grey `oklch(90% 0 0)`
- Muted: `oklch(28% 0 0)`
- Borders: `oklch(32% 0 0)`
- Focus ring: `oklch(60% 0 0)` — never blue

**Contrast slider:**

A "Contrast" slider (Settings > Appearance, range 0–100) continuously interpolates between full contrast (0) and soft contrast (100) for both light and dark themes. The `ThemeProvider` computes intermediate oklch lightness values via `src/lib/contrast.ts` and applies them as inline CSS variables on `<html>`. At level 0, no overrides are applied (base CSS values). The `.soft` / `.dark.soft` classes in `globals.css` are preserved as reference documentation for the soft endpoints.

- Full contrast (0): Light `oklch(100% 0 0)` bg / `oklch(14% 0 0)` fg; Dark `oklch(18% 0 0)` bg / `oklch(98% 0 0)` fg
- Soft contrast (100): Light `oklch(96% 0 0)` bg / `oklch(20% 0 0)` fg; Dark `oklch(25% 0 0)` bg / `oklch(90% 0 0)` fg
- Intermediate values are linearly interpolated between these endpoints

**Border tokens — two variants (WCAG 1.4.11):**

There are two greyscale border tokens in `globals.css`. Pick the right one:

- `--color-border` (Tailwind `border-border`) — decorative hairlines: cards, panels, separators, content groupings. Subtle by design (`oklch(90% 0 0)` light / `oklch(32% 0 0)` dark). Falls under the WCAG 1.4.11 carve-out for "graphical objects that are not required to understand the content" — NOT subject to the 3:1 non-text-contrast requirement. Default for any decorative use.
- `--color-border-strong` (Tailwind `border-border-strong`) — affordance-carrying borders where the border itself conveys UI state (form input outlines, outline buttons, unchecked checkboxes/radios, switch off-state track, focus indicators outside of `--color-ring`). MUST clear 3:1 against `--color-background`. Audited automatically by `scripts/contrast-audit.ts` (`pnpm audit:contrast`).

Rule of thumb: if removing the border would make the user unable to tell that something is interactive or what state it's in, use `border-border-strong`. Otherwise use `border-border`.

**Forbidden colors:**

- No blue, indigo, teal, violet, or any chromatic accent anywhere in the UI — except the single opt-in `--color-accent` token (see "Accent Token Guardrails" below) and `--color-destructive` (red, errors/deletions).
- Hardcoded chromatic hex/rgb/oklch values in components are never allowed. If a chromatic moment is needed, route it through `--color-accent-primary` or `--color-destructive`.
- Links in the editor use `--color-primary` (grey) with underline on hover for distinction. The accent variants only ever lift `--color-accent-primary` (primary buttons, focus rings, dirty dot, editor link colour); surfaces, borders, muted tokens, and editor content colours are NOT touched by the accent system.

## Accent Token Guardrails

The Quiet Composer UI introduced a single chromatic exception to the strict-neutral palette: `--accent` (and its public consumer `--color-accent-primary`). It is the only chromatic token allowed in UI chrome besides `--color-destructive`. Use it sparingly.

**Token shape:**

- `--accent` is set by an opt-in class on `<html>` (`.accent-orange`, `.accent-blue`, `.accent-system`). When no accent class is active, `--accent` is unset and the fallback chain (`var(--accent, var(--color-primary))`) resolves to today's neutral grey palette — existing UI is byte-identical.
- `--color-accent-primary` is the named, single-source consumer token. Components MUST reference `--color-accent-primary` (e.g. via `bg-[var(--color-accent-primary)]`) rather than spelling out `var(--accent, var(--color-primary))` inline. This keeps the fallback in one place and lets a future audit re-point every primary affordance with one edit.
- The token is defined OUTSIDE `@theme` on purpose — it is not auto-registered as a Tailwind colour utility, which avoids name collision with the unrelated neutral surface token `--color-accent`. Reach it via Tailwind's arbitrary-value syntax.

**Variants:**

| Variant | Light mode | Dark mode | Notes |
| --- | --- | --- | --- |
| `.accent-orange` | `oklch(68% 0.21 37)` (Material Deep Orange 500) | `oklch(74% 0.19 37)` | Warm default. ~3.2:1 vs white — clears UI 3:1 but not body 4.5:1. |
| `.accent-blue` | `oklch(56% 0.16 253)` (Material Blue 700) | `oklch(70% 0.14 253)` | Cool alternative. Clears WCAG body 4.5:1 in both modes. |
| `.accent-system` | `var(--accent-system-value, oklch(68% 0.21 37))` | `var(--accent-system-value, oklch(74% 0.19 37))` | Reads the macOS system accent colour at runtime. Falls back to orange when unset (non-macOS, command failure). |

**Where the accent is allowed:**

- Primary button background + hover + focus
- Link button text
- Switch ON state
- Editor link colour
- Tab dirty dot
- Focus rings on chromatic affordances and brand moments

**Where the accent is forbidden:**

- Surfaces (`--color-background`, `--color-card`, `--color-popover`)
- Borders (use `--color-border` or `--color-border-strong`)
- Muted tokens, separators, decorative chrome
- Editor content colours (highlights, diffs, syntax) — those have their own semantic palette
- Anywhere a neutral grey would communicate the same UI state

**`--color-accent-primary` vs `--color-primary`:**

- `--color-primary` — default UI button background, default text-on-surface contrast pair, the workhorse neutral. Use this for everything that does NOT need a chromatic moment.
- `--color-accent-primary` — chromatic affordance (primary CTAs, focus rings on form inputs, active-state indicators, brand moments). Use this when the user-picked accent should bleed through.

**Contrast audit:**

Every accent variant is audited automatically by `scripts/contrast-audit.ts` (`pnpm audit:contrast`). The audit checks `accent / background` at the WCAG UI threshold (3:1) for every accent × theme combination. Current state: orange clears 3.15:1 vs white in light mode, 7.13:1 in dark mode; blue clears comfortably in both. The script runs in CI; any future accent additions must clear the UI threshold in both themes before they can land.

**Anti-patterns:**

- ❌ Hardcoding `bg-blue-500` or `text-orange-600` in a component
- ❌ Spelling `var(--accent, var(--color-primary))` inline instead of using `--color-accent-primary`
- ❌ Inventing a per-feature accent (`--color-cmdbar-accent: oklch(...)`) — pick one of the three official variants
- ❌ Applying the accent to surfaces, borders, or muted chrome — keep accent for affordances, not decoration
- ❌ Using the accent for body text without verifying the contrast pair clears 4.5:1 (orange does not clear body in light mode)

## Quiet Composer Layout

The post-Phase-1 UI shell — mounted only when `settings.uiPreview === "quiet-composer"` — replaces the legacy three-column layout with a quieter, composer-centric arrangement. The shell itself lives in `src/components/QuietLayout.tsx`. Each surface below is the canonical implementation; do not invent a parallel surface for the same role.

### Floating Command Bar

Single composer for both AI prompts and prefix-driven palette modes. Three states:

- **Compact pill** — centred placeholder pill near the bottom of the viewport, ~480 px wide, hints at the `⌘K` shortcut. Click or `⌘K` expands.
- **Expanded composer** — same pill grows to ~640 × 480 px, autofocuses an input, reveals the conversation stream and attachment chips. `Esc` collapses (two-stage when a prefix mode is active: first `Esc` clears the prefix, second collapses).
- **Pinned-side panel** — when `settings.cmdBarPinned === true`, the bar docks as a permanent right-edge panel with a draggable left-edge resize handle. Width persists in `settings-store.cmdBarPinnedWidth` and is driven by the `--cmd-bar-pinned-width` CSS variable so resize doesn't re-render React.

Accessibility: the input wears `role="combobox"`, the picker dropdowns wear `role="listbox"`, and `aria-activedescendant` mirrors the highlighted picker option so AT users hear the same selection feedback as sighted users. Pinned mode adds `role="region"` + `aria-label="Chat panel"` so the docked panel becomes a navigable landmark.

The bar lifts 14 px on focus with a 200 ms ease transition; reduced-motion strips the lift and the height transition (the bar snaps).

Implementation: `src/components/cmd/FloatingCommandBar.tsx` (orchestrator), `src/components/cmd/modes/*.tsx` (one picker per prefix: `/`, `@`, `#`, `?`, `>`, `!`).

### Agent Orb

46 × 46 px ambient indicator pinned to the bottom-right (`fixed bottom-6 right-6`). When background agent tasks are running, the orb shows the count and pulses; otherwise it sits as a static neutral circle with a faint Bot glyph. Hidden via `display: none` when `cmdBarPinned` is true — the pinned panel covers the same screen real estate.

Open behaviour: rendered as a `<button>` inside a shadcn `Popover`, so Space/Enter activation, focus trapping, `Esc` to close, and focus restoration to the orb on close all come from the platform. Clicking opens the `AgentPanel` Popover.

Pulse: pure CSS via `@keyframes orb-pulse` in `globals.css` and the `.orb-pulsing` class — zero JS in the animation loop. Components must check `useReducedMotion()` and omit the class when reduce is set; the keyframe definition also has a `@media (prefers-reduced-motion: reduce)` guard as defence-in-depth.

Implementation: `src/components/activity/AgentOrb.tsx`, `src/components/activity/AgentPanel.tsx`.

### Quiet Sidebar

Flat-list sidebar in fixed section order: **Pinned → Projects → Recent → Tags**. No file tree by default — this is intentional. The sidebar is for navigation between user-anchored items (pinned files, project roots, MRU documents, tag entries), not for browsing arbitrary subtrees.

Type-to-filter: when the sidebar has focus, printable keys append to a local filter string passed down to every section. A small badge at the top shows the current filter; Backspace deletes a character, `Esc` clears. Text-entry surfaces inside the sidebar (rename rows, the TreeOverlay search box) own their own keystrokes via an `isTypingTarget` guard.

The Tags section can be hidden entirely via `settings.sidebarTagsHidden` (Settings > General > Quiet sidebar composition).

Implementation: `src/components/sidebar/quiet/QuietSidebar.tsx` (shell), `PinnedSection.tsx`, `ProjectsSection.tsx`, `RecentSection.tsx`, `TagsSection.tsx`.

### Tree Overlay (`⌘⇧E`)

Slide-in workspace-tree panel that gives the deep-dive view the flat sidebar omits. Triggered globally via `⌘⇧E`. Renders a `role="tree"` hierarchical view of every open project with caret-triangle expand/collapse, a search/filter input, and full keyboard navigation (arrows, Home/End, Enter/Space, Esc).

Focus is **trapped** inside the overlay while open and **restored** to the previously focused element on close — the user never loses their place in the editor or sidebar. Scope: only `workspace-store.projects` are rendered; Explorer folders and the Notes tree are intentionally excluded.

Implementation: `src/components/sidebar/quiet/TreeOverlay.tsx`, gated by `useTreeOverlayStore`.

### Folder Peek

Hover-triggered popover that previews one level of a project's contents. Timing:

- **220 ms** hover delay before opening
- **150 ms** grace period on mouse-leave so the cursor can cross the gap to the popover content
- Keyboard parity: pressing `→` on a focused project row inline-expands the same one-level preview

Folders first, files second, each sorted alphabetically and capped (8 folders, 6 files). Overflow surfaces as "+N more…" hints with a "See full tree" link that elevates to the TreeOverlay (`⌘⇧E`).

Both the hover popover and the keyboard expansion use the same `derivePeekChildren()` helper so the two surfaces never drift.

Implementation: `src/components/sidebar/quiet/FolderPeek.tsx`.

### TitleBar (quiet mode)

QuietLayout replaces the legacy `TabBar` with nothing between the `TitleBar` and the editor surface — the breadcrumb row previously rendered here (`DocHead`) was removed in task #131. Instead, the `TitleBar` in quiet mode (`src/components/TitleBar.tsx`, `mode="quiet"`) carries two pieces of document chrome in its right zone: a dirty dot (shown when the active tab has unsaved edits) and a right-aligned "saved Xs ago" timer (`src/components/SavedLabel.tsx`). The filename itself is still centred in the bar via `editor-store.activeTabId`.

The classic shell keeps its `TabBar` row where per-tab dirty dots live; `TitleBar` in `mode="classic"` renders the chat + activity toggle buttons instead of the saved-ago chrome.

### Status Tray + Status Bar

Compact strip pinned to the bottom of the editor zone with a popover for detail. The `StatusBar` is the always-visible row (file name, dirty indicator, language, completion provider icon); the `StatusTray` is the popover-anchored detail panel (provider switcher, completion toggle, recording controls, tools indicator).

Implementation: `src/components/editor/StatusBar.tsx`, `src/components/editor/StatusTray.tsx`.

### Focus Mode (`⌘.`)

Toggle distraction-free focus mode. Single source of truth lives in `useFocusMode` (`src/hooks/useFocusMode.ts`):

- `⌘.` (or `Ctrl+.` on non-mac) toggles focus from any state, captured at window level so the legacy bubble-phase listener never double-fires while QuietLayout is mounted.
- `Esc` exits focus mode **with fall-through priority** — open Radix popovers/dialogs/menus, the expanded command bar, and inline rename rows all consume `Esc` first. Focus mode only exits when nothing else claims the key.
- Applies `.focus-mode` to the QuietLayout root. CSS in `globals.css` (`.app.focus-mode …`) fades the sidebar, hides the pill Toolbar + StatusBar, dims the orb to 30%, and adds +110 px top-padding so text clears the macOS traffic lights.
- Announces enter/exit to AT via a short-lived `aria-live` region appended to `document.body` ("Focus mode on. Press Command period to exit." / "Focus mode off. Chrome restored.") — exact wording from the PRD.
- **Pre-enter focus restoration:** the active element is captured on enter and restored on exit so the user lands back where they started.
- Reduced-motion: the hook is unaffected (the class toggles instantly either way); the CSS honours the preference via a `@media` rule that zeros the transitions.

The companion overlay `<FocusPill />` (`src/components/editor/FocusPill.tsx`) is visual-only chrome — it relies on the hook's announcer rather than declaring its own `role="status"` to avoid double-announcements.

## Fade-on-Type Pattern

While the user is typing, the QuietLayout fades a configurable subset of chrome targets to ~0 opacity, restoring full opacity 1.2 s after the last keystroke or as soon as the user moves the mouse, scrolls, or shifts focus. The pulse is the basis of the "quiet" in Quiet Composer: chrome stays out of the way during writing but never disappears for good.

**Mechanism:**

- `useFadeOnType` (`src/hooks/useFadeOnType.ts`) toggles a `.typing` class on the QuietLayout root (`[data-quiet-layout-root]`) — DOM is the read path; no React re-renders per keystroke.
- Typing events (`keydown`, `keypress`, `input` — capture phase) add the class; cancel events (`mousemove`, `wheel`, `scroll`, `focusin`) remove it; a 1200 ms inactivity timer auto-removes it as a fallback.
- Targets inside `[data-cmd-bar]` are excluded from typing signals — the user may be typing the chat prompt itself, which must stay fully visible. **The command bar never fades. No CSS rule should target `.app.typing [data-cmd-bar]`.**

**Per-element opt-in (`useQuietChrome`):**

Components opt into the fade by carrying a stable data attribute, and `useQuietChrome` (`src/lib/quiet-chrome.ts`) writes a `data-quiet-chrome-<target>="fade" | "stay"` attribute onto the root for each target. CSS rules key off both the `.typing` class AND the per-element attribute — a target only fades when the preset says so.

| Target | Component attribute | Root attribute |
| --- | --- | --- |
| `toolbar` | `data-quiet-toolbar` | `data-quiet-chrome-toolbar` |
| `status` | `data-quiet-status` | `data-quiet-chrome-status` |
| `docHead` | _(none — inert since #131)_ | `data-quiet-chrome-dochead` |
| `sidebar` | `nav[aria-label="Workspace sidebar"]` | `data-quiet-chrome-sidebar` |
| `orb` | `[data-testid="agent-orb"]` | `data-quiet-chrome-orb` |

**Three presets** (Settings > General > Quiet chrome):

- **Relaxed** — toolbar + status only ("hide minimum")
- **Default** — toolbar + status (recommended; the DocHead option is legacy since #131)
- **Aggressive** — everything including sidebar dim and orb dim ("hide all")
- **Custom** — per-element overrides from settings; the resolver returns overrides as-is

**Reduced motion:** when `prefers-reduced-motion: reduce` is set, `useFadeOnType` is a no-op (no listeners installed, `.typing` never added). The CSS transition duration is also zeroed under the same media query as defence-in-depth, so any other code that mutates opacity still renders without animation. A `matchMedia` change listener re-enables the hook if the user toggles the OS preference at runtime.

**Hover/focus override:** every fade rule is wrapped in `:not(:hover):not(:focus-within)` so direct interaction with a faded target keeps it visible — belt-and-braces for keyboard-driven focus changes that don't emit `mousemove`.

## Component Patterns

### Ambient Indicator Pattern (Orb)

Use this pattern when you need to surface background activity without grabbing the user's attention:

- Render as a small (40–48 px), self-contained shape — circle by default — pinned to a corner of the layout
- Anchor the detail panel via a shadcn `Popover` so focus trapping, Esc-to-close, and focus restoration come from the platform — never roll your own positioning
- Animate ambient state with a CSS-only keyframe (`@keyframes …` + opt-in class). Keep JS off the animation loop
- Strip the animation class when `useReducedMotion()` is true; mirror the strip in a `@media (prefers-reduced-motion: reduce)` block as defence-in-depth
- Hide the orb when a competing surface (e.g. pinned command bar) covers the same screen real estate — never overlap

When the indicator becomes a permanent panel rather than a transient popover, switch surface idioms — use a docked region with `role="region"` and `aria-label`, not a floating orb.

### Peek + Overlay Pattern

Use this pattern when a hover-preview and a deep-dive overlay reveal the same data:

- Hover preview opens after 220 ms; closes after a 150 ms grace period so cursor can cross gaps
- Provide keyboard parity via the `→` arrow key on a focused row — the preview must work without a mouse
- Both surfaces share the same derivation helper (e.g. `derivePeekChildren()`) — duplicating the derivation lets the two surfaces drift visually
- Both surfaces elevate to a focus-trapped overlay via `⌘⇧E` (the canonical "show me the full tree" shortcut)
- Cap the preview list (folders 8, files 6 in the workspace tree) and surface overflow as "+N more…" with a "See full tree" link that opens the overlay
- The overlay must trap focus while open and restore focus to the previously focused element on close

## Spacing & Layout

- **Generous whitespace**: Don't cram elements together. When in doubt, add more padding.
- **Consistent spacing**: Use Tailwind's spacing scale consistently. Sidebar padding, editor margins, toolbar spacing should all follow the same rhythm.
- **Sidebar width**: 240-280px, resizable. Not too narrow, not too wide.
- **Editor content width**: Max 720px centered, like a well-typeset document. Don't let text span the full window width.
- **Visual hierarchy**: Use spacing (not just font size) to create hierarchy. Sections separated by generous gaps.

## Components — Specific Requirements

### Sidebar

- Smooth hover transitions (150ms ease)
- Active file: subtle background highlight + left accent border (2-3px)
- Folder expand/collapse: smooth rotation animation on chevron icon
- File icons: use lucide-react icons, muted color, consistent size
- Section labels (if any): uppercase, text-xs, tracking-wider, muted color
- Scrollbar: thin, only visible on hover (use custom CSS)

### Tab Bar

- Tabs should feel like browser tabs or VS Code tabs — not flat buttons
- Active tab clearly distinguished (background, bottom border, or elevation)
- Close button: only visible on hover over the tab
- Dirty indicator: small dot, accent color, positioned consistently
- Smooth transitions when switching, adding, removing tabs
- Max tab width, truncate long filenames with ellipsis

### Editor Area

- Content area should feel like a clean writing surface
- Heading styles: clear visual hierarchy with size AND weight AND spacing
- Block quotes: left border (accent color, 3px), slightly muted text, padding-left
- Code blocks: distinct background (#F5F5F5 light, #2D2D2D dark), rounded corners (8px), proper padding, syntax highlighting with a tasteful theme (One Light / One Dark or similar)
- Task lists: custom checkbox styling (not browser default), smooth check animation
- Tables: clean borders, header row styling, alternating row backgrounds optional
- Links: accent color, subtle underline on hover
- Images: rounded corners, subtle shadow, max-width contained

### Floating Toolbar

- Appears with smooth fade+slide animation (150ms)
- Rounded, slight shadow/elevation
- Frosted glass effect (backdrop-blur) if possible
- Compact but not cramped — proper icon spacing
- Active formatting indicated clearly (background or color change)
- Disappears smoothly when selection is lost

### Slash Command Menu

- Appears below cursor with smooth animation
- Search/filter at top
- Icons for each block type
- Keyboard navigation with highlighted current item
- Rounded corners, elevation/shadow, consistent with toolbar style

### Context Menus (Right-click)

- Use shadcn/ui ContextMenu — don't build custom
- Consistent padding, icon alignment, keyboard shortcut display
- Smooth open animation

### Dialogs/Modals

- Overlay with backdrop blur
- Centered, max-width 480px for simple dialogs
- Smooth scale-in animation
- Focus trap and keyboard handling (shadcn/ui handles this)

## Animations & Transitions

- **Everything interactive should have a transition.** No instant state changes.
- Default transition: `transition-all duration-150 ease-in-out`
- Sidebar folder expand: height animation with easing
- Tab switching: no jarring content flash
- Theme toggle: smooth color transitions on all elements (use `transition-colors duration-200`)
- Hover states: background color shifts, not border additions
- Never use `transition-all` on large containers — be specific (transition-colors, transition-opacity, etc.)

## Icons

- **Library**: lucide-react (already included with shadcn/ui)
- **Size**: 16px for inline/sidebar, 18-20px for toolbar, 24px for empty states
- **Weight**: Use strokeWidth={1.5} for a refined look (default is 2, which feels heavy)
- **Color**: Muted by default (text-muted-foreground), accent on active/hover

## Anti-patterns — NEVER DO THESE

- ❌ Default browser checkboxes, radio buttons, or selects
- ❌ Unstyled scrollbars
- ❌ Pure black (#000000) or pure white (#FFFFFF) backgrounds
- ❌ Borders thicker than 1px on UI elements
- ❌ Box shadows that look like 2010 (large, dark, obvious). Use subtle, layered shadows.
- ❌ Inconsistent border-radius (pick 6px or 8px and use it everywhere)
- ❌ Text that spans more than 80ch wide in the editor
- ❌ Abrupt state changes without transitions
- ❌ Generic gray (#808080) for anything — use the defined palette
- ❌ Placeholder content or "Lorem ipsum" left in the UI
- ❌ Unaligned elements — everything should snap to a consistent grid
- ❌ Default focus rings — replace with custom, on-brand focus indicators
- ❌ Any blue, indigo, teal, violet, or chromatic accent colour outside the official `--color-accent-primary` and `--color-destructive` tokens — the rest of the palette is strictly neutral greyscale
- ❌ Using `text-blue-*`, `bg-blue-*`, `border-blue-*`, or any Tailwind colour class with a hue (route chromatic affordances through `--color-accent-primary` instead)
- ❌ Inventing new chromatic CSS variables (chroma &gt; 0) outside the accent / destructive / editor-content token families
- ❌ Spelling out `var(--accent, var(--color-primary))` inline — go through `--color-accent-primary`
- ❌ Using the accent for body text without verifying the contrast pair clears 4.5:1 (orange does NOT clear body in light mode)

## Quality Check — Ask Yourself Before Every Component

1. Would this look out of place in Linear or Craft? If yes, redo it.
2. Does every interactive element have a hover/active/focus state?
3. Are colors from the defined palette (CSS variables), not hardcoded?
4. Is spacing consistent with the rest of the app?
5. Does it look good in BOTH light and dark mode?
6. Are transitions smooth and intentional?
7. Would a designer approve this, or would they say "it works but it's ugly"?

## Implementation Notes

### Dark Mode & Soft Contrast Support

All components must work in both light and dark modes, and with soft contrast enabled:

- Use CSS variables from `globals.css` for all colors
- Test every component in both themes (and with soft contrast toggled)
- Use `dark:` prefix for dark mode-specific styles
- Logos and images should be visible in both modes (add white background if needed: `bg-white p-0.5`)
- Soft contrast is applied via inline CSS variable overrides on `<html>` by the `ThemeProvider` — no component-level changes needed if CSS variables are used correctly

### Accessibility

- All interactive elements must have focus states
- Use semantic HTML
- Provide alt text for images
- Ensure keyboard navigation works
- ARIA labels where needed
- Sufficient color contrast (WCAG AA minimum)