# Release v0.30.0

**Date:** 2026-04-06
**Previous version:** 0.29.0

## Changes

### Features
- Add PptxGenJS script skill for high-quality PPTX generation — three built-in styles (simple, business, report), user-provided template theme extraction (colors, fonts, backgrounds), markdown-to-slide parser
- Add response image rendering in chat messages (ACP, Anthropic, OpenAI) with click-to-preview overlay
- Add agent document tools: comments, drawings, diagrams, presentations
- Add file type icons in sidebar, remove sync badges from files and sub-folders

### Fixes
- Fix provider context isolation not filtering messages on "Start Fresh"
- Fix main window white flash on startup

### Improvements
- Change Resend to retry in place instead of branching
- Reorder chat message actions: Edit, Resend, Branch, Copy
- Enlarge chat history action buttons and align with header
- Move chat history button next to new chat, icon only
- Add hover effect to chat message action buttons
- Improve sidebar UX — selective hover, clickable icons, denser menus
- Remove Quick Capture feature
- Update generate-presentation skill to be agent-driven and knowledge-only

## Files Changed
- 88 files changed across 17 commits
