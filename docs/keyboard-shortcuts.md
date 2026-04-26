# Keyboard Shortcuts

All shortcuts use Cmd (⌘) on macOS. Glyph notation: ⌘ Command · ⌥ Option · ⇧ Shift · ⌃ Control.

## File Operations

| Action | Shortcut | Description |
| --- | --- | --- |
| Save | `⌘S` | Save current file to disk |
| Open file | `⌘O` | Open file picker dialog |
| Close tab | `⌘W` | Close active tab (warns if unsaved) |
| New note | `⌘N` | Open new note dialog (Quiet Composer: opens inline-create row in sidebar) |
| New project | `⌘⇧N` | Open new project dialog (Quiet Composer: opens inline-create row in Projects section) |
| Export as PDF | `⌘⇧E` | Open PDF export dialog (Layout) — also see App Navigation: in Quiet Composer this chord opens the TreeOverlay instead |

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
| Toggle chat panel | `⌘⇧C` | Legacy: show/hide AI chat sidebar. Quiet Composer: expand the command bar (the command bar IS the chat); press again while pinned to unpin back to the floating overlay |
| Toggle agent panel | `⌘⇧A` | Legacy: show/hide agent activity panel. Quiet Composer: toggle the AgentOrb popover (the orb IS the agent panel) |
| Add comment | `⌘⇧M` | Create inline comment on selected text |
| Accept suggestion | `⌘Enter` | Accept AI inline suggestion (when decoration visible) |
| Reject suggestion | `⌘Backspace` | Reject AI inline suggestion (when decoration visible) |
| Toggle recording | `⌘⇧R` | Start/stop meeting recording |
| Quick capture | `⌘⇧Space` | Open quick capture window (global shortcut — works even when app is hidden) |

## Tab Navigation

| Action | Shortcut | Description |
| --- | --- | --- |
| Previous Recent doc | `⌘⇧[` | Cycle backward through MRU document history |
| Next Recent doc | `⌘⇧]` | Cycle forward through MRU document history |
| Middle-click tab | Mouse middle button | Close tab |

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

| Action | Shortcut | Description |
| --- | --- | --- |
| Command palette / Command bar | `⌘K` | Legacy: open CommandPalette. Quiet Composer: focus the FloatingCommandBar |
| Double-tap `⌘` | Within 300 ms | Quiet Composer only — alternate path to summon the command bar (no chord) |
| Search files | `⌘⇧F` | Legacy: command palette in file-search mode. Quiet Composer: focus command bar (no prefix — type to file-search) |
| Toggle sidebar | `⌘⇧L` | Show/hide file sidebar |
| Focus mode | `⌘.` | Toggle distraction-free focus mode |
| Open actions | `⌘1` / `⌘⇧1` | Legacy: open actions dashboard. Quiet Composer: focus command bar with `!` prefix |
| Mention search | `⌘2` / `⌘⇧2` | Legacy: command palette in mentions mode. Quiet Composer: focus command bar with `@` prefix |
| Tag search | `⌘3` / `⌘⇧3` | Legacy: command palette in tags mode. Quiet Composer: focus command bar with `#` prefix |
| Research search | `⌘4` / `⌘⇧4` | Legacy: command palette in research mode. Quiet Composer: focus command bar with `?` prefix |
| Commands palette | `⌘⇧P` | Legacy: command palette in `>` (commands) mode. Quiet Composer: focus command bar with `>` prefix |
| TreeOverlay | `⌘⇧E` | Quiet Composer only — open the slide-in workspace tree overlay (capture-phase preempts the legacy Export-as-PDF binding) |
| Document outline | `⌘⇧O` | Open document outline (requires active file) |
| Keyboard shortcuts | `⌘⇧K` | Show keyboard shortcuts reference |
| Copy path | `⌘⌥C` | Copy the active document's absolute path to the clipboard. Also fires the `notesage:copy-path` event |
| Reveal in Finder | `⌘⌥R` | Reveal the active document in Finder. Also fires the `notesage:reveal-in-finder` event |
| Open Tauri devtools | `⌘⌥I` | Open the Tauri WebView devtools |
| Exit focus mode | `Esc` | Exit focus mode (when active) |

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

## Future Shortcuts (Planned)

No shortcuts are currently planned but not yet implemented.

## Removed Shortcuts

- `⌘⇧P` (Preview HTML) — the inline HTML Preview viewer was removed in the M1.5 round of the UI Refresh PRD (`docs/prds/2026-04-21-ui-refresh.md`, "Preview as HTML"). Native HTML rendering with JavaScript is deferred to a separate PRD. The chord `⌘⇧P` is now bound to the commands-palette `>` prefix (see App Navigation).

## Implementation Notes

### Owner table (Quiet Composer vs Legacy)

The single keyboard hook (`src/hooks/useKeyboardShortcuts.ts`) maintains an authoritative table of which component owns each chord under the Quiet Composer preview vs Legacy Layout. Read that JSDoc table before changing a binding — the preview branch routes ⌘K / ⌘1–⌘4 / ⌘⇧P / ⌘⇧F to the FloatingCommandBar (`useCommandBarShortcuts`), while ⌘⇧E / ⌘N / ⌘⇧N are owned by `QuietLayout` at capture phase (`stopImmediatePropagation`) so they preempt the legacy listeners.

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