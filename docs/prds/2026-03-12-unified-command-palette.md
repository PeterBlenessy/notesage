# PRD: Unified Command Palette with Prefix-Based Mode Switching

**Date:** 2026-03-12 **Phase:** — **Status:** ✅ Complete

---

## Problem

The command palette (`CommandPalette.tsx`, 760 lines) serves five distinct search modes — general (Cmd+K), file content search (Cmd+Shift+F), tag search (Cmd+3), mention search (Cmd+2), and research search (Cmd+4) — through a single component controlled by 7 independent boolean state variables in `App.tsx`. This creates three problems:

**1. State fragility:** Each mode requires setting 2-3 booleans in the correct combination. The `onOpenChange` handler must reset all 6 non-open booleans when the palette closes. Adding a new search mode means adding more booleans, more reset logic, and more conditional rendering branches.

**2. Low discoverability:** Users must memorize 5 separate keyboard shortcuts to access different search modes. There is no way to discover these modes from within the palette itself. Competitor apps (VS Code, Bear, Linear) solve this with prefix-based mode switching — type a character to change what you're searching.

**3. Duplicated internals:** Tag search and mention search are architecturally identical — same store shape (`tags[]` + `filesByTag{}`), same two-level UI (list → drilldown → occurrences), same Rust scanning logic, same result format (`TagOccurrence` ≡ `MentionOccurrence`). The only differences are the prefix character (`#` vs `@`) and the display label.

**Why now:** The palette has grown organically across phases. Before adding more search modes (headings, symbols, backlinks), the architecture should be cleaned up to scale gracefully.

---

## Goals

1. **Prefix-based mode switching** — Type `#`, `@`, `>`, or `?` as the first character in the palette input to switch modes, matching the syntax users already know from the editor
2. **Zero-query mode hints** — Show discoverable hints in the palette footer when no prefix is active, so users learn the modes without documentation
3. **Single mode state** — Replace 7 boolean state variables with one `mode` enum derived from input prefix
4. **Unified symbol search** — Merge tag and mention search into a single parameterized code path, reducing \~200 lines of duplicated logic
5. **Preserved shortcuts** — All existing keyboard shortcuts (Cmd+3, Cmd+2, Cmd+4, Cmd+Shift+F) continue to work by pre-filling the prefix

## Non-Goals

- **Universal "search everything" mode** — We are not building Raycast-style cross-category ranking. Each prefix is a distinct mode with its own result set.
- **Removing dedicated shortcuts** — Cmd+3, Cmd+2, Cmd+4 remain as fast paths. Prefixes are additive.
- **New search modes** — This PRD covers the refactor only. Heading search, symbol search, etc. are future work enabled by this architecture.
- **Changing the backend** — Rust scanning commands (`scan_tags_in_directories`, `find_tag_occurrences`, etc.) remain unchanged.
- **Redesigning the palette visually** — Layout, styling, and animations stay the same. Only the input behavior and footer hints change.

---

## User Stories

**US-1:** As a user who opened the command palette with Cmd+K, I want to type `#` to switch to tag search mode, so I don't need to remember a separate shortcut.

**US-2:** As a user who opened the palette, I want to see hints like `# tags @ mentions > commands ? research` in the footer, so I can discover available modes.

**US-3:** As a user who pressed Cmd+3, I want the palette to open with `#` pre-filled in the input and tag search active, so the existing shortcut feels the same.

**US-4:** As a user in tag mode who clears the `#` prefix by backspacing, I want the palette to return to the default (files + actions) mode automatically.

**US-5:** As a user who types `>new note` in the palette, I want to see only actions matching "new note", so I can filter commands without scrolling.

**US-6:** As a developer adding a new search mode, I want to add one entry to a mode registry instead of adding 3 boolean states and updating 5 conditional branches.

---

## Technical Approach

### Mode Derivation from Input

Replace the boolean state variables with a single derived mode:

```typescript
type PaletteMode = 'default' | 'files' | 'tags' | 'mentions' | 'commands' | 'research';

const PREFIX_MAP: Record<string, PaletteMode> = {
  '#': 'tags',
  '@': 'mentions',
  '>': 'commands',
  '?': 'research',
};

function deriveMode(input: string, externalMode?: PaletteMode): PaletteMode {
  if (externalMode === 'files') return 'files'; // Cmd+Shift+F override
  for (const [prefix, mode] of Object.entries(PREFIX_MAP)) {
    if (input.startsWith(prefix)) return mode;
  }
  return 'default';
}

// The search query is the input minus the prefix:
function getQuery(input: string, mode: PaletteMode): string {
  const prefix = Object.entries(PREFIX_MAP).find(([, m]) => m === mode)?.[0];
  return prefix && input.startsWith(prefix) ? input.slice(prefix.length) : input;
}
```

### App.tsx State Reduction

Before (7 states):

