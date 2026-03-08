# Release v0.18.5

**Date:** 2026-03-08
**Previous version:** 0.18.4

## Changes

### Features
- AI-assisted research skill pack (Phase 8) — collect, organize, search, synthesize, and cite from web sources
- 4 new bundled skills: `save-research`, `search-research`, `synthesize-sources`, `insert-citation`
- Enhanced `download-webpage` with author/date metadata extraction, `--tags` flag, and research frontmatter
- `Cmd+4` opens command palette in research search mode with real-time filtering
- `search_research` Rust Tauri command for fast research file searching with relevance scoring
- Citation format preferences (`citationFormat`/`citationStyle`) persisted per-project in project metadata
- Three citation styles: inline links, footnotes, academic (APA/MLA/Chicago)

### Fixes
- Local file links in chat messages now open as editor tabs instead of navigating the webview
- Relative file paths in AI responses resolve against workspace project/explorer roots

## Files Changed
- 25 files changed across 2 commits
