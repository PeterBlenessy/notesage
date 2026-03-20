# Release v0.22.6

**Date:** 2026-03-20
**Previous version:** 0.22.5

## Changes

### Fixes
- Fix suggestion popovers (slash command, date, tag, mention) triggering on arrow-key navigation through pills — now only activate on text input
- Fix bubble menu appearing on horizontal rule node selection during keyboard navigation
- Fix date badge prefix (`//`) causing page scroll jump due to `font-size: 0` collapsing element height
- Fix tab order not preserved across app restarts
- Fix trailing punctuation orphaned after AI suggestion Accept/Reject buttons

### Improvements
- Deepen inline diff and AI suggestion highlight colors — richer red/green tones in both light and dark mode
- Restyle Accept/Reject buttons to use neutral monochrome palette (no green/red), matching the design system
- Float AI suggestion Accept/Reject controls in top-right corner on hover instead of inline in text flow
- Add error handling and debug logging to skill/agent pipeline

## Files Changed
- 13 files changed across 7 commits
