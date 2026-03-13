# Command Palette & Search Patterns in Desktop Apps

Research into how premium desktop apps handle command palettes, search modes, and discoverability — conducted to inform the unified command palette refactor (PRD: `docs/prds/2026-03-12-unified-command-palette.md`).

## Current Notesage Architecture

The `CommandPalette` component (760 lines) serves 5 search modes through a single component controlled by 7 boolean state variables in `App.tsx`:

| Mode | Shortcut | State flags set |
|------|----------|----------------|
| General (files + actions) | Cmd+K | `open` |
| File content search | Cmd+Shift+F | `open`, `filesOnly` |
| Tag search | Cmd+3 | `open`, `filesOnly`, `tagSearchMode` |
| Mention search | Cmd+2 | `open`, `filesOnly`, `mentionSearchMode` |
| Research search | Cmd+4 | `open`, `filesOnly`, `researchSearchMode` |

**Strengths:**
- Single component, no duplicate UI code
- Tags and mentions follow an identical two-level pattern (list → occurrences)
- Background tag/mention scanning for instant filtering
- Dedicated shortcuts that feel natural

**Weaknesses:**
- 7 boolean states that must be coordinated (fragile)
- Tags and mentions are copy-paste twins (~200 lines duplicated)
- No discoverability — users must memorize 5 shortcuts
- 760-line component with growing conditional complexity

## App-by-App Research

### VS Code — The Gold Standard for Prefix-Based Mode Switching

VS Code uses a **single unified input** (`Cmd+P`) with prefix characters that switch modes:

| Prefix | Mode | Shortcut |
|--------|------|----------|
| *(none)* | File search (Quick Open) | `Cmd+P` |
| `>` | Command search | `Cmd+Shift+P` |
| `@` | Symbol search (current file) | `Cmd+Shift+O` |
| `#` | Symbol search (workspace-wide) | `Cmd+T` |
| `:` | Go to line | `Ctrl+G` |

Each mode also has a dedicated keyboard shortcut that opens the palette pre-filled with the prefix. This is the most influential pattern in the space — nearly every code editor and many productivity apps have adopted some variant of it.

**Key insight:** One input, many modes, discoverable via typing. Dedicated shortcuts are just aliases that pre-fill the prefix.

### Linear — Context-Dependent Command Menu with Letter Prefixes

Linear's `Cmd+K` opens a **context-aware command menu** that combines search and actions. Its prefix system uses **single letters followed by a space**:

| Prefix | Filters to |
|--------|-----------|
| `i ` | Issues |
| `p ` | Projects |
| `u ` | Users |
| `t ` | Teams |
| `l ` | Labels |
| `f ` | Favorites |
| `d ` | Documents |

The menu adapts to context — if you're viewing Cycles, cycle-related commands appear first. This is a **lighter-weight prefix system** than VS Code's, using natural letter abbreviations rather than special characters.

### Obsidian — Separate Palettes, Unified by Plugins

Obsidian ships with **two separate built-in interfaces**:
- **Command Palette** (`Cmd+P`): runs commands/actions
- **Quick Switcher** (`Cmd+O`): opens files by name
- **Global Search** (`Cmd+Shift+F`): full-text search with operators (`tag:`, `path:`, `file:`, `line:`, `section:`)

The built-in separation has been a pain point. The community **Better Command Palette** plugin unifies them with VS Code-style prefixes:
- Default: file search
- `>`: commands
- `#`: tag search (then drill down into files containing that tag)

**Key insight:** Users *want* a unified palette — the most popular plugin adds it. Confirms that splitting into separate components is the wrong direction.

### Notion — Quick Search + Full Search (Two-Tier)

Notion uses a **two-tier search architecture**:
- **Quick Search** (`Cmd+K` or `Cmd+P`): lightweight popup showing recent pages, inline results as you type
- **Full Search** (click through from quick search): full-page experience with filters by source, title, author, date

The quick search is the primary interaction — it shows recent pages immediately (zero-query state) and transitions to search results as you type. The full search is a drill-down for power users who need advanced filtering.

**Key insight:** Zero-query state (what appears before typing) matters a lot. Notion shows recent pages; Raycast shows pinned items; Linear shows contextual commands.

