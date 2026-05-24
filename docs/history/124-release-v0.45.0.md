# Release v0.45.0

**Date:** 2026-05-24
**Previous version:** 0.44.0
**Channel:** Stable

The big change is the editor shell: Quiet Composer is now the only workspace. Plus the usual editor polish, AI-connection clarity, and security pickups.

## Changes

### Improvements

- **Quiet Composer is now the only editor shell.** The floating command bar (⌘K), the flat sidebar (Pinned / Projects / Recent / Tags / Mentions), and the document switcher (⌃Tab / ⌃⇧Tab) are the whole interface. The previous multi-column layout has been retired.

- **Read Only mode tooltip describes what actually happens.** Read Only means the agent has read-only access and silently doesn't try writes — no permission prompts. The tooltip used to suggest the agent would ask first; now it says *"Read access only — agent is denied any write or execute tool calls."*

- **Image hover toolbar works in production builds and matches the other block toolbars.** Hovering an image shows the width and alignment popover with the same look as charts, drawings, and link previews.

- **Microphone button stays in sync across the toolbar and status bar.** Starting on one and stopping on the other works as expected.

- **Empty HTML files show a placeholder.** Opening a 0-byte or whitespace-only `.html` file displays "This HTML file is empty" instead of a blank pane.

- **Multi-line table cells survive export.** Cells containing line breaks round-trip through PDF, DOCX, and HTML export without flattening to a single line.

- **Editor scroll position restores more reliably** when reopening a document.

### Fixes

- **`⌘⇧E` (Export), `⌘⇧L` (Sidebar), `⌘⇧R` (Recording) work again.** An editor extension was silently capturing these chords for paragraph alignment.

- **mermaid diagram security alerts closed.** The bundled mermaid renderer was advanced to close four alerts about Gantt-chart DoS, classDef HTML injection, configuration CSS injection, and classDef CSS injection.

## Known issues

- **Voice dictation can hang the app after extended use.** Start dictation, leave it running for a while, eventually the app becomes unresponsive and requires force-quit. Avoid extended dictation sessions on this release; fix is in progress.

## Under the hood

- **Document switching stays fast in the new shell.** Your undo history and scroll position are preserved when you switch away and come back.

- **Dependencies refreshed across the frontend and backend, including security pickups** for mermaid and the Tauri framework.

- **EPUB viewer cleanup.** Switching from an open EPUB to a different document no longer logs a non-fatal teardown error.

- **Release-pipeline plumbing.** Internal CI work to enable auto-cut alphas and self-improving editor workflow automation. Invisible to users.
