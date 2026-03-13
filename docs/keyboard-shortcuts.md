# Keyboard Shortcuts

All keyboard shortcuts use Cmd (⌘) on macOS.

## File Operations

| Action | Shortcut | Description |
| --- | --- | --- |
| Save | `Cmd+S` | Save current file to disk |
| Open file | `Cmd+O` | Open file picker dialog |
| Close tab | `Cmd+W` | Close active tab (warns if unsaved) |
| New note | `Cmd+N` | Open new note dialog |
| New project | `Cmd+Shift+N` | Open new project dialog |
| Export as PDF | `Cmd+Shift+E` | Open PDF export dialog (requires active file) |

## Editor Formatting

| Action | Shortcut | Description |
| --- | --- | --- |
| Bold | `Cmd+B` | Toggle bold on selection |
| Italic | `Cmd+I` | Toggle italic on selection |
| Underline | `Cmd+U` | Toggle underline on selection |
| Strikethrough | `Cmd+Shift+X` | Toggle strikethrough on selection |
| Code | `Cmd+E` | Toggle inline code on selection |
| Link | `Cmd+K` | Insert/edit link (when text is selected) |
| Indent list item | `Tab` | Nest list item deeper (also available via toolbar button) |
| Outdent list item | `Shift+Tab` | Lift list item one level (also available via toolbar button) |

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
| Undo | `Cmd+Z` | Undo last change |
| Redo | `Cmd+Shift+Z` | Redo last undone change |
| Find in document | `Cmd+F` | Open find bar (WYSIWYG) or CodeMirror search panel (source mode) |
| Find and replace | `Cmd+Shift+H` | Open find bar with replace row expanded |

## App Settings

| Action | Shortcut | Description |
| --- | --- | --- |
| Toggle theme | `Cmd+T` | Switch between light and dark mode |
| Open settings | `Cmd+,` | Open settings dialog |

## AI Features

| Action | Shortcut | Description |
| --- | --- | --- |
| Toggle chat panel | `Cmd+Shift+C` | Show/hide AI chat sidebar |
| Toggle agent panel | `Cmd+Shift+A` | Show/hide agent activity panel |
| Add comment | `Cmd+Shift+M` | Create inline comment on selected text |
| Accept suggestion | `Cmd+Enter` | Accept AI inline suggestion (when decoration visible) |
| Reject suggestion | `Cmd+Backspace` | Reject AI inline suggestion (when decoration visible) |
| Toggle recording | `Cmd+Shift+R` | Start/stop meeting recording |

## Tab Navigation

| Action | Shortcut | Description |
| --- | --- | --- |
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
| `/code` | Code block | Insert code block |
| `/quote` | Blockquote | Insert blockquote |
| `/table` | Table | Insert table |
| `/hr` | Horizontal rule | Insert horizontal divider |
| `/image` | Image | Insert image |

## App Navigation

| Action | Shortcut | Description |
| --- | --- | --- |
| Command palette | `Cmd+K` | Open command palette (when no text selected) |
| Search files | `Cmd+Shift+F` | Open command palette in file search mode |
| Toggle sidebar | `Cmd+Shift+L` | Show/hide file sidebar |
| Focus mode | `Cmd+.` | Toggle distraction-free focus mode |
| Mention search | `Cmd+2` | Search for @mentions across all files (or type `@` in palette) |
| Tag search | `Cmd+3` | Search for #tags across all files (or type `#` in palette) |
| Research search | `Cmd+4` | Search research files across all projects (or type `?` in palette) |
| Open actions | `Cmd+5` | Open actions dashboard |
| Document outline | `Cmd+Shift+O` | Open document outline (requires active file) |
| Keyboard shortcuts | `Cmd+7` | Show keyboard shortcuts reference |
| Exit focus mode | `Esc` | Exit focus mode (when active) |

### Command Palette Prefix Modes

Type a prefix character as the first character in the command palette input to switch modes:

| Prefix | Mode | Description |
| --- | --- | --- |
| `#` | Tags | Search for #tags across all files |
| `@` | Mentions | Search for @mentions across all files |
| `>` | Commands | Filter actions (New Note, Toggle Theme, etc.) |
| `?` | Research | Search research files across all projects |

Backspacing past a prefix character returns to the default (files + actions) mode.

## Future Shortcuts (Planned)

No shortcuts are currently planned but not yet implemented.

## Implementation Notes

### Shortcut Priority

When multiple shortcuts could apply, priority is:

1. Editor-specific shortcuts (formatting, slash commands)
2. App-level shortcuts (save, open, settings)
3. System shortcuts (copy, paste, etc.)

### Conflicts

- Avoid conflicting with system shortcuts (Cmd+Q quit, Cmd+H hide, etc.)
- Avoid conflicting with browser shortcuts if running in web view
- Document any intentional overrides

### Cross-platform

Currently targeting macOS:

- `Cmd` (⌘) is used for all shortcuts
- Windows/Linux support would use `Ctrl` instead
- Use `Mod` key in code to support both: `Mod+S` maps to `Cmd+S` on Mac, `Ctrl+S` on Windows

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