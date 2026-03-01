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
| Toggle chat panel | `Cmd+Shift+A` | Show/hide AI chat sidebar |
| Toggle activity strip | `Cmd+Shift+T` | Show/hide agent activity strip |
| Add comment | `Cmd+Shift+M` | Create inline comment on selected text |
| Accept suggestion | `Cmd+Enter` | Accept AI inline suggestion (when decoration visible) |
| Reject suggestion | `Cmd+Backspace` | Reject AI inline suggestion (when decoration visible) |

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
| Toggle sidebar | `Cmd+B` | Show/hide file sidebar |
| Focus mode | `Cmd+.` | Toggle distraction-free focus mode |
| Tag search | `Cmd+3` | Search for tags across all files |
| Document outline | `Cmd+Shift+O` | Open document outline (requires active file) |
| Keyboard shortcuts | `Cmd+7` | Show keyboard shortcuts reference |
| Exit focus mode | `Esc` | Exit focus mode (when active) |

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