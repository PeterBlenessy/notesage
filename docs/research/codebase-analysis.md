# Codebase Analysis: Dependencies, Architecture & Recommendations

Research date: 2026-03-09

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

### 1.8 Dependencies to Reconsider

| Dependency | Issue | Recommendation |
| --- | --- | --- |
| **next-themes** | Next.js-specific, unnecessary SSR logic in a Tauri app | Replace with \~30-line custom hook |
| **tippy.js + @tippyjs/react** | Legacy positioning library, Tiptap v3 may handle this | Investigate removing after Tiptap v3 migration stabilizes |
| **@types/diff-match-patch** | Listed in `dependencies` instead of `devDependencies` | Move to `devDependencies` |

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

### 2.5 Crates to Reconsider

| Crate | Issue | Recommendation |
| --- | --- | --- |
| **serde_yaml 0.9** | Archived/unmaintained upstream | Migrate to `serde_yml` (maintained fork) when convenient |
| **hound 3.5** | Possibly unused — audio stays in f32 buffers, resampling is manual | Verify if any codepath still uses WAV I/O; remove if not |
| **tokio "full"** | Pulls in every tokio feature | Audit which features are actually used and specify only those (reduces compile time) |

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

## 4. Recommendations (Prioritized)

### High Priority (improves reliability)

1. **Add React Error Boundaries** around Editor, ChatPanel, and Sidebar. A crash in any hook (especially the 13 co-mounted in Editor.tsx) currently blanks the entire app. \~50 lines of code for significant resilience improvement.

2. **Extract shared JSON-RPC transport** from `copilot_lsp.rs` and `mcp.rs` into a `json_rpc.rs` module. Eliminates \~300 lines of duplication and ensures both protocol implementations handle edge cases consistently.

3. **Decompose** `useAIOperations.ts` (1,022 lines). Split into:

   - `useAcpLifecycle.ts` — agent spawning, session management, event listeners
   - `lib/ai/context.ts` — prompt/context building (goals, file trees, skills)
   - `lib/ai/errors.ts` — error formatting and friendly messages
   - `useAIOperations.ts` — thin orchestration layer calling the above

### Medium Priority (improves maintainability)

4. **Decompose** `Editor.tsx` (1,649 lines). Extract:

   - `useScrollPersistence.ts` — scroll position save/restore with LRU cache
   - `useEditorResize.ts` — ResizeObserver + content width management
   - `TranscriptionOverlay.tsx` — transcription dialog and recording indicator
   - `SourceModeEditor.tsx` — CodeMirror source mode (already somewhat separate)

5. **Migrate from** `serde_yaml` **to** `serde_yml`. The upstream `serde_yaml` crate is archived. `serde_yml` is a maintained fork with the same API. Drop-in replacement.

6. **Replace** `next-themes` **with a custom hook**. `next-themes` is designed for Next.js SSR. In Tauri, a \~30-line custom hook with `localStorage` + `prefers-color-scheme` media query listener is simpler and removes a framework-specific dependency.

7. **Add unit tests for permission tier logic**. The `permission-store` has a complex state machine (session vs always, skill scripts vs ACP tools, auto-allow checks). This is security-critical and untested.

### Low Priority (nice to have)

 8. **Audit** `hound` **crate usage**. If audio stays in f32 memory buffers and resampling is manual, the WAV I/O crate may be unused. Removing it saves compile time.

 9. **Slim** `tokio` **features**. Replace `features = ["full"]` with only the features actually used (likely: `rt-multi-thread`, `macros`, `io-util`, `process`, `sync`, `time`, `net`). Reduces compile time.

10. **Consider** `gray-matter` **over** `yaml` for frontend YAML parsing. Since every use case is frontmatter-in-markdown, `gray-matter` handles delimiter extraction automatically.

11. **Group settings store** into sub-objects when the next settings refactor happens. Current flat structure with 40+ fields and mechanical setters will become unwieldy.

12. **Move** `@types/diff-match-patch` from `dependencies` to `devDependencies`. Type packages are build-time only.

---

## 5. Summary

Notesage's dependency choices are overwhelmingly sound. The core stack (Tauri + React + Tiptap + ProseMirror + Zustand + shadcn/ui) is well-matched to the product requirements. The Rust backend's use of Typst, whisper-rs, and the ACP/MCP protocol implementations demonstrates good judgment in choosing embedded libraries over external service dependencies.

The main areas for improvement are not dependency-related but structural: several files have grown past comfortable sizes (Editor.tsx at 1,649 lines, useAIOperations at 1,022 lines), the JSON-RPC transport is duplicated, and there are no React error boundaries. Addressing these would improve reliability and maintainability without changing any architectural decisions.

No dependencies need urgent replacement. The two flagged for eventual migration (`serde_yaml` → `serde_yml`, `next-themes` → custom) are low-risk, low-urgency changes.