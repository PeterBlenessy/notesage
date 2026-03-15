# Tasks: Unified Command Palette with Prefix-Based Mode Switching

**PRD:** `docs/prds/2026-03-12-unified-command-palette.md`**Total:** 7 tasks (2S, 4M, 1L) — ✅ C**omplete**

**Suggested order:** Sequential #1 → #7. Tasks #1-#2 are foundational types/utilities. Task #3 is the core refactor. Tasks #4-#5 simplify the calling code. Tasks #6-#7 are the new features enabled by the refactor.

---

## Task 1: Add PaletteMode type and mode utility functions ✅

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Description**:Create shared types and utility functions used by both `CommandPalette.tsx` and `App.tsx`.

**What to implement:**

- `PaletteMode` type: `'default' | 'files' | 'tags' | 'mentions' | 'commands' | 'research'`
- `PREFIX_MAP` constant: `{ '#': 'tags', '@': 'mentions', '>': 'commands', '?': 'research' }`
- `deriveMode(input, externalMode?)` — returns mode from input prefix, with `files` override
- `getQuery(input, mode)` — strips prefix from input to get the search query
- `SymbolSearchConfig` interface and `SymbolOccurrence` type (unified tag/mention occurrence)

**Acceptance criteria:**

- Types are importable from `CommandPalette.tsx` and `App.tsx`
- `deriveMode('#foo')` returns `'tags'`, `deriveMode('foo')` returns `'default'`, `deriveMode('anything', 'files')` returns `'files'`
- `getQuery('#foo', 'tags')` returns `'foo'`, `getQuery('bar', 'default')` returns `'bar'`

**Files:**

- Create `src/lib/command-palette.ts` (types + utilities)

---

## Task 2: Extract SymbolSearchResults component ✅

**Complexity:** M | **Category:** frontend | **Dependencies:** #1

**Description**:Extract the duplicated tag/mention two-level search UI (list → drilldown → occurrences) into a single parameterized component.

**What to implement:**

- `SymbolSearchResults` component accepting `SymbolSearchConfig` + drilldown state + callbacks
- Handles: filtered item list, item selection → occurrence fetch, drilldown rendering, drilldown exit on input change
- Uses the same `CommandGroup` / `CommandItem` structure as current tag/mention sections
- Workspace path gathering (explorer folders + projects + notesRootPath) extracted into a shared helper `getSearchPaths()` — currently duplicated 4 times in the component

**Acceptance criteria:**

- Component renders identically to current tag search UI when given tag config
- Component renders identically to current mention search UI when given mention config
- `getSearchPaths()` returns the same paths as the current inline logic
- No visual or behavioral changes from the user's perspective

**Files:**

- Create `src/components/SymbolSearchResults.tsx`
- Add `getSearchPaths()` to `src/lib/command-palette.ts`

---

## Task 3: Rewrite CommandPalette with mode-derived rendering ✅

**Complexity:** L | **Category:** frontend | **Dependencies:** #1, #2

**Description**:Replace the boolean-flag mode system in `CommandPalette.tsx` with prefix-derived mode switching. This is the core refactor.

**What to implement:**

**New props interface:**

```typescript
interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: PaletteMode;       // replaces filesOnly, tagSearchMode, mentionSearchMode, researchSearchMode
  drilldownName?: string;           // replaces tagDrilldownName, mentionDrilldownName
  onOpenFileAtSymbol?: (path: string, name: string, symbol: string, occurrence: number) => void;
  // action callbacks unchanged
  onNewNote, onNewProject, onOpenFolder, onOpenSettings, onExportPdf, onToggleFocusMode
}
```

**Mode derivation:**

- On open: set initial input from `initialMode` (e.g., `'tags'` → `#`, `'mentions'` → `@`, `'research'` → `?`, `'files'` → empty)
- On input change: call `deriveMode(input)` to get current mode; if mode changed, clear drilldown state
- `getQuery(input, mode)` strips prefix for filtering/searching

**Rendering by mode (switch statement):**

- `default`: Recent files + actions + filtered files (existing)
- `files`: Filtered files + debounced content matches (existing)
- `tags`: `<SymbolSearchResults config={tagConfig} />`
- `mentions`: `<SymbolSearchResults config={mentionConfig} />`
- `commands`: Actions group only, filtered by query
- `research`: Debounced research results (existing)

**Placeholder text:** Mode-aware via `PLACEHOLDER_MAP`

**shouldFilter prop:** Disable cmdk filtering for all non-default modes (tags, mentions, research, files, commands all do their own filtering)

**Acceptance criteria:**

- Typing `#` in empty palette switches to tag mode; tag list appears
- Typing `@` switches to mention mode
- Typing `>` shows only actions, filtered by query
- Typing `?` activates research search
- Backspacing past prefix returns to default mode
- `initialMode='files'` shows file search without prefix (Cmd+Shift+F behavior)
- `drilldownName` auto-drills into tag/mention occurrences (badge click behavior)
- All existing result types render identically
- Component &lt; 600 lines (down from 760)

**Files:**

