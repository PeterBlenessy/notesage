# Codebase Analysis: Dependencies, Architecture & Recommendations

**Date:** 2026-03-09 **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | [codebase-health-improvements](../prds/2026-03-10-codebase-health-improvements.md) | Complete (12/12) |
| Tasks | [codebase-health-improvements-tasks](../tasks/2026-03-10-codebase-health-improvements-tasks.md) | Complete (18/18) |

Comprehensive analysis of Notesage v0.18.6 — dependency justifications, architectural trade-offs, and recommended changes.

---

## 1. Frontend Dependencies

### 1.1 Core Framework

| Dependency | Why chosen | Alternatives considered | Verdict |
| --- | --- | --- | --- |
| **React 19** | Mature ecosystem, hooks model fits editor UIs, Tiptap requires it | Svelte (smaller bundle, but no Tiptap bindings), SolidJS (better perf, no Tiptap), Preact (compatible but risky with Tiptap internals) | **Correct** — Tiptap locks you into React |
| **Vite 7** | Fast HMR, native ESM, Tauri template default | Turbopack (Next.js-only), Rspack (less mature plugin ecosystem), esbuild (no HMR framework) | **Correct** — standard for Tauri + React apps |
| **TypeScript 5.8** | Type safety across 50+ files, IDE intelligence | Plain JS (untenable at this scale) | **Correct** |
| **Tailwind v4** | Utility-first CSS, fast iteration, design system compliance | CSS Modules (more verbose, harder to enforce consistency), vanilla-extract (type-safe but heavy setup), Panda CSS (newer, less tooling) | **Correct** — shadcn/ui requires it, v4 has native Vite plugin |

### 1.2 Editor Stack

| Dependency | Why chosen | Alternatives | Verdict |
| --- | --- | --- | --- |
| **Tiptap v3** (19 packages) | Rich text + ProseMirror decoration system for AI overlays, comments, ghost text, inline diffs | Lexical (Meta — fewer extensions, weaker decoration API), Slate.js (unstable API, no decoration equivalent), Plate (Slate wrapper, less mature), BlockNote (Tiptap-based but opinionated, less control) | **Correct** — the decoration system is the linchpin for inline diffs, comment highlights, ghost text, search highlighting, and tag badges. No other editor provides this. The 19-package count is normal for Tiptap (each extension is a separate package). |
| **tiptap-markdown 0.9** | Markdown round-tripping (parse + serialize) | prosemirror-markdown (lower-level, more manual mapping), remark+rehype pipeline (AST-based, more complex to integrate with ProseMirror) | **Correct** — tightest Tiptap integration, handles extension mapping automatically |
| **lowlight 3.3** | Syntax highlighting in code blocks | Shiki (better themes, treesitter-based, but significantly heavier and async), Prism (older, less maintained) | **Correct** — Tiptap's official recommendation, synchronous highlighting |
| **CodeMirror 6** (7 packages) | Source mode markdown editing | Monaco (heavier, VS Code engine, overkill for source mode), Ace (older, less extensible) | **Correct** — lightweight, excellent markdown language support, good keyboard handling |
| **@tippyjs/react + tippy.js** | Positioning for slash commands, bubble menus | Floating UI (more modern, lower-level), Popper.js (tippy wraps this) | **Consider replacing** — Tiptap v3 bundles its own positioning. tippy.js is a legacy dependency that could potentially be removed if Tiptap's built-in positioning covers all use cases. Low priority. |

### 1.3 UI Components

