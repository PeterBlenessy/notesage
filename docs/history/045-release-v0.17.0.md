# Release v0.17.0

**Date:** 2026-03-01
**Previous version:** 0.16.11

## Changes

### Features
- Multi-turn comment threads: user can reply to agent responses, agent responds again with full conversation history in each prompt
- Explicit "Apply" button on agent replies: shows agent response as inline diff on anchor text via AISuggestion decorations (accept via Cmd+Enter, reject via Cmd+Backspace)
- Preamble stripping: agent responses automatically cleaned of introductory phrases and trailing sign-offs before applying
- Anchor range resolution via CommentMark decoration positions with text search fallback
- Collision prevention: toast warning when another suggestion is active, toast error when anchor text was deleted
- Conversation-aware activity panel: multi-turn conversations displayed as chat-style message threads with user/agent attribution
- Sticky expansion states: expanded conversations stay expanded across agent turns in both comment popover and activity panel
- Multi-turn task reuse: `existingTaskId` on TaskMeta enables activity store to reuse the same task entry across conversation turns

### Improvements
- User vs agent reply distinction in comment popover with separate icons (User icon vs BotMessageSquare)
- Agent auto-apply PRD revised with explicit Apply button flow and multi-turn thread design
- Phase 6.5 marked as complete in all documentation

### Docs
- Updated product-description.md with multi-turn threads, apply-to-document, and Phase 6.5 completion
- Updated architecture.md with multi-turn delegation flow and apply-to-document architecture
- Marked diff-fidelity and agent-auto-apply PRDs as Done

## Files Changed
- 12 files changed across 4 commits