### Raycast — Extension-Based Search with Implicit Ranking

Raycast replaces macOS Spotlight with a **single search bar** that unifies:
- App launching, file search, extension commands, calculator, clipboard history, snippets, etc.

Key patterns:
- **No explicit prefix modes** — instead, search results are ranked across all categories simultaneously
- **Fallback commands**: when no results match, customizable fallback actions appear
- **Action Panel** (`Cmd+K` within results): context-sensitive actions on any search result

**Key insight:** Implicit mode switching through result ranking rather than explicit prefixes. Works well for Raycast's breadth, but requires sophisticated ranking that's hard to get right. Not ideal for our use case where search types are distinct.

### Bear — Quick Open with `#` and `@` Prefixes

Bear's **Quick Open** (`Cmd+O`) is a lightweight palette with prefix-based filtering:
- Default: search notes by title/content
- `#`: search tags (with nested tag support like `#journal/2025`)
- `@`: jump to sidebar sections (`@today`, `@untagged`, `@archive`)

**Key insight:** Prefixes map naturally to Bear's data model — `#` is already tag syntax in notes, `@` for navigation. This is directly applicable to Notesage where `#tags` and `@mentions` already use these characters.

### Craft — Simple Search (No Command Palette)

Craft uses a straightforward **search bar** in the sidebar for finding documents. No command palette with mode switching. Search is content-focused, not action-focused.

## Key Patterns

### Pattern 1: Single Unified Input with Prefix Modes
**Used by:** VS Code, Bear, Linear, Obsidian (via plugin)

The strongest pattern across premium apps. One input field, mode determined by prefix character. Benefits:
- Discoverable (users can see the prefix hint)
- Muscle memory friendly (dedicated shortcuts open with prefix pre-filled)
- Reduces cognitive load (one place to go for everything)

### Pattern 2: Zero-Query State Matters
**Used by:** Notion, Raycast, Linear

What appears **before the user types anything** is critical:
- Notion shows recent pages
- Raycast shows pinned/frequent items
- Linear shows contextual commands

This makes the palette feel useful immediately, not just after typing.

### Pattern 3: Drill-Down from List to Occurrences
**Used by:** Bear, Obsidian, Notesage (current)

For tags and symbols, the best pattern is **two-level**: first show matching tags/symbols, then drill into occurrences within files. Notesage already implements this well.

### Pattern 4: Context-Sensitive Results
**Used by:** Linear, Raycast

The palette adapts based on where you are in the app. Linear shows cycle commands when viewing cycles. Lower priority for Notesage's simpler context model.

### Pattern 5: Dedicated Shortcuts as Aliases
**Used by:** VS Code, Notesage (current)

Each mode has both a prefix **and** a dedicated shortcut. `Cmd+Shift+P` is just `Cmd+P` with `>` pre-filled. Both should work — prefixes for discovery, shortcuts for speed.

## Recommendations (Applied)

These recommendations were incorporated into the PRD:

1. **Prefix-based mode switching** — `#` tags, `@` mentions, `>` commands, `?` research. Matches the syntax users already know from the editor.

2. **Keep features separate, not "search everything"** — Each prefix is a distinct mode. Don't try Raycast-style cross-category ranking — it's a hard UX problem and our search types are too different.

3. **Unify tag and mention internals** — Same store shape, same UI pattern, same occurrence format. One parameterized component instead of two copy-pasted implementations.

4. **Add zero-query mode hints** in the footer — `# tags  @ mentions  > commands  ? research`. Makes modes discoverable without documentation.

5. **Replace boolean states with mode enum** — Derived from input prefix. Scales to new modes without adding more booleans.

6. **Keep dedicated shortcuts** — Cmd+3 for tags is faster than Cmd+K then `#`. Both coexist.

## Sources

- VS Code User Interface docs, Tips & Tricks, Keyboard Shortcuts (macOS PDF)
- Linear Search Docs, Linear Shortcuts
- Obsidian Search Help, Better Command Palette plugin
- Notion Search Help
- Raycast Manual, Fallback Commands changelog
- Bear Quick Open announcement, Tag Search FAQ
- Command Palette UX Patterns (Medium, Philip Davis)
- Zed discussion: VS Code-style prefix modes
