# Keyboard Shortcuts

All shortcuts use Cmd (⌘) on macOS. Glyph notation: ⌘ Command · ⌥ Option · ⇧ Shift · ⌃ Control.

## File Operations

| Action | Shortcut | Description |
| --- | --- | --- |
| Save | `⌘S` | Save current file to disk |
| Open folder | `⌘O` | Open native folder-picker dialog (loads selected folder as Explorer / project) |
| Close active document | `⌘W` | Close the active document (warns if unsaved). Internally still called "tab" — see Implementation Notes |
| New note | `⌘N` | Opens an inline-create row in the active project (no dialog) |
| New project | `⌘⇧N` | Opens an inline-create row in the Projects section (no dialog) |
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
| Increase text zoom | `⌘+` (`⌘=`) | Increase the editor's transient view-zoom by 10% per press (max 2×). Session-only — does NOT change the persisted font-size preference. |
| Decrease text zoom | `⌘-` | Decrease the editor's view-zoom by 10% per press (min 0.5×). |
| Reset text zoom | `⌘0` | Reset the editor's view-zoom to 1.0 (no zoom). |

## App Settings

| Action | Shortcut | Description |
| --- | --- | --- |
| Toggle theme | `⌘T` | Switch between light and dark mode |
| Open settings | `⌘,` | Open settings dialog |

## AI Features

| Action | Shortcut | Description |
| --- | --- | --- |
| Summon command bar | `⌘⇧C` | Focuses the FloatingCommandBar when collapsed (third summon path alongside `⌘K` and double-tap `⌘`); when the bar is already expanded+pinned, unpins it back to floating; otherwise no-op (use `Esc` to collapse) |
| Toggle agent orb | `⌘⇧A` | Open/close the `AgentOrb` popover (the orb IS the agent panel) |
| Add comment | `⌘⇧M` | Create inline comment on selected text. **Wired through Tiptap, not through `useKeyboardShortcuts`** — see Implementation Notes |
| Accept suggestion | `⌘Enter` | Accept AI inline suggestion (when decoration visible) |
| Reject suggestion | `⌘Backspace` | Reject AI inline suggestion (when decoration visible) |
| Toggle meeting recording | `⌘⇧R` | Start/stop meeting recording (capture audio → background transcription on stop) |

## Document Navigation

