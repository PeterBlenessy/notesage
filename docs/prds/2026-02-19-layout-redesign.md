# PRD: Layout Redesign (Phase 5.5A)

**Status:** ✅ Complete (v0.10.0)

## Problem

Notesage's current layout has five chrome rows consuming \~130px of vertical space (native title bar 28px + tab bar 36px + toolbar 36px + editor + status bar 24px). The 40px strip is a dead placeholder with 3 action buttons that duplicate keyboard shortcuts. On narrow windows (&lt;1200px), the sidebar becomes a floating overlay that requires a title bar button click to toggle — there's no fluid way to browse files while writing. The status bar only shows word/char count and reading time, missing key context like comments, git branch, and page position. There is no command palette, no focus mode, and no page break visualization.

These limitations make the app feel like a functional prototype rather than a premium writing tool. Competitor apps (Bear, Craft, iA Writer, Linear, Obsidian) solve these problems with custom title bars, contextual status bars, command palettes, and distraction-free modes.

## Goals

1. Reclaim 28px+ of vertical space by replacing the native title bar with a custom one that doubles as a layout toolbar
2. Transform the strip from a dead placeholder into a minimized sidebar with navigation filters (Quick Notes, Projects, Folders) that reveals the full sidebar on hover
3. Add a command palette (Cmd+K) that provides universal access to files, commands, and navigation
4. Add a focus mode (Cmd+Shift+F) that hides all chrome for distraction-free writing
5. Make the status bar contextual — showing comments, git branch, page position, and diff stats only when relevant
6. Show page break markers in the editor when paper size is set

## Non-Goals

- AI overlay input / unified prompt bar (Phase 6 — full version deferred, though an MVP "Let AI do it" button on comments could ship earlier using existing AI providers)
- Jobs panel / async AI task management (Phase 6)
- Cross-device chat persistence (Phase 5.5 — iCloud sync)
- Dual sidebars / right sidebar for non-chat content
- Moving the editor toolbar to the strip (strip is for navigation, not formatting)
- Document outline popover (will be a keyboard shortcut, no strip button)
- Split editor / multi-pane editing
- Custom themes or user-configurable color palettes

## User Stories

1. **As a writer on a narrow screen**, I want to hover the strip to browse my files without permanently pinning the sidebar open, so that I can find and switch files fluidly.
2. **As a writer**, I want to enter focus mode with one keystroke, so that I can write without any UI distractions.
3. **As a power user**, I want a command palette to access any action (open file, toggle theme, export PDF, switch AI provider) from one input, so that I don't need to memorize shortcuts or hunt for buttons.
4. **As a writer with comments**, I want to see at a glance how many comments are on my current document, and click to see a list of them, so that I can navigate my annotations quickly.
5. **As a writer using paper sizes**, I want to see where page breaks fall in my document, so that I can manage pagination while writing instead of discovering it at export time.
6. **As a user in a git repo**, I want to see the current branch in the status bar and click it to switch branches, so that I don't need to open a separate dropdown.
7. **As a writer**, I want the app to maximize vertical space for my content, so that I can see more of my document at once.

## Technical Approach

### 1. Title Bar (Native Overlay Style)

Uses macOS native title bar with Tauri's overlay style — retaining native traffic lights and window chrome while embedding app controls in the title bar region.

**Tauri config:**

```json
{
  "app": {
    "windows": [{
      "decorations": true,
      "hiddenTitle": true,
      "titleBarStyle": "Overlay",
      "trafficLightPosition": { "x": 12, "y": 20 }
    }]
  }
}
```

**Title bar layout:**

```
┌──────────────────────────────────────────────────────────────┐
│ ⦿ ⦿ ⦿  │  [sidebar controls]   (title)          [AI ☐]    │
│ traffic   │  ← in sidebar header   center (drag)   right →  │
│ lights    │                                                   │
└──────────────────────────────────────────────────────────────┘
```

