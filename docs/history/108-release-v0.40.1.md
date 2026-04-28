# Release v0.40.1

**Date:** 2026-04-28
**Previous version:** 0.40.0

Keyboard accessibility patch. Closes seven blockers caught in the keyboard-only walkthrough — every one of them broke a Quiet Composer flow on either a non-US keyboard layout or screen-reader / Tab-only navigation. No new features, no settings to flip.

## Changes

### Improvements

- **Recently-opened documents now cycle with `⌃Tab` / `⌃⇧Tab`** — same convention VS Code uses, and works on every keyboard layout. (The previous `⌘⇧[` / `⌘⇧]` chord couldn't even be typed on Swedish and many European layouts where brackets need Option.)

### Fixes

- **Sidebar right-click menu opens with `⌘⇧,`** on Swedish and other non-US keyboard layouts. The chord was checking only the produced character, which on those layouts is a semicolon when Shift is held — the menu never appeared.
- **`⌘.` toggles focus mode** on every keyboard layout. Same shape of fix as the right-click menu.
- **Sidebar's Folders section is now reachable with Tab.** It was invisible to keyboard navigation until something inside it had already received focus, which created a chicken-and-egg trap.
- **Settings keyboard navigation is restored.** Tab from the search field now lands on the nav buttons on the left; ↑ / ↓ cycle through nav items instead of scrolling the right pane. Both were being eaten by the scroll viewport.
- **Settings nav focus ring uses the accent color** so the keyboard focus is visible on inactive nav rows. It was rendering muted grey before, making it hard to see where focus had landed.
- **Creating a new note in Quiet Composer puts the cursor in the editor**, not at the end of the inline-create row in the sidebar. After hitting Enter on the filename, focus now moves to the document so you can start typing immediately.
- **Provider-switch card in chat autofocuses its primary action** when it appears. Tab from the chat input now reaches it, and screen readers announce the card on appearance instead of leaving the user stuck on a disabled textarea.

## Under the hood

- Eleven tasks landed from `docs/tasks/2026-04-28-quiet-composer-phase2-keyboard-blockers-tasks.md`, originating from the manual keyboard-only QA pass at `docs/tasks/qa/2026-04-21-keyboard-only.md`. VoiceOver walkthrough at `docs/tasks/qa/2026-04-21-voiceover-checklist.md` was a clean pass — no actions needed.
- New cross-keyboard-layout safety pattern: any chord using a punctuation key (`,`, `.`, `[`, `]`, `;`, `'`, `\`, `/`, etc.) must accept BOTH `event.key === "<char>"` AND `event.code === "<KeyCodeName>"` so chord recognition is layout-tolerant. Pattern documented in `docs/keyboard-shortcuts.md` ("Cross-keyboard layout safety" section).
- New shared event bus `src/lib/editor-events.ts` with a single `notesage:focus-editor` signal that the Editor subscribes to once on mount. Used to restore editor focus after sidebar inline-create commits; future "land focus in the editor" callers should reuse this rather than holding refs across components.
- Phase 2 default-on flip is now unblocked per the rollout file's "no P0/P1 issue reports outstanding for >2 weeks" gate (`docs/tasks/2026-04-21-ui-refresh-rollout-tasks.md`).
- A focus-border consistency sweep across all shadcn primitives, and a single global `:focus-visible` rule, were both attempted and reverted in this cycle after live-test failures (blinking borders, missing borders on legitimate components). Tracked separately as [GitHub issue #39](https://github.com/PeterBlenessy/notesage/issues/39); pre-sweep baseline restored at commit `02931f6c`.

## Files Changed

7 commits stuck (focus-styling sweep was reverted in two waves). Touched files: `src/hooks/useKeyboardShortcuts.ts`, `src/components/sidebar/quiet/useSidebarItemShortcuts.ts`, `src/components/sidebar/quiet/FoldersSection.tsx`, `src/components/sidebar/quiet/ProjectsSection.tsx`, `src/components/ui/scroll-area.tsx`, `src/components/settings/v2/SettingsShell.tsx`, `src/components/chat/AgentSwitchCard.tsx`, `src/components/editor/Editor.tsx`, plus the new `src/lib/editor-events.ts`. Tests added: `AgentSwitchCard.test.tsx`. Typecheck clean.