| Dependency | Why chosen | Alternatives | Verdict |
| --- | --- | --- | --- |
| **radix-ui + shadcn/ui** | Accessible primitives, composable, fully themeable, monochrome design system | Ark UI (newer, framework-agnostic, less ecosystem), Mantine (batteries-included but opinionated styling), Headless UI (less complete) | **Correct** — best React component system for custom design systems. Radix handles accessibility, shadcn provides the styling layer. |
| **cmdk 1.1** | Command palette (Cmd+K) | kbar (similar but less maintained), custom (significantly more work) | **Correct** — lightweight, shadcn-compatible, handles keyboard navigation |
| **sonner 2.0** | Toast notifications | react-hot-toast (similar API, less integrated), react-toastify (heavier, more features than needed) | **Correct** — shadcn/ui default, minimal API, good animations |
| **lucide-react 0.564** | Icon library | Heroicons (fewer icons), Phosphor Icons (good alternative, similar size), tabler-icons (similar) | **Correct** — ships with shadcn/ui, consistent stroke width, 1500+ icons |
| **react-resizable-panels 4.6** | Sidebar/editor/chat panel layout | allotment (similar, less React-native), custom splitter (fragile, accessibility issues) | **Correct** — battle-tested, keyboard accessible, localStorage persistence built-in |
| **class-variance-authority + clsx + tailwind-merge** | Conditional class composition | Just clsx (less powerful for variant systems), classnames (older) | **Correct** — standard shadcn/ui trio. Note: CLAUDE.md says "don't install clsx separately" but it's a shadcn/ui transitive dependency, so this is fine. |

### 1.4 State Management

| Dependency | Why chosen | Alternatives | Verdict |
| --- | --- | --- | --- |
| **Zustand 5** | Simple API, persist middleware, no boilerplate, 12+ stores | Jotai (atomic model — good for small state, but persist patterns are less ergonomic for many stores), Valtio (proxy-based, harder to reason about with persist), Redux Toolkit (heavier boilerplate, overkill), Legend State (fast but newer, less ecosystem) | **Correct** — persist middleware is critical for selective serialization across 12+ stores. The `partialize` pattern for excluding runtime-only state is clean. Zustand's `get()`/`set()` pattern maps well to Tauri's async command model. |

### 1.5 Document Viewers

| Dependency | Why chosen | Alternatives | Verdict |
| --- | --- | --- | --- |
| **pdfjs-dist 5.4** | PDF rendering with text layer for search | react-pdf (thin wrapper, adds overhead), pdf.js directly (same thing, less ergonomic import) | **Correct** — Mozilla's standard, well-maintained, text layer enables Cmd+F |
| **mammoth 1.11** | DOCX → HTML for viewing | docx-preview (more faithful rendering), libreoffice-convert (requires LibreOffice binary) | **Acceptable** — mammoth is lightweight but lossy on complex formatting. For read-only viewing of typical documents it's sufficient. If users report formatting issues, docx-preview would be a better choice. |
| **foliate-js** (vendored) | EPUB rendering | epub.js (older, less modern), @nicolo-ribaudo's fork (similar) | **Correct** — modern Web Component, paginated + scroll modes, search API. Vendoring is necessary because it uses dynamic ES module imports that Vite can't bundle. |

### 1.6 Utilities

