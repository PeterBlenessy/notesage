# Keyboard Shortcuts

All shortcuts use Cmd (⌘) on macOS. Glyph notation: ⌘ Command · ⌥ Option · ⇧ Shift · ⌃ Control.

## File Operations

| Action | Shortcut | Description |
| --- | --- | --- |
| Save | `⌘S` | Save current file to disk |
| Open folder | `⌘O` | Open native folder-picker dialog (loads selected folder as Explorer / project) |
| Close active document | `⌘W` | Close the active document (warns if unsaved). Internally still called "tab" — see Implementation Notes |
| New note | `⌘N` | Classic Layout: opens new-note dialog. Quiet Composer: opens inline-create row in the active project (no dialog) |
| New project | `⌘⇧N` | Classic Layout: opens new-project dialog. Quiet Composer: opens inline-create row in the Projects section (no dialog) |
| Export | `⌘⇧E` | Open Export dialog (multi-format: PDF / DOCX / PPTX / HTML). Works in both shells since sidebar #20 deleted TreeOverlay (which used to preempt the chord under Quiet Composer). |

## Editor Formatting

| Action | Shortcut | Description |
| --- | --- | --- |
| Bold | `⌘B` | Toggle bold on selection |
| Italic | `⌘I` | Toggle italic on selection |
| Underline | `⌘U` | Toggle underline on selection |
| Strikethrough | `⌘⇧X` | Toggle strikethrough on selection |
| Code | `⌘E` | Toggle inline code on selection |
| Indent list item | `Tab` | Nest list item deeper (also available via toolbar button) |
| Outdent list item | `⇧Tab` | Lift list item one level (also available via toolbar button) |

## Toolbar Controls (Mouse)

| Control | Location | Description |
| --- | --- | --- |
| Heading picker | Toolbar (leftmost) | Dropdown to switch between Paragraph and Heading 1–6 |
| Text color | Toolbar (after Code) | Popover with 8-color palette for text color |
| Highlight | Toolbar (after Text color) | Popover with 6-color palette for background highlight |
| Align left/center/right | Toolbar (after HR) | Set text alignment for headings and paragraphs |
| Indent/Outdent | Toolbar (after Task list) | Nest/lift list items (disabled outside lists) |
| Table toolbar | Floating (above table) | Appears when cursor is in a table — row/column add/remove, merge/split, header toggle, delete |
| ~~Block drag handle~~ | ~~Left gutter (on hover)~~ | ~~Deferred — needs unified gutter design~~ |
| ~~Item annotation~~ | ~~Left margin of list items~~ | ~~Deferred — needs unified gutter design~~ |

## Editor Navigation

| Action | Shortcut | Description |
| --- | --- | --- |
| Undo | `⌘Z` | Undo last change |
| Redo | `⌘⇧Z` | Redo last undone change |
| Find in document | `⌘F` | Open find bar (WYSIWYG) or CodeMirror search panel (source mode) |
| Find and replace | `⌘⇧H` | Open find bar with replace row expanded |
| Paste as plain text | `⌘⇧V` | Insert clipboard text literally — bypasses markdown parser and paste rules. Useful for prose containing `~text~`, `*foo*`, `_bar_`, or backticks that should NOT be parsed. |

## App Settings

| Action | Shortcut | Description |
| --- | --- | --- |
| Toggle theme | `⌘T` | Switch between light and dark mode |
| Open settings | `⌘,` | Open settings dialog |

## AI Features

| Action | Shortcut | Description |
| --- | --- | --- |
| Toggle chat panel | `⌘⇧C` | Classic: show/hide AI chat sidebar. Quiet Composer: focuses the FloatingCommandBar when collapsed (third summon path alongside `⌘K` and double-tap `⌘`); when the bar is already expanded+pinned, unpins it back to floating; otherwise no-op (use `Esc` to collapse) |
| Toggle agent panel | `⌘⇧A` | Classic: show/hide agent activity panel. Quiet Composer: toggle the `AgentOrb` popover (the orb IS the agent panel) |
| Add comment | `⌘⇧M` | Create inline comment on selected text. **Wired through Tiptap, not through `useKeyboardShortcuts`** — see Implementation Notes |
| Accept suggestion | `⌘Enter` | Accept AI inline suggestion (when decoration visible) |
| Reject suggestion | `⌘Backspace` | Reject AI inline suggestion (when decoration visible) |
| Toggle recording | `⌘⇧R` | Start/stop meeting recording |

## Document Navigation

