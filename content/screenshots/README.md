# Screenshots

This folder contains screenshots for the Notesage marketing site and in-app About dialog.

## Placeholder status

The PNG files in this folder are **minimal placeholder files** (1×1 pixel grey images). They satisfy the file-existence requirement and allow the test suite to pass, but they need to be **replaced with real application screenshots** before any public launch.

## Required screenshots

| Filename | Surface | Variants |
|---|---|---|
| `editor-light.png` | Editor | Light mode (hero) |
| `editor-dark.png` | Editor | Dark mode (hero) |
| `quiet-composer-light.png` | Quiet Composer (AI command bar) | Light mode (hero) |
| `quiet-composer-dark.png` | Quiet Composer (AI command bar) | Dark mode (hero) |
| `sidebar.png` | Sidebar & projects | Either mode |
| `export-dialog.png` | Export dialog | Either mode |
| `ai-chat.png` | AI chat panel | Either mode |
| `voice-transcription.png` | Voice transcription overlay | Either mode |
| `document-viewer.png` | Document viewer (EPUB, PDF, or DOCX) | Either mode |

## Capture instructions

1. Launch Notesage in **development mode** (`pnpm tauri dev`) or use the release build.
2. Create a clean profile with **fictional example content** — no real names, email addresses, file paths, API keys, or secrets visible in any screenshot.
3. Set the window size to approximately **1440 × 900** for consistent proportions.
4. Use macOS's built-in screenshot tool (**⌘⇧4**, then drag) or **⌘⇧3** for full screen. Save as PNG.
5. For light/dark variants, toggle the theme with **⌘T** between captures.

## Content guidelines

- All visible note content must be **fictional** (made-up names, fake projects, example text).
- No real URLs, real email addresses, or real file paths should be visible.
- No API keys or credentials should be visible anywhere.
- The example content should look realistic and illustrate the feature being shown.