| Action | Shortcut | Description |
| --- | --- | --- |
| Previous Recent doc | `⌃⇧Tab` | Cycle backward through MRU document history (mirrors VS Code's MRU-cycle convention; works in both shells) |
| Next Recent doc | `⌃Tab` | Cycle forward through MRU document history |

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
| Command palette / Command bar | `⌘K` | `⌘K` | Focus the `FloatingCommandBar` |
| Summon command bar (alternate) | Double-tap `⌘` | — | Quiet Composer only — within 300 ms; alternate path to summon (no chord) |
| Summon command bar (third path) | `⌘⇧C` | `⌘⇧C` | Focus the bar when collapsed; unpin when expanded+pinned (see AI Features) |
| Find files | `⌘⇧F` | `⌘⇧F` | Classic: opens command palette in file-search mode. Quiet Composer: focuses the command bar with the `:file ` verb prefix → FileMode (filename search backed by the SQLite document index). PRD `2026-04-28-cmd-bar-verb-prefixes`. |
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

The command bar prefix grammar splits into two namespaces (PRD `2026-04-28-cmd-bar-verb-prefixes`):

- **Single-character prefixes — noun pickers.** Type the prefix as the first character of the input (or after whitespace) to enter the picker.
- **`:` + multi-char name — verb commands.** Type `:` then the verb name (e.g., `:file `) to enter the verb's picker. Bare `:` opens a discovery menu listing every registered verb. `Tab` autocompletes the verb name (longest unambiguous prefix; full match adds a trailing space and jumps the cursor into the filter slot).

Single-char prefixes win when both could match. Backspacing past the prefix returns to default chat-mode.

| Namespace | Prefix | Mode | Description |
| --- | --- | --- | --- |
| Noun | `!` | Tasks | Quiet Composer command-bar TaskMode (open / attach a task) |
| Noun | `#` | Tags | Search for #tags across all files |
| Noun | `@` | References | Open ReferenceMode — search for @mentions, files, comments |
| Noun | `>` | Commands | Filter actions (New Note, Toggle Theme, etc.) |
| Noun | `?` | Research | Search research files across all projects |
| Noun | `/` | Skills | Quiet Composer command-bar SkillMode |
| Verb | `:file <query>` | FileMode | Filename search across the active chat scope. Empty query lists MRU files. Reserves `⌘⇧F` as the chord seed. |

Backspacing past a prefix character returns to the default (files + actions) mode.

## Future Shortcuts (Planned but unshipped)

_None at the moment — the previous file-search and Quick Capture entries have been resolved. File-search ships as the `:file` verb mode in PRD `2026-04-28-cmd-bar-verb-prefixes`. Quick Capture was removed (see "Removed Shortcuts" below)._

## Removed Shortcuts

- **`⌘⇧Space` Quick capture** — never shipped (no global-shortcut plugin, no separate window). Decision: removed end-to-end rather than deferred. The PaletteMode entry, the in-app `quick-capture` palette routing, and the System Tray phase claim were all deleted in PRD `2026-04-28-cmd-bar-verb-prefixes`.
- **Preview HTML** — the inline HTML Preview viewer (formerly `⌘⇧P`) was removed in the M1.5 round of the UI Refresh PRD (`docs/prds/2026-04-21-ui-refresh.md`, "Preview as HTML"). Native HTML rendering with JavaScript is deferred to a separate PRD. The chord `⌘⇧P` was reassigned to the commands-palette (`>`) — see App Navigation.

## Implementation Notes

### Owner table (Quiet Composer vs Legacy)

The single keyboard hook (`src/hooks/useKeyboardShortcuts.ts`) owns most app-level chords. It composes `useCommandBarShortcuts` (which routes ⌘K / ⌘1–⌘4 / ⌘⇧P / ⌘⇧F to the `FloatingCommandBar`) and `useDoubleTapCmd` (the double-tap `⌘` summon path). ⌘N / ⌘⇧N are owned by `QuietLayout` at capture phase (`stopImmediatePropagation`) so they preempt other listeners. ⌘. (focus mode) is owned by `useFocusMode` at capture phase. Some chords (`⌘S`, `⌘⇧M`) are NOT in this hook — `⌘S` is owned by `Editor.tsx` / `CodeEditor.tsx` so markdown and code-file save paths can diverge; `⌘⇧M` is wired through Tiptap's keymap on the comment mark.

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

### Cross-keyboard layout safety

`KeyboardEvent.key` reports the **produced character** for a keystroke, which depends on the user's keyboard layout. `KeyboardEvent.code` reports the **physical key position** and is layout-independent. For chords using punctuation, ALWAYS check `event.code` alongside `event.key`.

**Examples of the trap:**

- `event.key === "["` for `⌘⇧[` works on US keyboards. Swedish (and many European) layouts produce `[` only via `⌥8`, so the chord never registers — `event.key` reports something like `Å` instead.
- `event.key === ","` for `⌘⇧,` works on US. Swedish `Shift+,` produces `;`, not `,`, so the chord misses.
- `event.key === "/"` for `⌘/` works on US. Nordic layouts produce `/` only via `Shift+7`, so plain `Cmd+/` would need `event.code === "Slash"` OR `event.shiftKey && event.code === "Digit7"` (the editor's view-mode chord at `useEditorKeyBindings.ts:82-94` already handles both).

**The rule:**

Any chord using a punctuation key (`,`, `.`, `[`, `]`, `;`, `'`, `\`, `/`, `-`, `=`, etc.) must accept BOTH `event.key === "<char>"` AND `event.code === "<KeyCodeName>"`. The OR keeps the chord layout-tolerant — neither check fights the other. Reference patterns:

- `src/components/sidebar/quiet/useSidebarItemShortcuts.ts` (`isContextMenuKey`) — `Comma` fallback
- `src/hooks/useKeyboardShortcuts.ts` — `BracketLeft` / `BracketRight`, `Comma`, `Period` fallbacks
- `src/hooks/useFocusMode.ts` — `Period` fallback
- `src/hooks/useEditorKeyBindings.ts` — `Slash` + Nordic `Shift+Digit7` pattern

**KeyCodeName quick reference:** `,` → `"Comma"`, `.` → `"Period"`, `[` → `"BracketLeft"`, `]` → `"BracketRight"`, `;` → `"Semicolon"`, `'` → `"Quote"`, `\` → `"Backslash"`, `/` → `"Slash"`, `-` → `"Minus"`, `=` → `"Equal"`.

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