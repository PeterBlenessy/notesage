# Implementation History

Chronological log of major implementation milestones and changes.

| # | File | Summary |
|---|------|---------|
| 001 | [Initial Setup](001-initial-setup.md) | Project scaffolding, Tauri + React + Tiptap setup |
| 002 | [Phase 1 Complete](002-phase1-complete.md) | WYSIWYG editor, file tree, tabs, theme |
| 003 | [Features Added](003-features-added.md) | Additional editor and UI features |
| 004 | [UX Overhaul](004-ux-overhaul.md) | Major UX redesign pass |
| 005 | [UX Improvements](005-ux-improvements.md) | Follow-up UX polish |
| 006 | [Logo Implementation](006-logo-implementation.md) | App logo and branding |
| 007 | [Transparency Fixes](007-transparency-fixes.md) | Dialog and background visibility fixes |
| 008 | [Phase 2 Complete](008-phase2-complete.md) | AI collaboration — providers, chat, inline actions |
| 009 | [Release v0.5.0](009-release-v0.5.0.md) | Git integration, window state persistence, settings reorder |
| 010 | [Release v0.5.1](010-release-v0.5.1.md) | Per-document scroll positions, tab visibility fix |
| 011 | [Release v0.5.2](011-release-v0.5.2.md) | Toast notifications for git operations, PRD updates |
| 012 | [Release v0.6.0](012-release-v0.6.0.md) | Project goals, frontmatter support, AI context improvements |
| 013 | [Release v0.6.1](013-release-v0.6.1.md) | Fix scroll position on window resize and layout breakpoint |
| 014 | [Release v0.6.2](014-release-v0.6.2.md) | Remove duplicate Tiptap extension warnings |
| 015 | [Release v0.7.0](015-release-v0.7.0.md) | AI web search with Anthropic and OpenAI provider-native search |
| 016 | [Release v0.8.0](016-release-v0.8.0.md) | PDF export via embedded Typst engine with three templates |
| 017 | [Release v0.9.0](017-release-v0.9.0.md) | Comments, change detection, tab persistence (Phase 5) |
| 018 | [Release v0.10.0](018-release-v0.10.0.md) | Layout redesign — title bar, sidebar, command palette, focus mode, status bar (Phases A-C) |
| 019 | [Release v0.11.0](019-release-v0.11.0.md) | Notesage Library & iCloud Sync (Phase 5.5) |
| 020 | [Release v0.11.1](020-release-v0.11.1.md) | Filesystem watcher fixes for explorer folders |
| 021 | [Release v0.12.0](021-release-v0.12.0.md) | External Change Review — inline diffs, per-hunk controls, cross-file tracker |
| 022 | [Release v0.12.1](022-release-v0.12.1.md) | CI fixes — cross-platform watcher type mismatch, release workflow JSON corruption |
| 023 | [Release v0.12.2](023-release-v0.12.2.md) | UI fixes — chat close button, sidebar tooltips, tab rename, comment focus, cloud badge |
| 024 | [Release v0.13.0](024-release-v0.13.0.md) | AI Provider Architecture v2 — ACP agents, multi-provider connections, per-use-case routing (Phase 6) |
| 025 | [Release v0.14.0](025-release-v0.14.0.md) | Copilot Language Server — inline ghost text completions, status bar toggle (Phase 6e) |
| 026 | [Release v0.14.1](026-release-v0.14.1.md) | Add Google Gemini CLI as ACP agent provider |
| 027 | [Release v0.15.0](027-release-v0.15.0.md) | Agent comment delegation, permission UI, provider picker, external change setting (Phase 6.5) |
| 028 | [Release v0.15.1](028-release-v0.15.1.md) | macOS code signing & notarization |
| 029 | [Release v0.15.2](029-release-v0.15.2.md) | In-app auto-update via Tauri updater plugin |
| 030 | [Release v0.15.3](030-release-v0.15.3.md) | Optimize release CI build time |
| 031 | [Release v0.15.4](031-release-v0.15.4.md) | Fix update UX and CI release notes |
| 032 | [Release v0.15.5](032-release-v0.15.5.md) | Fix release notes in latest.json for auto-updater |
| 033 | [Release v0.16.0](033-release-v0.16.0.md) | Raw mode: Copilot completions, AI actions, frontmatter, UX polish |
| 034 | [Release v0.16.1](034-release-v0.16.1.md) | Fix Copilot auth, auto-update restart, portable images, ghost text truncation |
| 035 | [Release v0.16.2](035-release-v0.16.2.md) | Curated changelog: generator, UpdateDialog, Settings viewer |
| 036 | [Release v0.16.3](036-release-v0.16.3.md) | Multi-folder explorer, source editor word wrap, UI fixes |
| 037 | [Release v0.16.4](037-release-v0.16.4.md) | Editor typography settings: font family, size, line height, paragraph spacing |
| 038 | [Release v0.16.5](038-release-v0.16.5.md) | PDF viewer: continuous scroll, fit-to-page, smoother zoom |
| 039 | [Release v0.16.6](039-release-v0.16.6.md) | Project rename UX, delete confirmation, tab auto-scroll, progress bar fix |
| 040 | [Release v0.16.7](040-release-v0.16.7.md) | EPUB viewer: foliate-js, dark mode, running header/footer, book-wide pages |
| 041 | [Release v0.16.8](041-release-v0.16.8.md) | Find in document: all viewers, inline tag badges, tag search |
| 042 | [Release v0.16.9](042-release-v0.16.9.md) | Move files, adjustable sidebar, frontmatter editing, shortcuts dialog |
| 043 | [Release v0.16.10](043-release-v0.16.10.md) | Agent activity strip & panel, progress streaming, debug logging, UX fixes |
| 044 | [Release v0.16.11](044-release-v0.16.11.md) | Fix AI provider detection, mark-preserving diffs, provider logo in agent panel |
| 045 | [Release v0.17.0](045-release-v0.17.0.md) | Multi-turn comment threads, Apply-to-document, Phase 6.5 complete |
| 046 | [Release v0.17.1](046-release-v0.17.1.md) | Chat agent improvements, AI error display, Ollama timeouts, UI fixes |
| 047 | [Release v0.17.2](047-release-v0.17.2.md) | iCloud project auto-discovery, startup watcher fix |
| 048 | [Release v0.17.3](048-release-v0.17.3.md) | File content search in command palette, Recent in file search |
| 049 | [Release v0.17.4](049-release-v0.17.4.md) | Sync badge icon, check-for-updates button UX |
| 050 | [Release v0.17.5](050-release-v0.17.5.md) | Comment delegation modes, per-reply activity logs, activity spinner fixes |
| 051 | [Release v0.17.6](051-release-v0.17.6.md) | Skills & Agents Platform PRD, roadmap restructure, tab bar fixes, Ollama thinking |
| 052 | [Release v0.18.0](052-release-v0.18.0.md) | Skills & Agents Platform — skill discovery, script execution, bundled skills, wizard UI (Phase 7 Step A) |
| 053 | [Release v0.18.1](053-release-v0.18.1.md) | Addressable agents, quick replies, skill/agent management, Ollama thinking, bug fixes (Phase 7 Step C) |
| 054 | [Release v0.18.2](054-release-v0.18.2.md) | Download-webpage bundled skill, chat panel empty state fix, bundled extraction cleanup |
| 055 | [Release v0.18.3](055-release-v0.18.3.md) | MCP client integration, skill/agent editing, creation improvements |
| 056 | [Release v0.18.4](056-release-v0.18.4.md) | Structured logging, file-backed persistence, store bounds, sleep/wake recovery, leak fixes |
| 057 | [Release v0.18.5](057-release-v0.18.5.md) | AI-assisted research skill pack (Phase 8) — collect, search, synthesize, cite |
| 058 | [Release v0.18.6](058-release-v0.18.6.md) | Voice transcription and dictation with on-device Whisper |
| 059 | [Release v0.19.0](059-release-v0.19.0.md) | Local AI with bundled llama-server (Phase 9) — offline inference, model management, FIM completions |
| 060 | [Release v0.19.1](060-release-v0.19.1.md) | Editor toolbar enhancements — heading picker, color/highlight, alignment, table grid picker, dark mode fixes |
| 061 | [Release v0.19.2](061-release-v0.19.2.md) | Model catalog expansion, command palette unification, @mentions, date badges |
| 062 | [Release v0.19.3](062-release-v0.19.3.md) | Open Actions Dashboard — unified task/comment/goal view with filters and navigation |
| 063 | [Release v0.20.0](063-release-v0.20.0.md) | SQLite document index, date pill fixes, actions dashboard improvements, security hardening |
| 064 | [Release v0.20.1](064-release-v0.20.1.md) | Codebase health — error boundaries, JSON-RPC dedup, file decomposition, dependency cleanup |
| 065 | [Release v0.20.2](065-release-v0.20.2.md) | Shared constants consolidation, comment delegation UX, security fixes |
| 066 | [Release v0.21.0](066-release-v0.21.0.md) | Agent managed install, OS-level sandboxing, chat context isolation, model picker, health check |
| 067 | [Release v0.22.0](067-release-v0.22.0.md) | Network sandboxing proxy, domain filtering, provider context isolation, update checking UI |
| 068 | [Release v0.22.2](068-release-v0.22.2.md) | Index DB local storage, incremental indexing, sidecar fix |
| 069 | [Release v0.22.3](069-release-v0.22.3.md) | GGUF FIM detection, Ollama fallback, editor & settings fixes |
| 070 | [Release v0.22.4](070-release-v0.22.4.md) | Instant tab restore, lazy viewers, dead code removal, file op hardening |
| 071 | [Release v0.22.5](071-release-v0.22.5.md) | Ghost task item fix, AI suggestion restyle, suggestion tab persistence |
| 072 | [Release v0.22.6](072-release-v0.22.6.md) | Arrow-key navigation fixes, diff color/button restyle, hover controls |
| 073 | [Release v0.22.7](073-release-v0.22.7.md) | Kernel-enforced Seatbelt network deny, violation monitoring, sandbox and indexer fixes |