| Action | Shortcut | Description |
| --- | --- | --- |
| Previous Recent doc | `⌘⇧[` | Cycle backward through MRU document history (works in both shells; live since task #77) |
| Next Recent doc | `⌘⇧]` | Cycle forward through MRU document history |
| Middle-click tab | Mouse middle button | Close document — Classic Layout only (Quiet Composer has no tab strip) |

## Slash Commands

| Command | Result | Description |
| --- | --- | --- |
| `/` | Show menu | Trigger slash command menu |
| `/h1` | Heading 1 | Insert level 1 heading |
| `/h2` | Heading 2 | Insert level 2 heading |
| `/h3` | Heading 3 | Insert level 3 heading |
| `/ul` | Bullet list | Insert bullet list |
| `/ol` | Numbered list | Insert numbered list |
| `/todo` | Task list | Insert task list with checkboxes |
| `/callout` | Callout | Insert callout block (Note, Tip, Warning, Important) |
| `/code` | Code block | Insert code block |
| `/quote` | Blockquote | Insert blockquote |
| `/table` | Table | Insert table |
| `/hr` | Horizontal rule | Insert horizontal divider |
| `/image` | Image | Insert image |
| `/drawing` | Drawing | Insert Excalidraw drawing |
| `/embed` | Link preview | Embed a link preview card |

## App Navigation

Three independent ways to summon the FloatingCommandBar in Quiet Composer: `⌘K`, double-tap `⌘`, and `⌘⇧C` (when collapsed).

| Action | Press (chord) | Glyph form (display) | Description |
| --- | --- | --- | --- |
| Command palette / Command bar | `⌘K` | `⌘K` | Classic: open `CommandPalette`. Quiet Composer: focus the `FloatingCommandBar` |
| Summon command bar (alternate) | Double-tap `⌘` | — | Quiet Composer only — within 300 ms; alternate path to summon (no chord) |
| Summon command bar (third path) | `⌘⇧C` | `⌘⇧C` | Classic: toggle ChatPanel. Quiet Composer: focus the bar when collapsed; unpin when expanded+pinned (see AI Features) |
| Find files | `⌘⇧F` | `⌘⇧F` | Classic: opens command palette in file-search mode. **Quiet Composer (current behaviour): focuses the command bar with no prefix — typing goes to chat input, NOT file search.** There is no dedicated "files" prefix in the Quiet Composer cmd bar today. To find a file: open the bar with `⌘K`, then type the filename in chat-mode (no result list yet) — or arrow-into a project + `→` to inline-expand its contents. Sidebar #15's persistent search input + SQLite FTS results will land this for real |
| Toggle sidebar | `⌘⇧L` | `⌘⇧L` | Toggle the sidebar pin (`settings.sidebarPinned`). Internally calls `setSidebarPinned`; user-facing label is "show/hide" |
| Focus mode | `⌘.` | `⌘.` | Toggle distraction-free focus mode |
| Open Tasks | `⌘1` / `⌘⇧1` | `⌘!` | Classic: opens Actions dashboard. Quiet Composer: focuses the command bar with `!` prefix → TaskMode |
| References (was Mentions) | `⌘2` / `⌘⇧2` | `⌘@` | Classic: command palette in mentions mode. Quiet Composer: focuses the command bar with `@` prefix → ReferenceMode (files / people / comments) |
| Tags | `⌘3` / `⌘⇧3` | `⌘#` | Classic: command palette in tags mode. Quiet Composer: focuses the command bar with `#` prefix → TagMode |
| Research | `⌘4` / `⌘⇧4` | `⌘?` | Classic: command palette in research mode. Quiet Composer: focuses the command bar with `?` prefix → ResearchMode |
| Commands palette | `⌘⇧P` | `⌘⇧P` | Classic: command palette in `>` (commands) mode. Quiet Composer: focuses the command bar with `>` prefix → PaletteMode |
| ~~Tree overlay~~ | ~~`⌘⇧E`~~ | ~~`⌘⇧E`~~ | **REMOVED in sidebar-simplification task #20.** TreeOverlay deleted; the in-sidebar inline-expand pattern (`→` on a project / folder) replaces it. `⌘⇧E` reclaimed by Export above. |
| Document outline | `⌘⇧O` | `⌘⇧O` | Open document outline (requires active file). Currently uses a legacy modal `Dialog` — has not been migrated to a Quiet Composer popover |
| Keyboard shortcuts | `⌘⇧K` | `⌘⇧K` | Show keyboard shortcuts reference |
| Copy path | `⌘⌥C` | `⌘⌥C` | Copy the active document's absolute path to the clipboard |
| Reveal in Finder | `⌘⌥R` | `⌘⌥R` | Reveal the active document in Finder |
| Open Tauri devtools | `⌘⌥I` | `⌘⌥I` | Open the Tauri WebView devtools |
| Exit focus mode | `Esc` | `Esc` | Exit focus mode (when active). Falls through if a popover, command bar, or inline edit is open first |

### Command Palette Prefix Modes

Type a prefix character as the first character in the command palette / command bar input to switch modes:

| Prefix | Mode | Description |
| --- | --- | --- |
| `!` | Tasks | Quiet Composer command-bar TaskMode (open / attach a task) |
| `#` | Tags | Search for #tags across all files |
| `@` | Mentions / References | Search for @mentions (legacy palette) or open ReferenceMode (Quiet Composer) |
| `>` | Commands | Filter actions (New Note, Toggle Theme, etc.) |
| `?` | Research | Search research files across all projects |
| `/` | Skills | Quiet Composer command-bar SkillMode |

Backspacing past a prefix character returns to the default (files + actions) mode.

## Future Shortcuts (Planned but unshipped)

_None at the moment — the previous file-search and Quick Capture entries have been resolved. File-search ships as the `:file` verb mode in PRD `2026-04-28-cmd-bar-verb-prefixes`. Quick Capture was removed (see "Removed Shortcuts" below)._

## Removed Shortcuts

- **`⌘⇧Space` Quick capture** — never shipped (no global-shortcut plugin, no separate window). Decision: removed end-to-end rather than deferred. The PaletteMode entry, the in-app `quick-capture` palette routing, and the System Tray phase claim were all deleted in PRD `2026-04-28-cmd-bar-verb-prefixes`.
- **Preview HTML** — the inline HTML Preview viewer (formerly `⌘⇧P`) was removed in the M1.5 round of the UI Refresh PRD (`docs/prds/2026-04-21-ui-refresh.md`, "Preview as HTML"). Native HTML rendering with JavaScript is deferred to a separate PRD. The chord `⌘⇧P` was reassigned to the commands-palette (`>`) — see App Navigation.

## Implementation Notes

### Owner table (Quiet Composer vs Legacy)

The single keyboard hook (`src/hooks/useKeyboardShortcuts.ts`) maintains an authoritative table of which component owns each chord under the Quiet Composer preview vs Classic Layout. Read that JSDoc table before changing a binding — the preview branch routes ⌘K / ⌘1–⌘4 / ⌘⇧P / ⌘⇧F to the `FloatingCommandBar` (`useCommandBarShortcuts`), while ⌘N / ⌘⇧N are owned by `QuietLayout` at capture phase (`stopImmediatePropagation`) so they preempt the legacy listeners. ⌘⇧E was previously a QuietLayout capture-phase chord (TreeOverlay) but was reclaimed by Export in sidebar-simplification #22 once TreeOverlay was deleted. `⌘.` (focus mode) is owned by `useFocusMode` at capture phase and the double-tap `⌘` summon path lives in `useDoubleTapCmd`. Some chords (`⌘S`, `⌘⇧M`) are NOT in this hook — `⌘S` is owned by `Editor.tsx` / `CodeEditor.tsx` so markdown and code-file save paths can diverge; `⌘⇧M` is wired through Tiptap's keymap on the comment mark.

### Shortcut Priority

When multiple shortcuts could apply, priority is:

1. Editor-specific shortcuts (formatting, slash commands)
2. App-level shortcuts (save, open, settings)
3. System shortcuts (copy, paste, etc.)

### Conflicts

- Avoid conflicting with system shortcuts (`⌘Q` quit, `⌘H` hide, etc.)
- Avoid conflicting with browser shortcuts if running in web view
- Document any intentional overrides (e.g., `⌘⇧E` in Quiet Composer overrides the legacy Export-as-PDF chord)

### Cross-platform

Currently targeting macOS:

- `⌘` (Cmd) is used for all shortcuts
- Windows/Linux support would use `Ctrl` instead
- Use `Mod` key in code to support both: `Mod+S` maps to `⌘S` on Mac, `Ctrl+S` on Windows
- Double-tap `⌘` is mac-only — Windows/Linux equivalent (Super, Ctrl) is not yet wired

### Accessibility

- All shortcuts should have menu equivalents
- Display shortcuts in tooltips and context menus
- Allow users to customize shortcuts (future feature)

### Testing

Shortcuts to test in both light and dark mode:

- All formatting shortcuts should work on selected text
- All file operations should show appropriate dialogs/confirmations
- Theme toggle should smoothly transition between modes
- AI shortcuts should only work when AI features are configured