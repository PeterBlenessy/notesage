# Release v0.16.11

**Date:** 2026-03-01
**Previous version:** 0.16.10

## Changes

### Fixes
- Fix critical bug where AI chat and bubble menu showed "Please configure an AI provider" despite v2 connections being configured — UI was gating on the legacy v1 ai-store instead of v2 routing/connections stores
- Fix Cmd+B shortcut conflict between bold formatting and sidebar toggle — sidebar now uses Cmd+Shift+L

### Features
- Mark-preserving inline changes: accepting AI suggestions and diff hunks now preserves formatting marks (bold, italic, code, links) via shared `pm-replace.ts` helper
- Show provider logo (Anthropic, OpenAI, etc.) in agent activity panel instead of generic bot icon

### Improvements
- Unify SourceBubbleMenu (raw mode) loading behavior with WYSIWYG BubbleMenu — all buttons stay visible during loading with spinner on active button
- Update keyboard shortcuts dialog and documentation for Cmd+Shift+L sidebar toggle

## Files Changed
- 20 files changed across 4 commits