```typescript
const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
const [commandPaletteFilesOnly, setCommandPaletteFilesOnly] = useState(false);
const [commandPaletteTagSearchMode, setCommandPaletteTagSearchMode] = useState(false);
const [commandPaletteTagDrilldown, setCommandPaletteTagDrilldown] = useState("");
const [commandPaletteMentionSearchMode, setCommandPaletteMentionSearchMode] = useState(false);
const [commandPaletteMentionDrilldown, setCommandPaletteMentionDrilldown] = useState("");
const [commandPaletteResearchSearchMode, setCommandPaletteResearchSearchMode] = useState(false);
```

After (3 states):

```typescript
const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
const [commandPaletteInitialMode, setCommandPaletteInitialMode] = useState<PaletteMode>('default');
const [commandPaletteDrilldown, setCommandPaletteDrilldown] = useState("");
```

The `initialMode` is only used for external triggers (keyboard shortcuts, badge clicks). Once the palette is open, mode is derived from the input prefix. `initialMode` sets the initial input value (e.g., `#` for tags).

### Keyboard Shortcut Mapping

Shortcuts pre-fill the input prefix instead of setting boolean flags:

| Shortcut | Before | After |
| --- | --- | --- |
| Cmd+K | `setCommandPaletteOpen(true)` | Same (mode = `default`) |
| Cmd+Shift+F | Set `filesOnly=true` | Set `initialMode='files'` |
| Cmd+3 | Set `tagSearchMode=true`, `filesOnly=true` | Set `initialMode='tags'`, input = `#` |
| Cmd+2 | Set `mentionSearchMode=true`, `filesOnly=true` | Set `initialMode='mentions'`, input = `@` |
| Cmd+4 | Set `researchSearchMode=true`, `filesOnly=true` | Set `initialMode='research'`, input = `?` |

Badge clicks (tag/mention in editor) set `initialMode` + `drilldown` + input = `#tagName` or `@mentionName`.

### Unified Symbol Search

Tag and mention search share identical logic. Unify into a parameterized helper:

```typescript
interface SymbolSearchConfig {
  prefix: string;          // '#' or '@'
  label: string;           // 'Tags' or 'Mentions'
  icon: LucideIcon;        // Hash or AtSign
  allItems: string[];      // from store
  filesByItem: Record<string, string[]>;
  findOccurrences: (name: string, paths: string[]) => Promise<SymbolOccurrence[]>;
}
```

The two-level UI (list → drilldown) is rendered by a single `SymbolSearchResults` component that accepts a `SymbolSearchConfig`. This replaces \~200 lines of nearly-identical tag/mention code with one \~100-line implementation.

### Component Props Simplification

Before (11 mode-related props):

```typescript
interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filesOnly?: boolean;
  tagSearchMode?: boolean;
  tagDrilldownName?: string;
  onOpenFileAtTag?: (...) => void;
  mentionSearchMode?: boolean;
  mentionDrilldownName?: string;
  researchSearchMode?: boolean;
  // ... action callbacks
}
```

After (4 mode-related props):

```typescript
interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: PaletteMode;
  drilldownName?: string;
  onOpenFileAtSymbol?: (path: string, name: string, symbol: string, occurrence: number) => void;
  // ... action callbacks (unchanged)
}
```

### Mode-Aware Rendering

The component body uses a single `switch` on `mode` instead of nested ternaries and `&&` guards:

```typescript
// Placeholder text
const placeholder = PLACEHOLDER_MAP[mode];

// Result rendering
switch (mode) {
  case 'default':
    return <>{recentFiles}{actions}{filteredFiles}</>;
  case 'files':
    return <>{filteredFiles}{contentMatches}</>;
  case 'tags':
    return <SymbolSearchResults config={tagConfig} ... />;
  case 'mentions':
    return <SymbolSearchResults config={mentionConfig} ... />;
  case 'commands':
    return <>{actions}</>;  // Actions only, filtered by query
  case 'research':
    return <>{researchResults}</>;
}
```

### Transition Behavior

When the user types or removes a prefix character:

1. **Typing** `#`**:** Mode switches from `default` → `tags`. Previous query is discarded. Tag list appears immediately (pre-scanned in store).
2. **Backspacing past** `#`**:** Mode switches from `tags` → `default`. If in drilldown, drilldown is exited first (existing behavior), then removing the prefix exits the mode entirely.
3. **Typing** `#` **then** `@`**:** Input becomes `#@...`, which is mode `tags` with query `@...`. Only a prefix at position 0 triggers mode switching.

### Commands Mode (`>`)

A new lightweight mode that filters the existing Actions group:

- Shows only action items (New Note, Toggle Theme, Settings, etc.)
- Filtered by the query after `>`
- No new data fetching — same static action list already rendered in default mode

---

## UI/UX

### Input Behavior

- Prefix character (`#`, `@`, `>`, `?`) appears as the first character in the input field
- When a shortcut pre-fills the prefix, the cursor is positioned after it
- The prefix character is visually part of the input (no separate badge or icon) — keeps it simple and editable
- Backspacing past the prefix returns to default mode

