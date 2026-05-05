# Large File Instant Load — Phase 1 Tasks

|  |  |
| --- | --- |
| **Date** | 2026-05-05 |
| **Status** | Landed 2026-05-05 (commit 84ea0561). Open polish: comrak↔Tiptap CSS divergence (live-test feedback). |
| **PRD** | [large-file-instant-load](../prds/2026-05-03-large-file-instant-load.md) |
| **Phase** | 1 of 4 — Rust comrak HTML preview (Layer 1) |
| **Total** | 19 tasks across 6 milestones |
| **Complexity mix** | \~10 S, \~7 M, \~2 L |
| **Suggested order** | M1.1 Backend (#1 → #4 → #2 → #3) → M1.2 Component (#5 → #6 → #7) → M1.3 Integration (#8 → #9 → #11 → #10) → M1.4 Polish (#12 → #13) → M1.5 Fidelity (#14 → #15 → #16) → M1.6 Measurement (#17 → #18 → #19) |

## Scope

Layer 1 of the three-layer architecture: a Tauri-side comrak render produces an HTML body fragment that paints in <300 ms on the 506 KB reference book. A new `<MarkdownPreview>` component shows that HTML inside a wrapper that opts into every editor.css selector, so the preview is visually indistinguishable from the eventual Tiptap render. The editor still hydrates synchronously on the main thread (Phase 2 moves it to a worker), but its `setContent` call is deferred until after the preview's first paint.

Phase 1 alone does NOT reduce total click → settled time meaningfully — it only makes time-to-readable instant. The structural win is that the user sees content immediately while the heavy parse runs.

## Execution notes

- **Visual identity is a hard gate.** The preview wrapper MUST share fonts, padding, line-height, max-width, and the `.ProseMirror` class hierarchy with the real editor. The fidelity diff test (#15) is the merge gate; <2 % pixel diff outside the caret region.
- **Don't introduce in-app instrumentation.** Phase 0 was scrubbed for a reason — DevTools Timeline is the source of truth for before/after numbers. Use existing `[perf:tab-load]` log lines for ordering, nothing new.
- **Reference recording.** All measurements run against the user's real 506 KB book (`Svenska-Investmentbolag-v0.10.0.md`) on Apple M3 / 24 GB. Synthetic fixtures are insufficient — the load curve is super-linear and the user's file is the canonical regression target.
- **Cold cache only for Phase 1 numbers.** Phase 3 introduces the disk cache; until then, every measurement is a fresh load.
- **Optional pre-Phase-1 PR.** Memory tracks a separate ~3–4 s win available by skipping the `getMarkdownFromEditor` debounce on bulk-load transactions (`useEditor.ts:271`). Worth landing as a one-line PR before #17 so the post-Phase-1 baseline is uncontaminated by an unrelated improvement. Not blocking; flag during execution.

## Risks and open questions

- **Frontmatter strip parity.** If the Rust strip diverges from `parseFrontmatter` on CRLF line endings, missing trailing newlines, or `---` lookalikes inside content, every preview offsets one heading away from the editor and the diff test fails. #2 is the lock-down.
- **Embedded SVGs gap.** Drawings (`.excalidraw` fenced blocks) and charts (`chart` fenced blocks) render as syntax-highlighted code in the preview because Phase 1 deliberately skips `embedded_svgs`. Acceptable per PRD ("close-enough fidelity is fine because the swap is invisible and brief") but #16 must add these to the diff allowlist or those fixtures fail the gate.
- **`requestIdleCallback` in WKWebView.** Safari/WKWebView has no rIC. Fall back to `setTimeout(fn, 0)` and verify in DevTools that the fallback actually defers `setContent` past the preview paint frame. If `setTimeout(0)` still fires before paint on heavy main threads, switch to a double-rAF pattern.
- **Tag/mention/date plain-text gap.** `#tag`, `@mention`, `//YYYY-MM-DD` render as plain text in comrak output (no badge styling). The 5 s window is fine; the diff test masks those runs (#16). If user feedback says the plain-text flash is jarring, file a follow-up to teach `markdown_to_html` to wrap them in styled spans.

---

## M1.1 Backend command (4 tasks)

### #1 — `render_markdown_preview` Tauri command

| Field | Value |
| --- | --- |
| Description | New Tauri command in `src-tauri/src/commands/export.rs` (or new `preview.rs`) — signature `render_markdown_preview(path: String, project_root: Option<String>, theme: String) -> Result<String, String>`. Reads the file from disk, strips YAML frontmatter, calls existing `markdown_to_html(&content, &theme, project_root.as_deref(), None)`, returns the body fragment. Register in `src-tauri/src/lib.rs` `generate_handler![]` and re-export from `commands/mod.rs`. |
| Complexity | S |
| Category | backend |
| Depends on | none |
| Files | `src-tauri/src/commands/export.rs` (or new `preview.rs`), `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs` |

### #2 — Frontmatter strip parity with frontend

| Field | Value |
| --- | --- |
| Description | Confirm the Rust frontmatter strip matches `src/lib/frontmatter.ts:parseFrontmatter` exactly — same delimiter (`---`), same handling of CRLF vs LF, same handling of missing trailing newline, same handling of `---` lines that appear later in the document (only the leading block is the frontmatter). Add cargo unit tests against `tests/fixtures/full-syntax.md` plus three edge cases (CRLF, no trailing newline, body containing `---`). |
| Complexity | S |
| Category | backend |
| Depends on | #1 |
| Files | `src-tauri/src/commands/export.rs`, `src-tauri/Cargo.toml` if test deps needed |

### #3 — Embedded SVG decision (skip for Phase 1)

| Field | Value |
| --- | --- |
| Description | Phase 1 deliberately passes `embedded_svgs: None` to `markdown_to_html`. Drawings and charts render as syntax-highlighted code blocks during the brief preview window, get replaced by their real node-views on hydrate. Document the decision inline in `render_markdown_preview` (one-line comment linking to PRD § "Fidelity gaps to manage"). Alternative considered (read `.excalidraw.svg` sidecars from disk in Rust) is deferred — adds I/O latency for a window that is by design <5 s. No code change beyond the comment. |
| Complexity | S |
| Category | backend |
| Depends on | #1 |
| Files | `src-tauri/src/commands/export.rs` |

### #4 — TS bridge in `tauriApi`

| Field | Value |
| --- | --- |
| Description | Add `renderMarkdownPreview(path: string, projectRoot: string \| null, theme: "light" \| "dark"): Promise<string>` to the typed Tauri wrapper. Mirror the existing `renderHtml` shape. |
| Complexity | S |
| Category | frontend |
| Depends on | #1 |
| Files | `src/lib/tauri.ts` |

---

## M1.2 Preview wrapper component (3 tasks)

### #5 — `<MarkdownPreview>` component

| Field | Value |
| --- | --- |
| Description | New `src/components/editor/MarkdownPreview.tsx`. Props: `{ html: string; contentWidth: ContentWidth; presets: TypographyPresets }`. Renders `<div class="ProseMirror" data-preview>` with `dangerouslySetInnerHTML={{ __html: html }}`. Wrapper opts into every editor.css selector via the `.ProseMirror` class. Reads the same `--ns-paragraph-*` and `--ns-heading-*` CSS variables and the same `CONTENT_WIDTHS[contentWidth]` max-width the real editor uses. Read-only but text-selectable (cursor: text rule scoped via `.ProseMirror[data-preview]` if needed). No editing affordances, no toolbar, no decorations. |
| Complexity | M |
| Category | frontend |
| Depends on | #4 |
| Files | `src/components/editor/MarkdownPreview.tsx`, `src/styles/editor.css` (cursor rule if needed) |

### #6 — Cmd+F / Cmd+C / link clicks while in preview

| Field | Value |
| --- | --- |
| Description | Cmd+C works natively (text-selectable wrapper). Cmd+F: route to the existing `src/lib/dom-search.ts` utility (already used by DOCX, plain-text, PPTX viewers). Link clicks: route through the same `src/lib/link-utils.ts` resolver the editor uses, so internal markdown links open as tabs and external URLs go to the system browser. The existing FindBar is editor-coupled; for Phase 1 a minimal DOM-search panel (or reuse DOCX viewer's pattern) is enough — full FindBar parity is not a Phase 1 goal. |
| Complexity | S |
| Category | frontend |
| Depends on | #5 |
| Files | `src/components/editor/MarkdownPreview.tsx`, possible small `useDomFindBar` hook if extracted |

### #7 — Scroll container parity

| Field | Value |
| --- | --- |
| Description | Verify the preview's `scrollHeight` matches the editor's `scrollHeight` within ±2 % rounding for a 50 KB fixture (a small e2e-real assertion is fine). Same padding-top/bottom, same max-width, same per-block heights within rounding. This is the foundation for Phase 2's invisible swap — if heights diverge here, the swap will jolt. |
| Complexity | S |
| Category | frontend |
| Depends on | #5 |
| Files | `src/components/editor/MarkdownPreview.tsx`, e2e or unit assertion |

---

## M1.3 Editor load-path integration (4 tasks)

### #8 — `previewState` field on tab + store action

| Field | Value |
| --- | --- |
| Description | Extend `OpenDocument` in `src/stores/editor-store.ts` with `previewHtml?: string` and `previewState?: "idle" \| "loading" \| "ready" \| "hydrated"`. New action `setPreview(tabId, html)` and `setPreviewState(tabId, state)`. NOT persisted — preview HTML regenerates on every open. Default state is `idle` so legacy code paths keep working unchanged. |
| Complexity | S |
| Category | frontend |
| Depends on | #4 |
| Files | `src/stores/editor-store.ts` |

### #9 — Fire preview on tab activate

| Field | Value |
| --- | --- |
| Description | In the existing on-demand load `useEffect` at `src/components/editor/Editor.tsx:129`, immediately after `tauriApi.readFile(filePath)` returns, fire `tauriApi.renderMarkdownPreview(filePath, projectRoot, theme)` in parallel and stash the HTML on the tab via `setPreview` + flip `previewState` to `ready`. Log a new `previewMs` field on the existing `[perf:tab-load]` line. Only fires for `fileType === "markdown"`. |
| Complexity | M |
| Category | frontend |
| Depends on | #4, #8 |
| Files | `src/components/editor/Editor.tsx` |

### #10 — Defer `loadRawMarkdownIntoEditor` until preview paints

| Field | Value |
| --- | --- |
| Description | In `src/hooks/useEditorTabSwitch.ts`, when a fresh load is needed AND `tab.previewHtml` is present, render the preview first (handled by #11 in the render branch), then schedule `loadRawMarkdownIntoEditor(editor, tab.content)` inside `requestIdleCallback` with a 200 ms timeout fallback. Use `setTimeout(fn, 0)` fallback for WKWebView. After `setContent`, call `setPreviewState(tabId, "hydrated")` so the render branch swaps from `<MarkdownPreview>` to live `<EditorContent>`. Verify via DevTools that the preview's first paint frame lands BEFORE `setContent`'s long task. |
| Complexity | M |
| Category | frontend |
| Depends on | #5, #8, #11 |
| Files | `src/hooks/useEditorTabSwitch.ts` |

### #11 — Preview→editor swap in render branch

| Field | Value |
| --- | --- |
| Description | In `src/components/editor/Editor.tsx` main render, before the `<EditorContent>` mount, branch on `activeTab.previewState`. While `loading` or `ready`, render `<MarkdownPreview html={activeTab.previewHtml!} contentWidth={contentWidth} presets={editorStylesPresets} />` inside the same `scrollAreaRef` container. While `hydrated` (or `idle` for legacy/non-markdown), render the live Tiptap `<EditorContent>`. The swap is a child swap inside the SAME scroll wrapper — no scroll reset, no remount of the wrapper, no layout shift. The cached-EditorState restore branch in `useEditorTabSwitch` skips preview entirely (cache is already there). |
| Complexity | M |
| Category | frontend |
| Depends on | #5, #8 |
| Files | `src/components/editor/Editor.tsx` |

---

## M1.4 Polish (2 tasks)

### #12 — Theme reactivity

| Field | Value |
| --- | --- |
| Description | When the user toggles light/dark while a preview is on screen, re-fire `renderMarkdownPreview` with the new theme and replace `previewHtml`. Only acts while `previewState === "loading"` or `"ready"` — `hydrated` means the editor has taken over and the preview is unmounted. Subscribe in a small `useThemedPreview` hook or inline in `Editor.tsx`. |
| Complexity | S |
| Category | frontend |
| Depends on | #9 |
| Files | `src/components/editor/Editor.tsx` |

### #13 — Discard preview on tab close

| Field | Value |
| --- | --- |
| Description | On `closeTab`, ensure `previewHtml` is dropped from memory. Implicit if the field lives directly on the tab object (already removed when the tab is removed); explicit only if the HTML gets memoized in a separate map. Verify by closing a tab with a large preview and checking heap snapshot in DevTools. |
| Complexity | S |
| Category | frontend |
| Depends on | #8 |
| Files | `src/stores/editor-store.ts` |

---

## M1.5 Screenshot fidelity tests (3 tasks)

### #14 — Fixture set for diff tests

| Field | Value |
| --- | --- |
| Description | Pick or generate 4 fixtures in `tests/fixtures/preview-fidelity/`: small mixed (≈5 KB, headings/lists/code/inline formatting), table-heavy (≈50 KB, ≥10 tables with metadata + aggregation), code-block-heavy (≈50 KB, multi-language syntax highlighting), and a public-safe excerpt of the 506 KB book (≤100 KB, no personal data). All committed. |
| Complexity | S |
| Category | test |
| Depends on | none |
| Files | `tests/fixtures/preview-fidelity/*.md` |

### #15 — Playwright screenshot diff infra

| Field | Value |
| --- | --- |
| Description | New `e2e/preview-fidelity.spec.ts`. For each fixture: open in Notesage (mocked Tauri IPC), capture preview render via `toHaveScreenshot`, hydrate the editor, capture editor render, assert <2 % pixel diff outside the caret mask. Run at 1× and 2× DPR, light + dark mode (8 combinations per fixture, 32 total). Use Playwright's per-test screenshot-diff threshold and `mask` regions for the caret position. Cache baseline screenshots in `e2e/__screenshots__/preview-fidelity/`. This is the hard fidelity acceptance criterion from the PRD. |
| Complexity | L |
| Category | test |
| Depends on | #11, #14 |
| Files | `e2e/preview-fidelity.spec.ts`, `playwright.config.ts` if updates needed, `e2e/__screenshots__/preview-fidelity/` |

### #16 — Known-divergence allowlist

| Field | Value |
| --- | --- |
| Description | Document accepted gaps in the diff test mask: `#tag`, `@mention`, `//YYYY-MM-DD` text runs (rendered as plain text in preview, decoration pills in editor); chart and excalidraw fenced code blocks (rendered as syntax-highlighted code in preview, replaced by node-views in editor). Either mask those text runs in `e2e/preview-fidelity.spec.ts` or skip the chart-heavy fixture entirely. Add a comment in `MarkdownPreview.tsx` linking back to the PRD's "Fidelity gaps to manage" section. |
| Complexity | S |
| Category | test |
| Depends on | #15 |
| Files | `e2e/preview-fidelity.spec.ts`, `src/components/editor/MarkdownPreview.tsx` |

---

## M1.6 Measurement gate & rollout (3 tasks)

### #17 — DevTools Timeline before/after capture

| Field | Value |
| --- | --- |
| Description | Record the 506 KB book pre-Phase-1 (current tip of `feat/large-file-instant-load`) and post-Phase-1 (after #11 lands), both at the same window size, same theme, same cold-cache state. Methodology already locked: 3 instruments (JavaScript & Events with stack traces, Layout & Rendering, Screenshots); no Memory or Allocations. Captures stay local (recordings are 130 MB+ and embed personal iCloud paths) — only the extracted numbers go into git. |
| Complexity | S |
| Category | perf |
| Depends on | #11 |
| Files | user-local recordings (NOT committed) |

### #18 — Update `docs/performance-baseline.md`

| Field | Value |
| --- | --- |
| Description | Append a new dated entry under "Load File Performance" with: pre-Phase-1 first-paint time, post-Phase-1 first-paint time, total click→settled time (should be roughly unchanged — Phase 2/3 attack that), commit hash, recording reference noted as user-local path. Never overwrite previous entries — history is the point. |
| Complexity | S |
| Category | docs |
| Depends on | #17 |
| Files | `docs/performance-baseline.md` |

### #19 — Mark Phase 1 quality gates in PRD

| Field | Value |
| --- | --- |
| Description | Tick the Layer 1 functional + fidelity boxes in the PRD's Quality Gates section. Add a one-paragraph "Phase 1 — landed" note at the bottom of the PRD referencing this task file and the new baseline entry. Update the table at the top of the task file: status `Not started` → `Landed`. Memory entry (`project_large_file_instant_load.md`) — flip "ready for Phase 1" to "Phase 1 landed; Phase 2 next." |
| Complexity | S |
| Category | docs |
| Depends on | #18 |
| Files | `docs/prds/2026-05-03-large-file-instant-load.md`, this task file, memory entry |
