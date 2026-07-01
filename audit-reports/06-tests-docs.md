# Audit 06 — Test Coverage & Documentation Drift

Date: 2026-06-03 · Repo: /home/user/notesage · Read-only audit.

---

## Part A — Test Coverage

### Inventory (actual, measured)

| Type | Command | Count |
| --- | --- | --- |
| Unit test files (Vitest) | `pnpm test` | **298** files, **~5016** `it()/test()` cases |
| Perf benchmark files | `pnpm test:perf` | 7 |
| Playwright E2E specs | `pnpm test:e2e` | **18** specs (app-loads, chat, command-bar/*, editor/*, file-operations, navigation, preview-fidelity, settings/*, sidebar/*) |
| Real E2E specs (WebDriverIO) | `pnpm test:e2e-real` | **11** specs (command-bar, document-switching, editor, external-changes, navigation, performance, sidebar-pinned, sidebar-recent, sidebar-tree-nav, spike, startup) |
| Rust test files | `cd src-tauri && cargo test` | 44 files containing `#[test]`/`#[tokio::test]` |

Security boundaries are generally well-covered: `sandbox.rs` (28 Rust tests), `path-filter.ts` (`isToolCallAllowed`), `uri-scope.ts`, `acp-utils.ts` (`getChatSandboxScope`), `tauri-capability-surface.test.ts`, and store migrations (`permission-store-migration`, `permission-store-scope`, `chat-store`, `editor-store`, `settings-store`) all have dedicated tests. Markdown round-trip dynamically iterates all 33 fixtures in `tests/fixtures/`.

### Findings

#### A1 — `useTranscriptionJob.ts` orchestrator is completely untested
- **Severity:** High
- **Location:** `src/hooks/useTranscriptionJob.ts` (no `*.test.ts`)
- **Evidence:** This is the documented background orchestrator (capture-stop → whole-file transcribe → render note → bundle → move-to-project), mounted in `App.tsx`. It coordinates async job state, `transcription-progress` event filtering by `jobId`, and bundle relocation. `find src -name "useTranscriptionJob.test.*"` returns nothing.
- **Impact:** The core meeting-recording feature's state machine (the four-state lifecycle in ai-workflows.md) has zero regression protection. A `jobId` mismatch, a partial-progress crash, or a failed bundle move would ship silently.
- **Fix:** Add `src/hooks/__tests__/useTranscriptionJob.test.ts` mocking `transcribe_file` + the progress event bus; assert state transitions, jobId-scoped progress routing, and that a failed transcribe leaves the bundle re-runnable in the inbox.

#### A2 — `useFileWatcherIntegration.ts` (external-change auto-reload vs diff-review branch) untested
- **Severity:** High
- **Location:** `src/hooks/useFileWatcherIntegration.ts` (no test)
- **Evidence:** `useFileWatcher` and `useFileRenameSync` are tested, but the integration hook that actually decides — based on `settings.externalChangeDiffReview` — between silent auto-reload (data-loss path for dirty tabs) and the sticky Accept/Reject/Dismiss inline-diff path has no test.
- **Impact:** This is the exact branch where in-memory edits on a dirty tab can be lost (OFF path). A regression flipping the default or mis-routing the dirty case is a silent data-loss bug with no test gate.
- **Fix:** Test both `externalChangeDiffReview` states against clean and dirty tabs; assert `toastExternalReload` vs `external-change-store.addChange` + `toastExternalChange` are called appropriately.

#### A3 — Round-trip test reconstructs a bespoke extension set instead of the production editor config
- **Severity:** Medium
- **Location:** `src/lib/__tests__/markdown-roundtrip.test.ts` (lines ~19–44)
- **Evidence:** The test hand-assembles `StarterKit + Table + Callout + Drawing + Chart + …`. The production editor extension list lives in `src/hooks/useEditor.ts` / editor config. The two can drift: a new node added to production (e.g. Mermaid, page-break variants) won't be exercised by round-trip unless someone also edits this test's import list.
- **Impact:** The "#1 spec requirement" round-trip gate can pass while a production-only node silently fails to serialize. The test protects a *parallel* editor, not the real one.
- **Fix:** Export the production extension array from a shared module and import it in both `useEditor` and the round-trip test, so the set is single-sourced.

#### A4 — `network_proxy.rs` domain-filtering has thin coverage (7 tests for a security-critical proxy)
- **Severity:** Medium
- **Location:** `src-tauri/src/commands/network_proxy.rs`
- **Evidence:** Only 7 `#[test]`/`#[tokio::test]` for the layer-2 domain allowlist enforcement (the documented kernel-bypass-prevention proxy). The auto-deny-timeout (30s), the dedup/rate-limit logic, and subdomain-matching edge cases are the kind of thing that needs adversarial cases (e.g. `evil-api.anthropic.com.attacker.com` should NOT match `api.anthropic.com`).
- **Impact:** A domain-matching bug (suffix vs exact) would let an agent exfiltrate to a lookalike domain — a real network-isolation hole — with no failing test.
- **Fix:** Add allowlist-matching tests with lookalike/suffix-confusion domains and a wildcard-abuse case.

#### A5 — `capability-surface` test omits the `http:default` allowlist assertion
- **Severity:** Low
- **Location:** `src/lib/__tests__/tauri-capability-surface.test.ts`
- **Evidence:** The test correctly locks `assetProtocol.scope` (no `**`) and the absence of `fs:allow-*`. But CLAUDE.md/architecture.md state the `http:default` allowlist is "scoped to the Notesage GitHub release endpoint" — the test does not assert the http scope is narrow, so a future widening to `https://**` would pass.
- **Impact:** Capability-regression lock has a gap on the documented HTTP-scope hardening.
- **Fix:** Add an assertion that `http:default` (or the http permission scope in `capabilities/default.json`) does not contain a wildcard host.

---

## Part B — Documentation Drift

The single largest theme: the docs describe the **pre-sidebar-simplification (#20)** Quiet Composer and a **v0.39.1** release, while the code is at **v0.46.0-alpha.12** with TreeOverlay deleted and a new Folders sidebar section. CLAUDE.md, architecture.md, design-system.md, editor.md, and workspace.md were never updated after sidebar task #20 — only keyboard-shortcuts.md and product-description.md partially were, producing internal contradictions.

#### B1 — Version mismatch: docs say 0.39.1, code is 0.46.0-alpha.12
- **Severity:** High
- **Location:** `CLAUDE.md` ("Current version: 0.39.1"), `docs/product-description.md` (x2: "Current version: 0.39.1") → `package.json` `"version": "0.46.0-alpha.12"`
- **Mismatch:** Seven minor versions and an alpha pre-release channel behind. `tauri.conf.json` correctly references `../package.json`, so the build is 0.46; only the human-maintained docs are stale.
- **Impact:** Spec-as-truth docs misreport the shipping version; release tooling and any "what version am I on" reasoning is wrong. The alpha channel (note new `alpha_update.rs` command) isn't mentioned anywhere in docs.
- **Fix:** Bump the version string in CLAUDE.md and product-description.md; add a note that the project is on an alpha pre-release channel.

#### B2 — TreeOverlay documented as a live surface but deleted in code (sidebar #20)
- **Severity:** High
- **Location:** `docs/architecture.md` (lists `TreeOverlay.tsx`, `tree-overlay-store`, `useTreeOverlayStore`, `[perf:tree-overlay]`), `docs/design-system.md` ("### Tree Overlay (⌘⇧E)" full section), `docs/features/editor.md` ("the TreeOverlay (⌘⇧E)"), `docs/features/workspace.md` ("reached on demand via the TreeOverlay") → no `src/components/sidebar/quiet/TreeOverlay.tsx`, no `src/stores/tree-overlay-store.ts`.
- **Mismatch:** Code comments confirm removal: `ProjectsSection.tsx:19` "useTreeOverlayStore was removed by sidebar-simplification task #20", and a guard test `no-tree-overlay.test.ts` exists to prevent re-introduction. `keyboard-shortcuts.md` *already* documents the removal ("REMOVED in sidebar-simplification task #20"), directly contradicting the four docs above.
- **Impact:** Four spec docs describe a removed component plus a removed store and a perf category that no longer fires. An engineer following architecture.md would try to wire `useTreeOverlayStore` and hit the regression-guard test.
- **Fix:** Remove TreeOverlay/`tree-overlay-store`/`useTreeOverlayStore`/`[perf:tree-overlay]` from architecture.md, design-system.md, editor.md, workspace.md. Replace with the inline `→`-expand pattern that superseded it.

#### B3 — Sidebar section list wrong everywhere: actual order has a Folders section
- **Severity:** High
- **Location:** `docs/design-system.md` ("Pinned → Projects → Recent → Tags → Mentions"), `docs/architecture.md` (quiet sidebar file list), `docs/features/workspace.md` ("Five stacked sections — Pinned, Projects, Recent, Tags, Mentions") → `src/components/sidebar/quiet/QuietSidebar.tsx:203-215` renders **six**: `PinnedSection`, `ProjectsSection`, `FoldersSection`, `RecentSection`, `TagsSection`, `MentionsSection`.
- **Mismatch:** `FoldersSection.tsx` exists and is rendered; docs (and the component's own stale docstring at QuietSidebar.tsx:19-20) still say "five sections" with no Folders. There is also an undocumented `folder-appearance-store.ts`.
- **Impact:** The canonical sidebar architecture is wrong; new contributors won't know Folders exists or which store backs it.
- **Fix:** Update all three docs to six sections; document `FoldersSection.tsx` and `folder-appearance-store.ts` (add to the architecture store table). Fix the QuietSidebar docstring too.

#### B4 — `sync-store` documented but does not exist
- **Severity:** Medium
- **Location:** `docs/architecture.md` store table — "`sync-store` | iCloud sync settings | Disk file (settings JSON)" → no `src/stores/sync-store.ts` (backend `commands/sync.rs` does exist).
- **Mismatch:** The store table lists a `sync-store` Zustand store that isn't present; iCloud sync settings are handled elsewhere (the Rust `sync.rs` command + settings JSON), not a dedicated frontend store.
- **Impact:** The store inventory — used as a map of state ownership — points to a nonexistent file.
- **Fix:** Remove the `sync-store` row or correct it to describe where sync settings actually live.

#### B5 — Test inventory counts are stale by ~3x
- **Severity:** Medium
- **Location:** `docs/architecture.md` — "Test inventory (2026-04-07): 99 unit test files, 5 Playwright E2E specs, 7 real E2E specs. ~2160 total test cases." → actual: **298** unit files, **~5016** cases, **18** Playwright specs, **11** real-e2e specs.
- **Mismatch:** Every number is materially low (files 3x, cases 2.3x, Playwright 3.6x).
- **Impact:** Anyone using the doc to gauge suite size or estimate CI time is off by a large factor; the "as of" date is two months stale.
- **Fix:** Refresh the inventory line with current counts and date, or replace the hardcoded numbers with a pointer to `pnpm test` output.

#### B6 — New Tauri commands undocumented in tauri-commands.md
- **Severity:** Medium
- **Location:** `src-tauri/src/commands/alpha_update.rs` and `src-tauri/src/commands/preview.rs` exist; `docs/tauri-commands.md` documents neither (and architecture.md's command-module inventory omits both).
- **Mismatch:** `alpha_update.rs` backs the alpha update channel (tied to the 0.46-alpha versioning), `preview.rs` is a new command module. Neither appears in the IPC reference.
- **Impact:** The IPC surface doc — explicitly "Tauri command signatures, IPC patterns" — is missing two command modules; the architecture.md module inventory is incomplete.
- **Fix:** Add `alpha_update.rs` and `preview.rs` to the architecture.md `commands/` inventory and document their public commands in tauri-commands.md.

#### B7 — Keyboard-shortcuts.md still maps ⌘⇧E to Export while design/editor/workspace docs map it to TreeOverlay
- **Severity:** Medium
- **Location:** `docs/keyboard-shortcuts.md` (⌘⇧E = "Open Export dialog … TreeOverlay … deleted") vs `docs/design-system.md` / `docs/features/editor.md` / `docs/features/workspace.md` (⌘⇧E = "Tree Overlay")
- **Mismatch:** The same chord is documented for two different actions across docs because only keyboard-shortcuts.md was updated post-#20. Code: `useKeyboardShortcuts.ts` still references TreeOverlay handling — needs verification that ⌘⇧E now routes to Export.
- **Impact:** A reader can't tell what ⌘⇧E does; the chord-conflict note in keyboard-shortcuts.md ("overrides the legacy Export chord") is now self-contradictory.
- **Fix:** Reconcile all docs to ⌘⇧E = Export (the post-#20 reality) and drop the TreeOverlay chord references.

#### B8 — `editor-store` "openTabs" legacy claim partially stale
- **Severity:** Low
- **Location:** `docs/architecture.md` store table: "`openDocuments[]` — renamed from legacy `openTabs`" → confirmed `editor-store.ts:84` uses `openDocuments`. Doc is *correct* here, but the surrounding prose ("UI surfaces (Quiet Composer) show the document via TitleBar + sidebar, not as tabs") coexists in a table that still says the store "retains 'tab' for the active-id and close action" — accurate, but worth a consistency pass given the broader Tab→Document rename.
- **Mismatch:** Minor — mostly accurate; flagged for the doc-wide "tab" terminology cleanup that B2/B3 will touch anyway.
- **Impact:** Low; terminology confusion only.
- **Fix:** During the sidebar-doc refresh, confirm the openDocuments/activeTabId naming description still matches.

---

## Recommended priority order
1. B1 (version) + B2/B3/B7 (TreeOverlay + Folders sidebar) — these are the spec docs most likely to mislead an engineer today.
2. A1, A2 — untested high-risk async/data-loss hooks.
3. B4, B5, B6 — inventory/store/command accuracy.
4. A3, A4 — strengthen round-trip single-sourcing and proxy adversarial tests.
5. A5, B8 — low-severity hardening/cleanup.