**Behavior:**

- Height: 36px (`h-9`), compact and elegant
- macOS native traffic lights positioned at `(12, 20)` — standard insets
- **Center zone**: Document title (filename of active tab), or "Notesage" when no file is open. Entire bar is a drag region for window movement via `data-tauri-drag-region`
- **Right zone**: AI Chat toggle button (MessageSquare icon)
- Sidebar toggle and "Add Note" buttons live in the sidebar header, not the title bar
- Settings accessible via command palette (Cmd+,) — not in title bar

**Implementation:**

- `TitleBar.tsx` component with `data-tauri-drag-region` for window dragging
- `hiddenTitle: true` hides the native window title text, replaced by the React component
- `titleBarStyle: "Overlay"` keeps native window chrome while allowing content to extend into the title bar area
- Clean, minimal design — no background color or border, blends with content

### 2. Strip Redesign (Minimized Sidebar)

The strip transforms from a generic action bar into the **minimized state of the left sidebar**. It uses the same visual language (same icon style, same padding) so that collapsing the sidebar feels like a smooth transition, not a mode switch.

**Strip layout (40px wide):**

```
┌──┐
│📝│ ← Quick Notes (filter/section)
│📁│ ← Projects (filter/section)
│📂│ ← Folders (filter/section, shown when Explorer has a path)
│  │
│  │   (spacer)
│  │
│⚙ │ ← Settings (bottom-aligned)
└──┘
```

**Behavior:**

- Strip is always visible when the sidebar is closed (current behavior)
- **Hover on strip**: Sidebar slides out as an overlay (280px) from the left edge, on top of the editor content. The sidebar shows the section corresponding to the hovered strip button (e.g., hover "Projects" → sidebar opens scrolled to the Projects section). A short delay (150ms) prevents accidental triggers.
- **Click on strip button**: Same as hover — opens sidebar overlay showing that section. The clicked button gets an active background to indicate the current filter.
- **Click a file in the overlay sidebar**: File opens in the editor. The sidebar remains visible (no auto-hide) so the user can continue browsing.
- **Cmd+B**: Pins the sidebar open (docked, resizable — current behavior). When pinned, the strip is not shown (sidebar replaces it). Cmd+B again unpins and returns to strip + overlay mode.
- **Editor content centering**: The content area always accounts for 40px strip width when centering, regardless of whether the sidebar is docked or floating. This prevents the editor from shifting horizontally when the sidebar opens/closes.

**Icons:** Same `h-4 w-4` size and `strokeWidth={1.5}` as sidebar section headers. Use the same icons: `StickyNote` (Quick Notes), `FolderDot` (Projects), `FolderOpen` (Folders/Explorer).

### 3. Sidebar Reorganization

The sidebar sections are reorganized with clearer hierarchy:

**Current:** Explorer, Projects, Notes

**New:**

```
SIDEBAR
├── Quick Notes        ← ~/Notesage root notes (not in a project)
│   ├── untitled.md       Flat list, sorted by recent
│   └── meeting-notes.md
│
├── Projects           ← Collapsible, each with full file tree
│   ├── ▶ Research Paper
│   └── ▶ Blog Posts
│
└── Folders            ← Explorer (opened via Open Folder)
    └── ▶ ~/Documents/notes
```

**Changes from current:**

- "Notes" renamed to "Quick Notes" (clearer purpose — these are scratch/quick captures)
- Quick Notes always on top (most frequently accessed)
- "Explorer" renamed to "Folders" (less technical, more descriptive)
- Sidebar header shows a sort/group dropdown (accessible from title bar button when sidebar is visible): sort by name, date modified, date created, recent

**Sidebar-specific title bar zone:**

When the sidebar is pinned open, the title bar area above the sidebar shows:

- Sidebar toggle button (right-aligned within sidebar width)
- "Add Note" button (Cmd+N)
- Sort/order dropdown

**Auto-hide in overlay mode:**