### Footer Mode Hints

Replace the current footer (which only shows navigate/select/close hints) with a context-aware footer:

**Default mode (no prefix):**

```
↑↓ navigate  ⏎ select  esc close    # tags  @ mentions  > commands  ? research
```

**Active mode (e.g., tags):**

```
↑↓ navigate  ⏎ select  esc close    ⌫ back to search
```

The hints use the same `kbd` styling as the existing footer. Mode hints are right-aligned, navigation hints left-aligned (preserving current layout).

### Placeholder Text

| Mode | Placeholder |
| --- | --- |
| default | `Type a command or search N files...` |
| files | `Search N files by name or content...` |
| tags | `Search tags...` (or `Filter #tagName occurrences...` in drilldown) |
| mentions | `Search mentions...` (or `Filter @name occurrences...` in drilldown) |
| commands | `Search commands...` |
| research | `Search research...` |

### States

- **Loading:** Spinner for async searches (file content, research, occurrence drilldown) — unchanged
- **Empty:** Mode-specific empty messages (`No matching tags.`, `No commands found.`, etc.)
- **Error:** Console error + empty state (no toast — palette search errors are transient)

---

## Data Model

### New Types

```typescript
/** Palette mode, derived from input prefix or external trigger */
type PaletteMode = 'default' | 'files' | 'tags' | 'mentions' | 'commands' | 'research';

/** Configuration for symbol-type search modes (tags, mentions) */
interface SymbolSearchConfig {
  prefix: string;
  label: string;
  labelSingular: string;
  icon: LucideIcon;
  allItems: string[];
  filesByItem: Record<string, string[]>;
  findOccurrences: (name: string, paths: string[]) => Promise<SymbolOccurrence[]>;
}

/** Unified occurrence type (replaces TagOccurrence + MentionOccurrence) */
interface SymbolOccurrence {
  path: string;
  file_name: string;
  line_number: number;
  occurrence_in_file: number;
  snippet: string;
}
```

### Unchanged

- `useTagStore` and `useMentionStore` — keep as separate stores (different scan schedules, different data)
- All Rust backend commands — no changes
- `ContentMatch`, `ResearchSearchResult` types — unchanged

---

## Dependencies

None. This is a pure frontend refactor using existing dependencies (React, cmdk/shadcn Command, Zustand stores, Tauri API layer).

---

## Quality Gates

### Functional

- [x] Cmd+K opens palette in default mode (recent files + actions + file search)

- [x] Typing `#` switches to tag search mode; tag list appears immediately

- [x] Typing `@` switches to mention search mode; mention list appears immediately

- [x] Typing `>` switches to commands mode; action list appears filtered

- [x] Typing `?` switches to research search mode; debounced search activates

- [x] Backspacing past a prefix character returns to default mode

- [x] Cmd+3 opens palette with `#` pre-filled, tag search active

- [x] Cmd+2 opens palette with `@` pre-filled, mention search active

- [x] Cmd+4 opens palette with `?` pre-filled, research search active

- [x] Cmd+Shift+F opens palette in file search mode (no prefix — dedicated mode)

- [x] Tag badge click in editor opens palette with `#tagName` pre-filled and drilled into occurrences

- [x] Mention badge click in editor opens palette with `@mentionName` pre-filled and drilled into occurrences

- [x] Tag drilldown: selecting a tag shows occurrences; editing input exits drilldown

- [x] Mention drilldown: selecting a mention shows occurrences; editing input exits drilldown

- [x] Research results show title, tags, domain, word count (unchanged)

- [x] Content search (files mode) shows file name, line number, snippet (unchanged)

- [x] All search results open the correct file on selection

- [x] Palette closes cleanly (Escape or click outside) and resets all state

- [x] No regressions: round-trip test passes, no console errors

### Design

- [x] Footer shows mode hints in default mode, styled consistently with existing `kbd` elements

- [x] Footer shows "back to search" hint in active mode

- [x] Prefix character visible in input field, not as a separate badge

- [x] Mode transitions feel instant (no flicker between modes)

- [x] Both light and dark mode look correct

### Code Quality

- [x] App.tsx palette state reduced from 7 variables to ≤3

- [x] CommandPalette props reduced from 11 mode-related to ≤4

- [x] No duplicated tag/mention rendering logic

- [x] Component line count reduced (target: &lt;600 lines from current 760)

---

## Out of Scope

- **Heading / symbol search mode** — Future mode enabled by this architecture (e.g., `^` prefix for headings)
- **Backlinks search** — Future mode (e.g., `[` prefix)
- **Fuzzy matching** — Current substring matching is sufficient; fuzzy can be layered later
- **Persistent search history** — Recently searched queries in the palette
- **Custom prefix configuration** — Prefixes are hardcoded; user customization is not planned
- **Merging tag-store and mention-store** — Stores remain separate; only the UI rendering is unified