- Rewrite `src/components/CommandPalette.tsx`

---

## Task 4: Simplify App.tsx palette state and shortcut callbacks ✅

**Complexity:** M | **Category:** frontend | **Dependencies:** #3

**Description**:Replace the 7 boolean state variables and complex shortcut callbacks in `App.tsx` with the simplified state model.

**What to implement:**

**State reduction (lines 108-114):**

```typescript
// Before: 7 states
// After: 3 states
const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
const [commandPaletteInitialMode, setCommandPaletteInitialMode] = useState<PaletteMode>('default');
const [commandPaletteDrilldown, setCommandPaletteDrilldown] = useState("");
```

**Shortcut callbacks (lines 765-791):**

```typescript
onCommandPaletteOpen: () => { setCommandPaletteInitialMode('default'); setCommandPaletteOpen(true); },
onFileSearchOpen: () => { setCommandPaletteInitialMode('files'); setCommandPaletteOpen(true); },
onTagSearchOpen: () => { setCommandPaletteInitialMode('tags'); setCommandPaletteOpen(true); },
onMentionSearchOpen: () => { setCommandPaletteInitialMode('mentions'); setCommandPaletteOpen(true); },
onResearchSearchOpen: () => { setCommandPaletteInitialMode('research'); setCommandPaletteOpen(true); },
```

**Badge click handlers (lines \~180-207)**:Update `notesage:open-tag-search` and `notesage:open-mention-search` event handlers to set `initialMode` + `drilldown` instead of multiple booleans.

**onOpenChange handler (lines 943-953)**:Simplify to reset only `initialMode` and `drilldown` on close.

**CommandPalette JSX (lines 941-967)**:Pass simplified props: `initialMode`, `drilldownName`, `onOpenFileAtSymbol`.

**Acceptance criteria:**

- All 5 keyboard shortcuts open the palette in the correct mode
- Badge clicks drill into the correct tag/mention
- Closing palette resets all state
- No boolean state variables remain for palette mode

**Files:**

- Modify `src/App.tsx`

---

## Task 5: Simplify useKeyboardShortcuts callback interface ✅

**Complexity:** S | **Category:** frontend | **Dependencies:** #4

**Description**:The `KeyboardShortcutCallbacks` interface in `useKeyboardShortcuts.ts` can be simplified now that all search modes use the same pattern. This is optional cleanup.

**What to implement:**

- Evaluate if `onFileSearchOpen`, `onTagSearchOpen`, `onMentionSearchOpen`, `onResearchSearchOpen` can be replaced with a single `onPaletteOpen(mode: PaletteMode)` callback
- If the callbacks are thin enough (just set mode + open), this consolidation is clean
- If any callback has mode-specific logic, keep them separate

**Acceptance criteria:**

- Keyboard shortcuts still work identically
- Interface is simpler (fewer callback props if consolidation makes sense)
- No functional changes

**Files:**

- Modify `src/hooks/useKeyboardShortcuts.ts`

---

## Task 6: Add commands mode (&gt; prefix) ✅

**Complexity:** M | **Category:** frontend | **Dependencies:** #3

**Description**:Implement the `>` prefix commands mode — a filtered view of the existing Actions group.

**What to implement:**

- When mode is `commands`, render only the Actions `CommandGroup`
- Filter action items by the query (text after `>`)
- cmdk filtering disabled; use manual substring match on action `value` props
- Empty state: "No commands found."
- Placeholder: "Search commands..."

**Acceptance criteria:**

- Typing `>` shows all actions
- Typing `>new` filters to "New Note" and "New Project"
- Typing `>theme` shows "Toggle Theme"
- Selecting an action executes it and closes the palette
- Backspacing past `>` returns to default mode

**Files:**

- Modify `src/components/CommandPalette.tsx` (add commands case to switch)

---

## Task 7: Add footer mode hints ✅

**Complexity:** M | **Category:** frontend | **Dependencies:** #3

**Description**:Update the palette footer to show discoverable mode hints in default mode and a "back to search" hint in active modes.

**What to implement:**

**Default mode footer (right side):**

```
# tags   @ mentions   > commands   ? research
```

Each hint rendered as: prefix in `kbd` style + label in muted text. Separated by spacing.

**Active mode footer (right side):**

```
⌫ back to search
```

Shown when any prefix is active. Uses same `kbd` styling.

**Layout:**

- Left side: existing navigate/select/close hints (unchanged)
- Right side: mode hints or "back to search"
- Use `justify-between` (already in place)

**Styling:**

- Prefix characters (`#`, `@`, `>`, `?`) use the existing `kbd` class from the footer
- Labels use `text-muted-foreground text-xs`
- Consistent spacing with `gap-3` between hint groups

**Acceptance criteria:**

- Default mode shows all 4 mode hints right-aligned
- Any active mode shows "back to search" instead
- Hints styled consistently with existing kbd elements
- Both light and dark mode look correct
- Footer doesn't wrap or overflow at reasonable window widths

**Files:**

- Modify `src/components/CommandPalette.tsx` (footer section, lines \~743-756)