When sidebar is in overlay mode (not pinned), clicking a file or pressing Escape hides the sidebar. Clicking the backdrop also hides it. Moving the mouse entirely out of the sidebar + strip area hides it after a 300ms delay.

### 4. Command Palette (Cmd+K)

A universal command palette accessible via `Cmd+K`, similar to Linear/Raycast/VS Code.

**Shortcut conflict:** `Cmd+K` is currently "Insert/edit link on selection" in the editor. Resolution: Command palette only triggers when the editor does NOT have a text selection. When text is selected, `Cmd+K` retains its current link behavior. Alternative: use `Cmd+P` (no current binding) — but `Cmd+K` is the modern standard.

**UI:** Centered overlay (max-width 560px), appears with fade-in + scale animation, backdrop blur. Uses shadcn/ui `Command` (cmdk) component.

**Content:**

```
┌─────────────────────────────────────────────┐
│ 🔍 Type a command or search...              │
├─────────────────────────────────────────────┤
│ Recent Files                                │
│   meeting-notes.md                    ⌘1    │
│   project-goals.md                    ⌘2    │
│                                             │
│ Actions                                     │
│   New Note                           ⌘N     │
│   New Project                        ⌘⇧N    │
│   Export as PDF                       ⌘⇧E   │
│   Toggle Theme                       ⌘⇧T    │
│   Toggle Sidebar                     ⌘B     │
│   Open Settings                      ⌘,     │
│                                             │
│ Navigation                                  │
│   Go to heading...                          │
│   Go to file...                             │
└─────────────────────────────────────────────┘
```

**Sections:**

1. **Recent files** (shown by default, top 5 from `recentFiles` in editor-store)
2. **Actions** (all app commands — new note, export, settings, theme toggle, etc.)
3. **Navigation** (headings in current document, file search)

**Fuzzy search:** The cmdk component handles fuzzy matching. As the user types, results filter across all sections. Files are searched by name, commands by name and keywords.

**Implementation:**

- New component: `src/components/CommandPalette.tsx`
- Uses shadcn/ui `Command` component (cmdk library)
- Registered as a global keyboard handler in App.tsx
- Commands defined as a static array with `id`, `label`, `keywords`, `shortcut`, `action` callback
- File list from workspace-store (all files across all projects + notes + explorer)
- Heading list from current editor content (parsed from ProseMirror document)

### 5. Focus Mode (Cmd+Shift+F)

A distraction-free writing mode that hides all chrome.

**What hides:**

- Custom title bar
- Strip
- Sidebar (if open)
- Tab bar
- Editor toolbar
- Status bar
- Chat panel (if open)

**What remains:**

- Editor content, full-screen, centered at max-width (720px or paper size width)
- A subtle "Esc to exit" hint fades in at top-center for 2 seconds on entry, then disappears

**Shortcut:** `Cmd+Shift+F` (currently planned for "Find and replace" which is not yet implemented — reassign find-and-replace to `Cmd+H` or defer)

**Optional typewriter scrolling:** The active line/cursor stays vertically centered in the viewport. Toggled in Settings (off by default). When enabled in focus mode, the editor scrolls to keep the cursor at \~40% from the top.

**Implementation:**

- New state: `focusMode` in settings-store (not persisted — always starts as `false`)
- App.tsx conditionally hides all chrome when `focusMode === true`
- The editor component fills the entire window (`h-screen w-screen`)
- Escape key exits focus mode
- Cmd+Shift+F toggles focus mode

### 6. Contextual Status Bar

The status bar adapts its content based on the current document and app state.

**Layout:**

```
┌──────────────────────────────────────────────────────────────┐
│  🔀 main              │  💬 3 │  42 words  │  5 min  │ p.2/4 │
│  ← left (workspace) →   ← right (document context) →        │
└──────────────────────────────────────────────────────────────┘
```

**Left zone (workspace context):**

