# Keyboard Shortcuts

All keyboard shortcuts use Cmd (⌘) on macOS.

## File Operations

| Action | Shortcut | Description |
|--------|----------|-------------|
| Save | `Cmd+S` | Save current file to disk |
| Open file | `Cmd+O` | Open file picker dialog |
| Close tab | `Cmd+W` | Close active tab (warns if unsaved) |
| New file | `Cmd+N` | Create new untitled file |

## Editor Formatting

| Action | Shortcut | Description |
|--------|----------|-------------|
| Bold | `Cmd+B` | Toggle bold on selection |
| Italic | `Cmd+I` | Toggle italic on selection |
| Underline | `Cmd+U` | Toggle underline on selection |
| Strikethrough | `Cmd+Shift+X` | Toggle strikethrough on selection |
| Code | `Cmd+E` | Toggle inline code on selection |
| Link | `Cmd+K` | Insert/edit link on selection |

## Editor Navigation

| Action | Shortcut | Description |
|--------|----------|-------------|
| Undo | `Cmd+Z` | Undo last change |
| Redo | `Cmd+Shift+Z` | Redo last undone change |

## App Settings

| Action | Shortcut | Description |
|--------|----------|-------------|
| Toggle theme | `Cmd+Shift+T` | Switch between light and dark mode |
| Open settings | `Cmd+,` | Open settings dialog |

## AI Features (Phase 2)

| Action | Shortcut | Description |
|--------|----------|-------------|
| Toggle chat panel | `Cmd+Shift+A` | Show/hide AI chat sidebar |
| Accept suggestion | `Cmd+Enter` | Accept AI inline suggestion (when decoration visible) |
| Reject suggestion | `Cmd+Backspace` | Reject AI inline suggestion (when decoration visible) |

## Tab Navigation

| Action | Shortcut | Description |
|--------|----------|-------------|
| Middle-click tab | Mouse middle button | Close tab |

## Slash Commands

| Command | Result | Description |
|---------|--------|-------------|
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

## Future Shortcuts (Planned)

These shortcuts are planned but not yet implemented:

| Action | Shortcut | Description |
|--------|----------|-------------|
| Quick open | `Cmd+P` | Fuzzy file search and open |
| Find in file | `Cmd+F` | Search within current document |
| Find and replace | `Cmd+Shift+F` | Search and replace in current document |
| Toggle sidebar | `Cmd+B` | Show/hide file sidebar |

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
