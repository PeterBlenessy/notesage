# Release v0.16.10

**Date:** 2026-03-01
**Previous version:** 0.16.9

## Changes

### Features
- Agent activity strip & panel — background task tracking with status icons, streaming output, thinking output, markdown rendering, click-to-navigate to source comments
- Agent activity panel resizable with drag handle, keyboard shortcut (Cmd+Shift+A)
- Progress streaming — partial agent replies stream into comment popovers in real-time
- Configurable debug logging (frontend + Rust backend) with Developer settings tab
- Make Project option on top-level explorer folders (previously only available on child folders)

### Fixes
- Fix update download progress bar flickering caused by CSS transition interruption
- Fix Copilot LSP signIn flow: extract userCode from signInInitiate response
- Fix scroll-to-comment navigation from activity panel
- Clean up partial replies and activities on comment/document deletion
- Fix sidebar resize handle only showing when pinned
- Fix TooltipProvider error in activity strip
- Fix Copilot LSP error swallowing in execute_embedded_command

### Improvements
- Design review fixes for agent activity components (shadcn/ui Button, consistent icon sizing, text sizes)
- Developer settings promoted to its own tab (moved from About section)
- Agent activity tasks persist across app restart (running tasks marked as error on rehydration)
- Updated terminology: agent activity strip (40px rail) vs agent activity panel (resizable sidebar)

## Files Changed
- 30+ files changed across 16 commits
