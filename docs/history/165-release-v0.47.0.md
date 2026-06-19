# Release v0.47.0

**Date:** 2026-06-19
**Previous version:** 0.46.0

This release sharpens the basics: keyboard shortcuts are more reliable and better organized, you can run multiple AI sessions at once, and a batch of editor fixes makes documents and drawings load cleanly the first time.

## Changes

### Features

- **Run several AI sessions at the same time.** Start a chat or agent task, leave it working in the background, and start another — Notesage keeps each conversation's responses, tool permissions, and progress separate. The agent orb shows which sessions are still running and pulses when one needs your attention, and you get a desktop notification when a backgrounded session finishes or asks for permission.
- **A cleaner, more reliable set of keyboard shortcuts.** Shortcuts now work correctly on non-US keyboard layouts (including Swedish), ⌘S saves even with Caps Lock on, and a tidier set of combos has been added: ⌘⌥C to add a comment, ⌘⌥P to copy the current document's path, and ⌘⌥R to reveal it in Finder.

### Improvements

- **Paste as plain text just works.** ⌘⇧V now pastes the clipboard text directly, without an extra permission prompt getting in the way.
- **The command bar remembers what you were typing.** Closing the bar no longer throws away an unfinished message, and the skill list is sorted so it's easier to scan.

### Fixes

- **Images appear the first time you open a document** — no more opening a note, seeing blank spots, and having to refresh before pictures show up.
- **Drawings no longer freeze the app.** Opening or exporting documents that contain drawings is now smooth, and drawings stop flooding the logs with font errors.
- **Network restrictions no longer get agents stuck.** When an agent is restricted to certain sites, its requests are handled correctly instead of leaving the conversation hanging.

## Under the hood

Promotes the `0.47.0-alpha.1 … 8` line to stable (history entries 157–164), tagged at the alpha.8 commit so stable contains only alpha-tested code. The dev-only dependency bumps merged after alpha.8 (#489) are intentionally excluded here and ship on the next alpha line.

Marquee work:

- **Command-bar session lifecycle & concurrent multitasking** (#469) — per-conversation ACP agent registry, run-state store, streaming writes, tool-permission ownership with foreground-aware auto-deny, a concurrency cap + FIFO queue (`maxConcurrentSessions`), history-row status badges + switcher, inline permission cards in history rows, orb unwatched-session list + needs-you pulse, and desktop notifications for backgrounded sessions. Post-review hardening pass landed targeted ACP stream cleanup, single-pass run-state derivations, and shared approval UI; deferred item #11 tracked in issue #468.
- **Keyboard-shortcut overhaul** (#486) — centralized app-level chords into an App-root dispatcher driven by the command manifest, with layout-safe chord matching (`event.code` fallbacks for Swedish/non-US layouts), Caps-Lock-tolerant ⌘S, a durable command-bar summon store, and the new ⌘⌥C / ⌘⌥P / ⌘⌥R combos (⌘⇧C / ⌘⇧M / ⌘/ retired). ⌘⇧V (paste-as-plain-text) now reads the clipboard through the Tauri clipboard plugin, bypassing the WebKit permission popup.
- **Editor first-paint fixes** — images render on first paint (#478), asset scope granted early/ungated so doc images load before any refresh (#482).
- **Drawing fixes** — skip Excalidraw font inlining to stop the app hang (#475), bundle Latin fonts locally to avoid CDN/CSP noise (#479), stub the CJK font to silence font-error spam (#481).
- **Network** — always-mounted domain-approval listeners so restrictions don't wedge agents (#474).
- **Command bar** — sort skill list + preserve input draft on close (#466).
- Dependency bumps across the cycle (build tooling and the npm_and_yarn / cargo groups).

## Files Changed

Promotion of the 0.47.0 alpha line to stable: `package.json` version `0.47.0-alpha.8` → `0.47.0`, this history entry, the README index row, and the regenerated `public/changelog.json`.
