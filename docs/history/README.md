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
| 074 | [Release v0.22.8](074-release-v0.22.8.md) | Copilot LSP device code fix, Gemini API key auth, agent auth UX improvements |
| 075 | [Release v0.22.9](075-release-v0.22.9.md) | Delegation sandbox path filtering, link toolbar button, heading dropdown fix |
| 076 | [Release v0.22.10](076-release-v0.22.10.md) | Fix open actions comment navigation, orphaned comment cleanup |
| 077 | [Release v0.23.0](077-release-v0.23.0.md) | Secure credential storage (OS keychain), multiple OpenAI-compatible providers, production fixes |
| 078 | [Release v0.23.1](078-release-v0.23.1.md) | Fix OpenAI-compatible heartbeat, API key visibility, action-store build error |
| 079 | [Release v0.23.2](079-release-v0.23.2.md) | Full codebase audit: 38 tasks fixing memory leaks, async races, render perf, decomposition |
| 080 | [Release v0.23.3](080-release-v0.23.3.md) | Test infrastructure (426 tests), perf fixes, tab preloading, audit v2 complete |
| 081 | [Release v0.24.0](081-release-v0.24.0.md) | Conversation branching, tab drag-and-drop, internal links, font picker, contrast slider, tool calling |
| 082 | [Release v0.25.0](082-release-v0.25.0.md) | Skills-to-tools glue layer, branch deletion, branch persistence fix |
| 083 | [Release v0.26.0](083-release-v0.26.0.md) | Inline charts, drawing canvas, callout blocks, external change fixes |
| 084 | [Release v0.27.0](084-release-v0.27.0.md) | PPTX viewer, DOCX/PPTX/HTML export, chat resend/edit, dynamic tables |
| 085 | [Release v0.28.0](085-release-v0.28.0.md) | Code file editing, syntax highlighting, WYSIWYG typography, page headers/footers |
| 086 | [Release v0.28.1](086-release-v0.28.1.md) | Chronological chat segments, tool call grouping, ACP session resilience |
| 087 | [Release v0.28.2](087-release-v0.28.2.md) | ACP skill discovery, color tint system, Dependabot fixes |
| 088 | [Release v0.28.3](088-release-v0.28.3.md) | Gemma 4, HF model search, catalog management, llama.cpp b8648 |
| 089 | [Release v0.28.4](089-release-v0.28.4.md) | Audit v3: 39 fixes — async races, accessibility, type safety, decomposition, 70+ new tests |
| 090 | [Release v0.29.0](090-release-v0.29.0.md) | System tray, notifications, quick capture, autostart, image attachments, UI polish |
| 091 | [Release v0.30.0](091-release-v0.30.0.md) | PptxGenJS presentation skill, response image rendering, sidebar UX, agent tools |
| 092 | [Release v0.30.1](092-release-v0.30.1.md) | Fix speaker notes parsing for escaped brackets |
| 093 | [Release v0.30.2](093-release-v0.30.2.md) | PPTX viewer v2 (21 tasks), rich PPTX generation (17 tasks), 3 bug fixes |
| 094 | [Release v0.30.3](094-release-v0.30.3.md) | PPTX viewer fidelity — text cascade, charts, tables, bullets, 20 fixes |
| 095 | [Release v0.31.0](095-release-v0.31.0.md) | Inline attachments — portable charts/drawings in fenced code blocks, chart expansion, chat UX |
| 096 | [Release v0.32.0](096-release-v0.32.0.md) | Document style frontmatter, TOC extension, typing perf fixes, Vite reload fix, Typst restored |
| 097 | [Release v0.32.1](097-release-v0.32.1.md) | Chat truncation fix, ACP tool progress, interrupted messages, data URI images |
| 098 | [Release v0.33.0](098-release-v0.33.0.md) | Sub/superscript, focus mode dimming, trailing node, UniqueID, decoration factory, dispatch migration |
| 099 | [Release v0.34.0](099-release-v0.34.0.md) | ACP protocol compliance — thinking, modes, config, usage, plans, slash commands, session lifecycle |
| 100 | [Release v0.35.0](100-release-v0.35.0.md) | Agent simplification — remove bundled agents, @ pass-through for ACP, expanded discovery, custom prompts |
| 101 | [Release v0.36.0](101-release-v0.36.0.md) | ACP session lifecycle — resume/list/fork/close; inline diff + text content blocks; 4 race/casing fixes |
| 102 | [Release v0.37.0](102-release-v0.37.0.md) | ACP Protocol Tail — task agent parity + close, EnvVar auth, resource_link, messageId; 5 security advisories closed |
| 103 | [Release v0.38.0](103-release-v0.38.0.md) | Project isolation — lock a project to one AI provider, scoped approvals, one-click re-authentication, tighter agent sandbox, Copilot & completions stay in scope |
| 104 | [Release v0.38.1](104-release-v0.38.1.md) | Explicit file-attach for out-of-scope tabs, attachment audit trail, cleaner project switches mid-stream, correct history slicing after provider switch |
| 105 | [Release v0.39.0](105-release-v0.39.0.md) | Quiet Composer Preview (opt-in) — floating command bar, agent orb, flat sidebar, accent palette, focus mode polish, rebuilt Settings, sidebar pinned files |
| 106 | [Release v0.39.1](106-release-v0.39.1.md) | Security patch — closes XML injection / KaTeX XSS in DOCX viewer + Excalidraw drawings (no behavioural changes) |
| 107 | [Release v0.40.0](107-release-v0.40.0.md) | File search verb (`⌘⇧F` → `:file`), `:` command discovery with Tab autocomplete, Folders sidebar section, window-inactive dimming, Quick Capture removed, sidebar polish |
| 108 | [Release v0.40.1](108-release-v0.40.1.md) | Keyboard accessibility patch — non-US layout chord fixes (`⌘⇧,`, `⌘.`), MRU cycle moved to `⌃Tab`, Settings + Folders Tab-reachable, new-note cursor lands in editor, provider-switch card autofocus |
| 109 | [Release v0.41.0](109-release-v0.41.0.md) | External file watching — rename in Finder/terminal, the open tab + sidebar follow; comments migrate with folder renames; iCloud sync moves to per-project menu; Copilot LSP stability fix; command-bar picker UI consistency pass |
| 110 | [Release v0.42.0](110-release-v0.42.0.md) | Large markdown files load substantially faster (book ~22 s → ~3 s on revisit, ~5 s first load); clicking a different doc mid-load cleanly cancels the previous load; cursor + hover stay responsive throughout; two new Settings → System toggles for instant-load preview and sidebar file hover preview |
| 111 | [Release v0.43.0](111-release-v0.43.0.md) | One unified "Folders" sidebar section; right-click any folder → Customize… to pick from a curated icon set + 8-colour palette; right-click → Manage with Notesage on a folder you opened with ⌘O to unlock AI lock and per-folder skills; new Alpha release channel selector in Settings → Updates; faster cold-start for previously-edited files via a local viewport cache; folder renames are now crash-safe |
| 112 | [Release v0.44.0-alpha.0](112-release-v0.44.0-alpha.0.md) | Width + alignment now persist on charts, drawings, and link-previews; HTML files render inline with a working toolbar; PDF viewer respects `Cmd+= / -` zoom; embedded blocks have more breathing room; large book opens in ~3s again after a brief in-branch perf regression. Toolbar align on embedded blocks and the image hover toolbar are deferred to the next alpha. |
| 113 | [Release v0.44.0-alpha.1](113-release-v0.44.0-alpha.1.md) | Patch on top of `alpha.0` — removes an obsolete StatusTray perf benchmark that broke release CI. No behavioural change. |
| 114 | [Release v0.44.0-alpha.2](114-release-v0.44.0-alpha.2.md) | Real shipping cut of the post-v0.43 stack: four new HTML viewer security toggles (block external resources, allow scripts, unsafe preview mode, allow forms), research / templates folders now visible at project root, and the full alpha.0 content (width + alignment persistence, inline HTML rendering, Cmd+= PDF zoom, Swedish-keyboard chord fix, 494 KB book opens fast again) that didn't actually ship in alpha.0 or alpha.1. |
| 115 | [Release v0.43.1](115-release-v0.43.1.md) | Stable patch. Stops Stable-channel users from being auto-upgraded to alpha builds (defense in depth: release workflow auto-flags `-alpha`/`-beta`/`-rc` tags as prereleases, AND the in-app updater on Stable refuses any prerelease version regardless of what the server says). Also makes the Alpha channel actually receive updates — the manifest fetch now goes through Tauri's HTTP plugin so GitHub's release-asset redirect doesn't trip WKWebView CORS. |
| 116 | [Release v0.44.0-alpha.3](116-release-v0.44.0-alpha.3.md) | First alpha that delivers on the v0.43.0 "switch back to Stable any time" promise. Leaving Alpha now offers an explicit "Switch back to Stable v0.43.1?" dialog (with a clear downgrade warning) when the latest stable is older than your current alpha. Also brings the v0.43.1 channel-isolation guarantees forward into the alpha track — and makes the Alpha channel actually receive in-app updates (alpha → alpha works via Tauri's HTTP plugin). Anyone stuck on alpha.0/.1/.2 needs a manual reinstall — those binaries can't auto-update. |
| 117 | [Release v0.44.0](117-release-v0.44.0.md) | Promotes the cumulative v0.44.0 alpha to stable: HTML viewer security toggles (block external resources, allow scripts, allow forms, per-tab unsafe preview), block-size persistence on charts / drawings / link-previews / images, `Cmd+= / Cmd+- / Cmd+0` zoom in the PDF viewer, research and templates folders visible at project root, one-click switch back from Alpha to Stable, auto-check on channel change, and the alpha.0 editor fixes (Tooltip-provider crash, Swedish-keyboard collision, scroll-restore, image-serializer block separator, width-after-tab-switch). Ships with three known limitations tracked as open issues (image hover toolbar in prod builds, toolbar align on embedded blocks, empty HTML files). |
| 118 | [Release v0.45.0-alpha.0](118-release-v0.45.0-alpha.0.md) | First alpha after v0.44.0 stable. Closes 5 of 6 open Dependabot alerts (4 mermaid sanitisation issues + 1 transitive rand). Image hover toolbar finally works in production builds (long-standing regression fix). Update / switch-channel dialogs render markdown. In-app changelog is channel-aware (stable users no longer see alpha entries). Empty HTML files show a placeholder instead of a blank pane. MicButton in StatusTray and Toolbar stay in sync. 22 frontend deps refreshed (tiptap 3.22 → 3.23 + others); 10 Rust deps patched. Ships with a known issue: voice dictation can hang the app after extended use (#264) — avoid extended sessions on this alpha. |
| 119 | [Release v0.45.0-alpha.1](119-release-v0.45.0-alpha.1.md) | Fix-focused alpha. Restores the agent mode picker (Shield icon) for anyone whose AI provider connection was set up before the capability-probe change in alpha.0 — opening the chat now backfills the picker automatically. Unblocks `Cmd+Shift+E` (Export), `Cmd+Shift+L` (Sidebar) and `Cmd+Shift+R` (Recording) keyboard shortcuts that an editor extension was silently capturing for paragraph alignment. Resolves the image hover toolbar styling inconsistency known issue from alpha.0. Read Only mode tooltip clarified to reflect what the mode actually does. |
| 120 | [Release v0.45.0-alpha.2](120-release-v0.45.0-alpha.2.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 121 | [Release v0.45.0-alpha.3](121-release-v0.45.0-alpha.3.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 122 | [Release v0.45.0-alpha.4](122-release-v0.45.0-alpha.4.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 123 | [Release v0.45.0-alpha.5](123-release-v0.45.0-alpha.5.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 124 | [Release v0.45.0](124-release-v0.45.0.md) | Promotes the v0.45.0 alpha series to stable — Quiet Composer is now the only editor shell. |
| 125 | [Release v0.45.0-alpha.6](125-release-v0.45.0-alpha.6.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 126 | [Release v0.46.0-alpha.1](126-release-v0.46.0-alpha.1.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 127 | [Release v0.46.0-alpha.2](127-release-v0.46.0-alpha.2.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 128 | [Release v0.46.0-alpha.3](128-release-v0.46.0-alpha.3.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 129 | [Release v0.46.0-alpha.4](129-release-v0.46.0-alpha.4.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 130 | [Release v0.46.0-alpha.5](130-release-v0.46.0-alpha.5.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 131 | [Release v0.46.0-alpha.6](131-release-v0.46.0-alpha.6.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 132 | [Release v0.46.0-alpha.7](132-release-v0.46.0-alpha.7.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 133 | [Release v0.46.0-alpha.8](133-release-v0.46.0-alpha.8.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 134 | [Release v0.46.0-alpha.9](134-release-v0.46.0-alpha.9.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 135 | [Release v0.46.0-alpha.10](135-release-v0.46.0-alpha.10.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 136 | [Release v0.46.0-alpha.11](136-release-v0.46.0-alpha.11.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 137 | [Release v0.46.0-alpha.12](137-release-v0.46.0-alpha.12.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 138 | [Release v0.46.0-alpha.13](138-release-v0.46.0-alpha.13.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 139 | [Release v0.46.0-alpha.14](139-release-v0.46.0-alpha.14.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 140 | [Release v0.46.0-alpha.15](140-release-v0.46.0-alpha.15.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 141 | [Release v0.46.0-alpha.16](141-release-v0.46.0-alpha.16.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 142 | [Release v0.46.0-alpha.17](142-release-v0.46.0-alpha.17.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 143 | [Release v0.46.0-alpha.18](143-release-v0.46.0-alpha.18.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 144 | [Release v0.46.0-alpha.19](144-release-v0.46.0-alpha.19.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 145 | [Release v0.46.0-alpha.20](145-release-v0.46.0-alpha.20.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 146 | [Release v0.46.0-alpha.21](146-release-v0.46.0-alpha.21.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 147 | [Release v0.46.0-alpha.22](147-release-v0.46.0-alpha.22.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 148 | [Release v0.46.0-alpha.23](148-release-v0.46.0-alpha.23.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 149 | [Release v0.46.0-alpha.24](149-release-v0.46.0-alpha.24.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 150 | [Release v0.46.0-alpha.25](150-release-v0.46.0-alpha.25.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 151 | [Release v0.46.0-alpha.26](151-release-v0.46.0-alpha.26.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 152 | [Release v0.46.0-alpha.27](152-release-v0.46.0-alpha.27.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 153 | [Release v0.46.0-alpha.28](153-release-v0.46.0-alpha.28.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 154 | [Release v0.46.0](154-release-v0.46.0.md) | Stable: Local AI Agents (on-device agent), on-device meeting transcription, MCP remote/OAuth/catalog, opt-in telemetry, and Quiet Composer polish. |
| 155 | [Release v0.46.0-alpha.29](155-release-v0.46.0-alpha.29.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 156 | [Release v0.46.0-alpha.30](156-release-v0.46.0-alpha.30.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 157 | [Release v0.47.0-alpha.1](157-release-v0.47.0-alpha.1.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 158 | [Release v0.47.0-alpha.2](158-release-v0.47.0-alpha.2.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 159 | [Release v0.47.0-alpha.3](159-release-v0.47.0-alpha.3.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 160 | [Release v0.47.0-alpha.4](160-release-v0.47.0-alpha.4.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 161 | [Release v0.47.0-alpha.5](161-release-v0.47.0-alpha.5.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 162 | [Release v0.47.0-alpha.6](162-release-v0.47.0-alpha.6.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 163 | [Release v0.47.0-alpha.7](163-release-v0.47.0-alpha.7.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 164 | [Release v0.47.0-alpha.8](164-release-v0.47.0-alpha.8.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 165 | [Release v0.48.0-alpha.1](165-release-v0.48.0-alpha.1.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 166 | [Release v0.47.0](166-release-v0.47.0.md) | Stable (2026-06-19): concurrent AI sessions, keyboard-shortcut overhaul, editor & drawing first-paint fixes |
| 167 | [Release v0.48.0-alpha.2](167-release-v0.48.0-alpha.2.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 168 | [Release v0.48.0-alpha.3](168-release-v0.48.0-alpha.3.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 169 | [Release v0.48.0-alpha.4](169-release-v0.48.0-alpha.4.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 170 | [Release v0.48.0-alpha.5](170-release-v0.48.0-alpha.5.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 171 | [Release v0.48.0-alpha.6](171-release-v0.48.0-alpha.6.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 172 | [Release v0.48.0-alpha.7](172-release-v0.48.0-alpha.7.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 173 | [Release v0.48.0-alpha.8](173-release-v0.48.0-alpha.8.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 174 | [Release v0.48.0-alpha.9](174-release-v0.48.0-alpha.9.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 175 | [Release v0.48.0-alpha.10](175-release-v0.48.0-alpha.10.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 176 | [Release v0.48.0-alpha.11](176-release-v0.48.0-alpha.11.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 177 | [Release v0.48.0-alpha.12](177-release-v0.48.0-alpha.12.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 178 | [Release v0.48.0-alpha.13](178-release-v0.48.0-alpha.13.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 179 | [Release v0.48.0-alpha.14](179-release-v0.48.0-alpha.14.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 180 | [Release v0.48.0-alpha.15](180-release-v0.48.0-alpha.15.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 181 | [Release v0.48.0-alpha.16](181-release-v0.48.0-alpha.16.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 182 | [Release v0.48.0-alpha.17](182-release-v0.48.0-alpha.17.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 183 | [Release v0.48.0-alpha.18](183-release-v0.48.0-alpha.18.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 184 | [Release v0.48.0-alpha.19](184-release-v0.48.0-alpha.19.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 185 | [Release v0.48.0-alpha.20](185-release-v0.48.0-alpha.20.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
| 186 | [Release v0.48.0-alpha.21](186-release-v0.48.0-alpha.21.md) | Auto-cut alpha by `aw-alpha-cut`. See merged PRs for details. |