| Condition | Shows |
| --- | --- |
| Active file is in a git repo | Branch name (clickable → branch switcher dropdown) |
| Diff review active | "Reviewing `branch-name`" with change count |

**Right zone (document context):**

| Condition | Shows |
| --- | --- |
| Always (when file is open) | Word count, reading time |
| Document has comments | `💬 N` badge (clickable → comment list popover) |
| Paper size mode active | `p.X/Y` page position indicator |
| Scale is not 100% | Scale percentage (existing) |

**Comment list popover:**

Clicking the comment badge opens a popover listing all comments in the current document:

```
┌─── 3 Comments ──────────────────┐
│ "Introduction paragraph"        │
│  You · 2h ago                   │
│  Need to rework this section... │
│                                 │
│ "API section heading"           │
│  You · 1d ago                   │
│  Add code examples here         │
│                                 │
│ "Conclusion paragraph"          │
│  You · 3d ago                   │
│  Too brief, expand              │
└─────────────────────────────────┘
```

Each item shows: quoted text range (truncated), author, relative time, comment body (truncated). Clicking an item scrolls the editor to that comment's position and highlights it.

**Implementation:**

- Refactor `StatusBar.tsx` to accept context props: `commentCount`, `branchName`, `pageInfo`, `diffInfo`
- Comment count comes from comment-store (filtered by current document's commentKey)
- Branch name from git-store (repo for active project)
- Page info calculated from editor scroll position + content height + page dimensions
- Branch click opens existing `BranchDiffSelector` dropdown (or a simpler branch-switch dropdown)
- Comment popover: new `CommentListPopover.tsx` using shadcn Popover

### 7. Page Break Markers

When the editor is in a paper size mode (A4, A5, Letter — settings from export preferences), show subtle page break indicators in the editor.

**Visual design:**

- Thin dashed lines at page break positions, extending only from the left and right edges inward (\~40px each side), NOT spanning the full page width. This avoids visual interference with tables and other wide content.
- Line style: `border-top: 1px dashed var(--color-border)` with reduced opacity
- Small page number label at the right edge: `p.2`, `p.3`, etc. in `text-[10px] text-muted-foreground/50`

**Calculation:**

Page break positions are calculated from:

- Paper height (A4: 297mm, Letter: 279.4mm, A5: 210mm)
- Margins (from Typst template defaults)
- Content line height and spacing
- This is an approximation — exact Typst pagination may differ, but it gives a useful visual guide

**Toggle:** New setting: `pageBreaks: 'continuous' | 'visible'` (default: `continuous` — no breaks shown). When set to `visible` and a paper size is configured, breaks are rendered.

**Implementation:**

- CSS pseudo-elements or ProseMirror decorations for the break lines
- Page height in pixels calculated from DPI assumption (96 DPI for screen) and paper dimensions minus margins
- A lightweight calculation in the editor component that places break markers at multiples of the page height
- The status bar `p.X/Y` indicator updates based on the editor's scroll position relative to these page breaks

## UI/UX

### Layout modes

**Default (sidebar pinned):**

```
┌──────────────────────────────────────────────────────────────┐
│ ⦿⦿⦿ │ [≡] [+Note] [Sort▾]│  document.md         │ [AI] [⚙] │
├───────┴────────────────────┼─────────────────────┼──────────┤
│                            │  Tab Bar             │          │
│  Quick Notes               │  Toolbar (optional)  │  Chat    │
│    note1.md                │                      │  Panel   │
│    note2.md                │  Editor Content      │          │
│                            │  (centered 720px)    │          │
│  Projects                  │                      │          │
│   ▶ Research               │  --- page break ---  │          │
│   ▶ Blog                   │                      │          │
│                            │                      │          │
│  Folders                   │                      │          │
│   ▶ ~/Documents            │                      │          │
│                            ├─────────────────────┤          │
│                            │ 🔀 main │ 💬3 │42w│5m│p.2/4    │
└────────────────────────────┴─────────────────────┴──────────┘
```

**Default (sidebar minimized, hovering strip):**

```
┌──────────────────────────────────────────────────────────────┐
│ ⦿⦿⦿ [≡]      │         document.md              │ [AI] [⚙] │
├──┬─────────────┼────────────────────────────────┼──────────┤
│📝│ Quick Notes │  Tab Bar                        │          │
│📁│  note1.md   │  Editor Content                 │          │
│📂│  note2.md   │  (centered, offset for 40px)    │          │
│  │             │                                 │          │
│  │ Projects    │                                 │          │
│  │  ▶ Research │                                 │          │
│  │  ▶ Blog     │                                 │          │
│  │             │                                 │          │
│  │             ├────────────────────────────────┤          │
│⚙ │             │ 🔀 main │ 💬3 │ 42w │ 5m │p.2/4          │
└──┴─────────────┴────────────────────────────────┴──────────┘
     ↑ sidebar overlay (on hover/click)
```

**Focus mode:**

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│                                                              │
│              Editor Content                                  │
│              (centered 720px, full height)                   │
│                                                              │
│              The cursor line stays centered                  │
│              when typewriter mode is on.                     │
│                                                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
  Esc to exit (fades after 2s)
```

### Transitions and animations

- Sidebar overlay: slides in from left (`translateX`) with 200ms ease-out
- Strip hover → sidebar reveal: 150ms delay before showing, immediate hide on mouse leave (with 300ms grace period)
- Focus mode enter/exit: 200ms fade transition on all chrome elements
- Command palette: fade-in + scale-up (150ms), backdrop blur
- Page break markers: no animation (static)
- Status bar items: fade in/out when appearing/disappearing (150ms)

### Keyboard shortcuts (new)

| Action | Shortcut | Notes |
| --- | --- | --- |
| Command palette | `Cmd+K` | When no text selection (otherwise: insert link) |
| Focus mode | `Cmd+.` | Toggle distraction-free writing mode |
| Pin/unpin sidebar | `Cmd+B` | Existing, behavior unchanged |
| Document outline | `Cmd+Shift+O` | Popover with heading navigation |

## Data Model

### New state in settings-store

```typescript
interface SettingsState {
  // ... existing fields ...

  /** Whether the editor toolbar is visible */
  toolbarVisible: boolean;

  /** Page break display mode */
  pageBreaks: 'continuous' | 'visible';

  /** Typewriter scrolling in focus mode */
  typewriterScrolling: boolean;
}
```

### New state (non-persisted)

```typescript
// In a layout-store or directly in App.tsx state
interface LayoutState {
  /** Focus mode active */
  focusMode: boolean;

  /** Command palette visible */
  commandPaletteOpen: boolean;

  /** Sidebar hover state (for strip hover → overlay) */
  sidebarHoverActive: boolean;
}
```

### Command palette command interface

```typescript
interface PaletteCommand {
  id: string;
  label: string;
  keywords?: string[];
  shortcut?: string;
  icon?: React.ReactNode;
  section: 'recent' | 'actions' | 'navigation';
  action: () => void;
}
```

### Tauri config (as implemented)

```json
{
  "app": {
    "windows": [{
      "decorations": true,
      "hiddenTitle": true,
      "titleBarStyle": "Overlay",
      "trafficLightPosition": { "x": 12, "y": 20 }
    }]
  }
}
```

## Dependencies

| Dependency | Purpose | Status |
| --- | --- | --- |
| cmdk | Command palette (shadcn/ui `Command` wraps this) | Already available via shadcn |
| Tauri `decorations: false` | Custom title bar | Built-in Tauri feature |
| `data-tauri-drag-region` | Window drag on custom title bar | Built-in Tauri feature |

No new npm or Cargo dependencies required. shadcn/ui `Command` component may need to be installed if not already present.

## Phasing

This PRD covers a large surface area. Suggested implementation order:

### Phase A (Layout Foundation) ✅ Complete

1. Title bar (native overlay style with `hiddenTitle`, traffic lights, drag region, chat toggle)
2. Strip redesign (navigation icons, same visual language as sidebar)
3. Sidebar overlay on strip hover/click
4. Sidebar stays open on file select in overlay mode (no auto-hide — feels more natural)
5. Editor content centering accounts for strip width
6. Configurable toolbar visibility (on/off setting)

### Phase B (Productivity Features) ✅ Complete

7. Command palette (Cmd+K, cmdk component, file search + commands + headings)
8. Focus mode (Cmd+., hide all chrome)
9. Document outline popover (Cmd+Shift+O)

### Phase C (Status Bar & Page Breaks) ✅ Complete

10. Contextual status bar (git branch, comment count, page position)
11. Comment list popover (from status bar badge)
12. Page break markers in editor (visible gaps + continuous margin ticks, togglable in Settings)
13. Page position indicator in status bar (geometry-based, updates on scroll)

## Quality Gates

### Functional

- [x] Title bar uses native overlay style with hidden title, traffic lights, and drag region

- [x] Window is draggable by the title bar

- [x] Traffic lights (close, minimize, fullscreen) work correctly

- [x] Strip shows Quick Notes, Projects, Folders icons

- [x] Hovering strip reveals sidebar as overlay after 150ms

- [x] Clicking a file in overlay sidebar opens the file (sidebar stays open for continued browsing)

- [x] Cmd+B pins/unpins sidebar (docked vs overlay mode)

- [x] Editor content centering is stable when sidebar opens/closes (no horizontal shift)

- [x] Command palette opens with Cmd+K (when no text selection)

- [x] Command palette searches files, commands, and headings with fuzzy matching

- [x] Focus mode hides all chrome and shows only the editor

- [x] Escape exits focus mode

- [x] Status bar shows git branch when in a repo

- [x] Status bar shows comment count when document has comments

- [x] Clicking comment count opens comment list popover

- [x] Clicking a comment in the list scrolls editor to that comment

- [x] Page break markers appear when paper size is set and setting is enabled

- [x] Page position indicator (page X/Y) updates on scroll

- [x] All existing keyboard shortcuts still work

- [x] App builds and runs on macOS without errors

### Design

- [x] Title bar looks native and matches macOS conventions

- [x] Strip uses same icon style and padding as sidebar (no visual discontinuity)

- [x] Sidebar overlay slides smoothly (200ms ease-out)

- [x] Command palette has backdrop blur and smooth animation

- [x] Focus mode transitions smoothly (200ms fade)

- \[x\]Status bar items fade in/out contextually (deferred — instant show/hide for now)

- [x] Page break markers are subtle and don't interfere with reading

- [x] Looks great in both light and dark mode

## Out of Scope

- **AI overlay input / unified prompt bar** — Deferred to Phase 6. The full floating input with Comment/Fix/Delegate modes will be specified in a separate PRD. Note: inline document editing from comments does NOT require agent infrastructure — it can use existing API-based AI providers. An MVP path is adding a "Let AI do it" button to the comment popover that sends the comment text + surrounding context to the current AI provider and applies the result as an inline suggestion (reusing the existing suggestion decoration system).
- **Jobs panel** — Right-side strip for async AI tasks. Phase 6.
- **Split editor** — Viewing two files side by side.
- **Tab removal** — Considered moving tabs into sidebar "Focus items" group. Deferred — tabs stay for now because they provide zero-click file switching.
- **Sidebar "Focus items" group** — Interesting concept (user-pinned files that persist). Needs more design work. Could be added incrementally after the core layout ships.
- **Sidebar sort/group options** — Mentioned in discussion. Simple addition but can be added post-launch.
- **Cross-device job/chat persistence** — Deferred to Phase 5.5 iCloud sync.
- **Typewriter scrolling outside focus mode** — Focus mode only for now.