| Dependency | Why chosen | Alternatives | Verdict |
| --- | --- | --- | --- |
| **diff-match-patch 1.0** | Character-level diffing for external change review | jsdiff (simpler API, less precise at character level), fast-diff (faster, fewer features) | **Correct** — Google's algorithm, best for character-level diffs that need to map to ProseMirror positions |
| **react-markdown 10 + remark-gfm 4** | Render AI chat responses as rich markdown | marked (faster, but no React component tree), @mdx-js/react (overkill, needs compilation) | **Correct** — React-native rendering with GFM tables/checkboxes/strikethrough |
| **yaml 2.8** | YAML frontmatter parsing | gray-matter (includes frontmatter extraction built-in), js-yaml (older API) | **Consider switching** — `gray-matter` would be more ergonomic since you're always parsing frontmatter-in-markdown, not arbitrary YAML. It handles the `---` delimiter extraction automatically. Low priority since current approach works. |
| **next-themes 0.4** | Theme management (light/dark) | Custom implementation (simple `useState` + `localStorage` + `prefers-color-scheme` listener, \~30 lines) | **Consider removing** — `next-themes` is designed for Next.js. In a Tauri app you don't need its SSR hydration logic, script injection, or attribute-based theming. A custom hook would be simpler and eliminate a Next.js-specific dependency. |
| **@zed-industries/claude-agent-acp 0.18** | ACP TypeScript types | None (Zed's official package) | **Correct** — needed for ACP protocol types |

### 1.7 Tauri Plugins

| Plugin | Purpose | Verdict |
| --- | --- | --- |
| **@tauri-apps/api** | Core IPC invoke | Required |
| **plugin-dialog** | Native file/folder pickers | Required |
| **plugin-http** | HTTP requests from frontend | Required for skill scripts |
| **plugin-opener** | Open URLs in default browser | Required |
| **plugin-process** | App restart for updates | Required |
| **plugin-updater** | Auto-update mechanism | Required |

All Tauri plugins are justified — they provide native OS integration that can't be done from a webview.

### 1.8 Dependencies to Reconsider — Status

| Dependency | Issue | Recommendation | Status |
| --- | --- | --- | --- |
| **next-themes** | Next.js-specific, unnecessary SSR logic in a Tauri app | Replace with \~30-line custom hook | ✅ Removed (was unused) |
| **tippy.js + @tippyjs/react** | Legacy positioning library, Tiptap v3 may handle this | Investigate removing after Tiptap v3 migration stabilizes | Open |
| **@types/diff-match-patch** | Listed in `dependencies` instead of `devDependencies` | Move to `devDependencies` | ✅ Moved |

---

## 2. Rust Backend Dependencies

### 2.1 Core

| Crate | Why chosen | Alternatives | Verdict |
| --- | --- | --- | --- |
| **tauri 2** | Desktop shell, IPC, window management | Electron (heavier, 100MB+ binary), Wails (Go-based, smaller ecosystem), neutralino (less mature) | **Correct** — smallest binary size, Rust backend for performance-critical code (Whisper, Typst), native OS integration |
| **tokio 1** (full features) | Async runtime | async-std (less ecosystem), smol (lighter but less tooling) | **Correct** — Tauri requires tokio, `full` features needed for subprocess management |
| **serde + serde_json** | Serialization for IPC, API calls, config files | None reasonable — serde is the Rust standard | **Correct** |
| **reqwest 0.12** | HTTP client for AI API calls | ureq (blocking, simpler), hyper (lower-level) | **Correct** — async, streaming support needed for SSE parsing |

### 2.2 AI & ML

| Crate | Why chosen | Alternatives | Verdict |
| --- | --- | --- | --- |
| **whisper-rs 0.15** | On-device speech-to-text with Metal GPU | whisper-cpp-plus (newer, has VAD built-in but less mature), candle-whisper (pure Rust, slower), vosk-rs (different model, less accurate) | **Correct** — most mature Rust bindings, Metal feature flag for Apple Silicon. Consider `whisper-cpp-plus` in the future for built-in voice activity detection. |
| **cpal 0.15** | Cross-platform audio capture | rodio (playback-focused), oboe (Android-only) | **Correct** — standard for audio input in Rust. The `!Send` constraint on `Stream` is annoying but well-handled with a dedicated thread. |
| **hound 3.5** | WAV file handling | Listed but may be unused if audio stays in-memory buffers | **Verify usage** — if only used for resampling, the manual linear interpolation in `transcription.rs` may have made this redundant |
| **agent-client-protocol 0.9** | ACP agent communication | Custom implementation (significant work) | **Correct** — official Zed crate, handles protocol details |

### 2.3 PDF Export

| Crate | Why chosen | Alternatives | Verdict |
| --- | --- | --- | --- |
| **typst 0.14** (5 crates) | PDF typesetting engine | printpdf (low-level, manual layout), wkhtmltopdf (requires binary), Headless Chrome (heavy), weasyprint (Python) | **Excellent choice** — Typst produces professional-quality PDFs with proper typography, TOC, headers/footers. The compile-time cost (\~672 lines of markdown-to-typst conversion) is justified by output quality. |
| **comrak 0.50** | GFM markdown parsing for export pipeline | pulldown-cmark (faster, less complete GFM), markdown-it (JS, wrong language) | **Correct** — most complete GFM implementation in Rust, syntect feature for code highlighting |

### 2.4 System Integration

| Crate | Why chosen | Alternatives | Verdict |
| --- | --- | --- | --- |
| **notify 7 + notify-debouncer-full 0.4** | Filesystem watching | hotwatch (simpler API, less control), watchman (Facebook, requires daemon) | **Correct** — standard Rust file watcher, debouncer handles macOS FSEvents quirks. The 500ms debounce + 5s self-write TTL is well-tuned. |
| **fs_extra 1.3** | Recursive directory copy for iCloud migration | walkdir + manual copy (more code), xcopy via Command (platform-specific) | **Correct** — simple API for cross-filesystem copies |
| **dirs 5** | Home directory, config directory resolution | home (only home dir), directories (more paths but heavier) | **Correct** — covers all needed system paths |
| **regex 1** | Tag scanning patterns | No alternative needed | **Correct** |
| **serde_yaml 0.9** | Skill/agent YAML frontmatter parsing | yaml-rust2 (lower-level), serde_yml (fork) | **Note** — serde_yaml is unmaintained (archived). Consider migrating to `serde_yml` (actively maintained fork) when convenient. |
| **chrono 0.4** | Date/time for export metadata | time (lighter, but chrono is more ergonomic) | **Correct** — minimal features enabled (`now`, `clock`) |
| **libc 0.2** | macOS-specific system calls (iCloud) | nix (higher-level, heavier) | **Correct** — minimal, only used for specific macOS APIs |

### 2.5 Crates to Reconsider — Status

| Crate | Issue | Recommendation | Status |
| --- | --- | --- | --- |
| **serde_yaml 0.9** | Archived/unmaintained upstream | Migrate to `serde_yml` (maintained fork) when convenient | ✅ Migrated to `serde_yml` |
| **hound 3.5** | Possibly unused — audio stays in f32 buffers, resampling is manual | Verify if any codepath still uses WAV I/O; remove if not | ✅ Removed (zero imports) |
| **tokio "full"** | Pulls in every tokio feature | Audit which features are actually used and specify only those (reduces compile time) | ✅ Slimmed to specific features |

---

## 3. Architectural Analysis

### 3.1 Decisions That Are Working Well

**ProseMirror/Tiptap as the editor engine**

This is the single most important architectural decision. The decoration system enables 6 concurrent overlay layers (comments, inline diffs, ghost text, search highlights, tag badges, AI suggestions) without any of them conflicting. No other editor framework provides this. The plugin system allowed adding comment marks without rewriting the editor.

**Tauri commands as security boundary**

All I/O goes through typed Rust commands. API keys never touch the frontend console. File paths are validated server-side. This pattern scaled cleanly from basic file ops to AI streaming, subprocess management, and voice transcription — 85+ commands with consistent `Result<T, String>` error handling.

**Zustand with selective persistence**

The `partialize` pattern across 12+ stores cleanly separates persisted state from runtime-only state. The migration support in `chat-store` and `routing-store` shows foresight — schema changes don't break existing users. The custom Tauri storage engine for chat history avoids localStorage size limits.

**Open standards adoption (Agent Skills + MCP)**

Building on widely-adopted standards rather than proprietary formats means users bring existing skills from Claude Code, Codex, Gemini CLI. The discovery-based approach (scan directories, not configure manually) is excellent UX.

**Subprocess management in Rust**

The pattern of dedicated OS threads with mpsc channels for ACP agents, Copilot LSP, and MCP servers is robust. `kill_on_drop(true)` + `RunEvent::Exit` hook + `beforeunload` provides three layers of cleanup. The orphan-killing at startup handles crash recovery.

**Typst for PDF export**

Professional-quality output with proper typography, TOC, and templates. The 672-line markdown-to-typst converter is a one-time cost that produces far better results than HTML-to-PDF approaches.

### 3.2 Decisions That Have Trade-offs

`Result<T, String>` **for all Tauri commands**

- **Pro**: Simple, consistent, no custom error types to maintain
- **Con**: No structured error codes, no error categorization (retryable vs fatal), no error context chain
- **Alternative**: A custom `AppError` enum with `#[serde(tag = "kind")]` would let the frontend distinguish between "file not found", "permission denied", "network error", "API rate limit" and handle each appropriately
- **Recommendation**: Keep `String` for now but consider an error enum if user-facing error messages become a pain point

**Module-level mutable state in hooks**

Several hooks use module-level variables (`acpSessionByInstance` in useAIOperations, `repoRefreshTimers` in useFileOperations, `tagScanTimer`) instead of stores or refs. This works because React's module system is a singleton, but it's invisible to React's lifecycle, can't be inspected in devtools, and makes testing harder.

- **Recommendation**: Move module-level state into Zustand stores or at minimum into React refs within the hook

**Git via CLI (**`std::process::Command`**) instead of libgit2**

- **Pro**: Zero additional binary size, guaranteed feature parity with user's git
- **Con**: Parsing CLI output is fragile, spawning processes is slower than in-process calls
- **Alternative**: `git2` crate (libgit2 bindings) — \~2MB binary size increase but type-safe API
- **Recommendation**: Keep CLI approach. The git operations are UI-triggered (not hot-path), and CLI parsing is working. libgit2 would add binary size and a C dependency for marginal benefit.

**No custom error boundaries in React**

There are no React Error Boundary components visible. A crash in any component (especially the editor, which has 13 co-mounted hooks) could blank the entire app.

- **Recommendation**: Add error boundaries around the editor, chat panel, and sidebar. Display a "something went wrong, reload" message instead of a white screen.

### 3.3 Code Health Concerns

**Large files that should be decomposed**

| File | Lines | Recommended split |
| --- | --- | --- |
| `Editor.tsx` | 1,649 | Extract: scroll management hook, transcription UI component, source mode component, resize logic hook |
| `useAIOperations.ts` | 1,022 | Extract: ACP lifecycle management, context/prompt building (utility module), error formatting (utility module) |
| `App.tsx` | 966 | Extract: lifecycle hooks into a `useAppLifecycle` hook, layout into a `Layout` component |
| `skills.rs` | 1,643 | Extract: agent discovery into separate file, script execution into separate file |
| `copilot_lsp.rs` | 1,537 | Extract: JSON-RPC transport into a shared module (reusable by MCP) |
| `CommentPopover.tsx` | 706 | Extract: delegation UI into sub-component, activity log into sub-component |
| `useAgentTaskOperations.ts` | 573 | Extract: ACP session management (shared with useAIOperations) |

**Duplicated patterns**

The JSON-RPC 2.0 transport is implemented twice — once in `copilot_lsp.rs` and once in `mcp.rs`. Both use Content-Length framing, async reader tasks, and pending request maps. A shared `json_rpc.rs` module would reduce \~300 lines of duplication and ensure consistent error handling.

**Test coverage gaps**

- AI provider implementations: only tested via manual use
- Permission tier logic: complex state machine with no unit tests
- Hook composition: no integration tests for the 13 hooks co-mounted in Editor.tsx
- ACP event handling: complex streaming logic with no mock tests
- Round-trip markdown tests exist via fixtures, which is good

**Settings store is flat**

40+ settings in a single flat store with mechanical setter methods. No grouping, no validation. As settings grow, this becomes harder to maintain.

- **Recommendation**: Group into sub-objects (`editor: { floatingToolbar, externalChangeDiffReview }`, `ai: { suggestionsEnabled }`, etc.) in the next major settings refactor

### 3.4 Architectural Alternatives Not Chosen (and why that's fine)

**Why not Electron?**

Electron would give you Node.js in the backend (simpler for AI API calls) but at the cost of 100MB+ binary size, higher memory usage, and no Rust for performance-critical paths (Whisper transcription, Typst compilation). Tauri's \~10MB binary with native Rust is the right trade-off for a desktop editor.

**Why not a CRDT (Yjs/Automerge) now?**

CRDTs would enable real-time collaboration but add significant complexity for a single-user app. ProseMirror is CRDT-compatible (y-prosemirror exists), so this can be added later without rewriting the editor. Correct to defer.

**Why not SQLite for storage instead of JSON files + localStorage?**

JSON sidecar files (`.notesage/comments/*.json`) are human-readable, git-friendly, and portable. SQLite would be faster for queries but harder to sync via iCloud, harder to inspect/debug, and overkill for the current data volume (&lt; 1000 notes per project).

**Why not a monorepo with separate packages?**

The current single-package structure with path aliases (`@/`) is appropriate for the codebase size (\~15K lines frontend, \~12K lines Rust). A monorepo would add tooling complexity without clear benefit until the codebase exceeds \~50K lines or multiple teams contribute.

---

## 4. Recommendations (Prioritized) — Status

### High Priority (improves reliability) — ALL DONE

1. **~~Add React Error Boundaries~~** ✅ — `ErrorBoundary.tsx` wraps Editor, ChatPanel, and Sidebar in `Layout.tsx`

2. **~~Extract shared JSON-RPC transport~~** ✅ — `json_rpc.rs` shared module; `copilot_lsp.rs` and `mcp.rs` refactored

3. **~~Decompose~~** `useAIOperations.ts` ✅ — Split into `useAcpLifecycle.ts`, `lib/ai/context.ts`, `lib/ai/errors.ts` (at 499 lines, down from 1,022)

### Medium Priority (improves maintainability) — ALL DONE

4. **~~Decompose~~** `Editor.tsx` ✅ — Extracted `useScrollPersistence.ts`, `useEditorResize.ts`, `TranscriptionOverlay.tsx`, `SourceModeEditor.tsx` (line count target not fully met but all components extracted)

5. **~~Migrate~~** `serde_yaml` **~~to~~** `serde_yml` ✅ — Drop-in replacement completed

6. **~~Replace~~** `next-themes` ✅ — Removed (was already unused; app uses custom ThemeProvider)

7. **~~Add unit tests for permission tier logic~~** ✅ — `permission-store-acp.test.ts` added

### Low Priority (nice to have) — ALL DONE

 8. **~~Audit~~** `hound` **~~crate usage~~** ✅ — Removed (zero imports found)

 9. **~~Slim~~** `tokio` **~~features~~** ✅ — Replaced `"full"` with specific features

10. **Consider** `gray-matter` **over** `yaml` — Deferred (current approach works, low value)

11. **Group settings store** — Deferred (no settings refactor planned yet)

12. **~~Move~~** `@types/diff-match-patch` **~~to devDependencies~~** ✅

---

## 5. Summary

Notesage's dependency choices are overwhelmingly sound. The core stack (Tauri + React + Tiptap + ProseMirror + Zustand + shadcn/ui) is well-matched to the product requirements. The Rust backend's use of Typst, whisper-rs, and the ACP/MCP protocol implementations demonstrates good judgment in choosing embedded libraries over external service dependencies.

**Post-implementation update (2026-03-15):** All 12 recommendations were addressed via the [Codebase Health Improvements PRD](../prds/2026-03-10-codebase-health-improvements.md). Key outcomes:

- React Error Boundaries prevent white-screen crashes
- JSON-RPC transport deduplicated into shared `json_rpc.rs`
- Large files decomposed (`useAIOperations`, `Editor.tsx`, `App.tsx`, `skills.rs`, `CommentPopover.tsx`)
- Archived `serde_yaml` migrated to `serde_yml`, unused `hound` and `next-themes` removed
- Permission store unit tests added, `tokio` features slimmed, `@types` moved to devDependencies

Remaining deferred items: `gray-matter` migration (low value), settings store restructuring (no current need), tippy.js removal (needs investigation).