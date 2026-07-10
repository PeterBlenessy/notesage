# Test-Coverage Audit — 2026-07-08

**Method:** static inspection (ripgrep/glob + reading representative test bodies). The full suite / coverage runs were intentionally not executed. All counts re-measured, not taken from docs. Report-only.

**Headline:** the *test suite* is large, mature, and — for security boundaries — genuinely strong. The *coverage gate*, however, is effectively non-enforcing: Istanbul instruments only files a test imports (72 of 628 source files ≈ 11%), all thresholds are 0, and `coverage-check.sh` is warning-only and silently skips files absent from the baseline. So the healthy-looking baseline % overstates protection, and every untested module below is invisible to the metric.

**Follow-up (2026-07-10):** nearly every finding below has since been actioned by a batch of coverage PRs:

| Finding | Resolved by |
| --- | --- |
| §3 / rec 1–2 — coverage gate effectively non-enforcing | **#549** (instrument the full tree + flag new-but-uncovered files) |
| §2 / rec 3 — round-trip "#1 gate" hand-lists extensions (Mermaid escapes) | **#546** |
| §2 / rec 4 — `markdown-html-converters.ts` node-id/annotation converters | **#548** |
| §2 / rec 5 — agent-task / acp extracted-function fail/cancel branches | **#547** |
| rec 6 — `cmd/` FloatingCommandBar split hooks + resize handles | **#552** |
| rec 7 — `chat/message/` segment renderers | **#551** |
| rec 8 — `settings/mcp/` dialogs + `cmd/context/` pills | **#553** |
| rec 9 — `editor-store` v1→v2 migration fixture | **#550** |

**Still open:** the `activity/cards/` render logic (§2 table) — the one refactor-split directory still without a dedicated test.

---

## 1. Test Inventory

| Type | Files | Tests/Cases | Location |
| --- | --- | --- | --- |
| Unit (TypeScript, Vitest) | 384 | 5,715 | `src/**/*.test.ts(x)` |
| Round-trip (markdown) | (subset of above) | ~dozens | `src/lib/__tests__/markdown-roundtrip.test.ts`, `callout-markdown`, `link-preview-markdown`, `mermaid-markdown`, `src/workers/__tests__/` |
| Rust unit | 64 | 926 | `src-tauri/src/**` (`#[test]` / `#[tokio::test]`) |
| E2E (Playwright, mocked IPC) | 20 | — | `e2e/tests/**/*.spec.ts` |
| E2E-real (WebDriverIO, live app) | 13 | — | `e2e-real/tests/*.test.ts` |
| Perf benchmarks | 8 | — | `src/perf/*.perf.test.ts(x)` (excluded from default run) |

Every test tier exists — there is no missing category. Risk lives in **specific high-value modules with no direct tests** and in a **non-enforcing coverage gate**, not in absent tiers.

---

## 2. Critical Untested Paths

### Security boundaries — verified STRONG (no action needed)

Every security-critical module has a *dedicated, adversarial* test — a genuine strength:

- **`src-tauri/src/commands/sandbox.rs`** — ~45 tests incl. `claude/codex/copilot/gemini_profile_does_not_leak_sibling_agent_configs`, `sensitive_directories_denied`, `read_policy_narrows_keychain_to_login_db_only`, `writable_block_narrowed_to_own_agent`, `unknown_basename_profile_keeps_home_deny_and_deny_last`.
- **`network_proxy.rs`** — `test_domain_matches_no_suffix_bypass` (rejects `evilexample.com` vs `example.com`), `test_host_confusion_detectable`, `test_read_request_head_rejects_oversized_head`.
- **`net_guard.rs`** — blocks private/loopback/metadata IPs + internal IPv6 (incl. the new 2026-07-05 documentation/NAT64 ranges), allows public.
- **`src/lib/ai/path-filter.ts`, `src/lib/tool-executor.ts`** — prefix-project confusion denial (`project-a-extra` vs `project-a`), secure-default deny on missing scope, out-of-scope denial for `add_comments`/`generate_pptx` output paths.
- **`src/lib/ai/uri-scope.ts`** — sibling-project, substring-prefix, and non-file-scheme denial.
- **`src/lib/ai/acp-utils.ts` `getChatSandboxScope`** — 11 project/notes-root/cross-project cases.
- **`tauri-capability-surface.test.ts`** — locks `assetProtocol` scope (no `**`, no `$HOME/**`), asserts `fs:allow-*` empty, `http:default` narrowed to exactly the two GitHub URLs, strict CSP directives, and (new) `process:allow-restart`-only.
- **`permission-store-migration.test.ts`** — old flat approvals → ScopedApproval bucket shape.
- **`persistence-roundtrip.test.ts`** — no API-key/secret material in persisted state.

### Untested / weakly-tested modules (real gaps)

**Refactored directories with zero direct and zero indirect tests:**

| Directory | Source files | Direct tests | Indirect coverage |
| --- | --- | --- | --- |
| `src/components/chat/message/` | 7 (`SegmentRenderer`, `ToolCallLog`, `ActivityLog`, `UserContent`, `AttachmentStrips`, `UserActionButtons`, `ActionIconButton`) | 0 | None |
| `src/components/activity/cards/` | 5 (`AgentTaskCard`, `AutomationCard`, `RecordingCard`, `TranscriptionCard`, `shared`) | 0 | Underlying hooks tested; card render logic not |
| `src/components/cmd/context/` | 5 (`ProjectsPicker`, `CrossProjectScopePill`, `ProviderPill`, `ProviderQuickConfig`, `shared`) | 0 | None — `CrossProjectScopePill` surfaces a security-relevant scope state |
| `src/components/settings/mcp/` | 5 (`AddEditServerDialog`, `ImportDialog`, `McpServerCard`, `ToolRow`, `types`) | 0 | Rust `mcp/validation.rs` covers backend, not this UI |

> **Update (2026-07-10):** `chat/message/` now covered by **#551**; `cmd/context/` and `settings/mcp/` by **#553**. `activity/cards/` remains open.

**FloatingCommandBar split — hooks & resize handles untested:**

- `src/components/cmd/useCommandBarGeometry.ts`, `useCommandBarPrefixState.ts`, `useCommandBarBusWiring.ts` — 0 tests each.
- `src/components/cmd/resize/{ExpandedResizeHandle,TopResizeHandle,PinnedResizeHandle}.tsx` — 0 tests.
- (`prefix-modes.ts` **is** covered by `cmd/__tests__/prefix-modes.test.ts`; the `modes/` renderers are well-tested — 21 test files in `src/components/cmd/**`.)

> **Update (2026-07-10):** the split hooks + resize handles are now covered by **#552**.

**Agent-task / ACP orchestrator splits — only indirect coverage (MEDIUM):**

- `src/hooks/agent-task/` (`run-task.ts`, `task-registry.ts`, `acp.ts`, `direct-api.ts`, `copilot-lsp.ts`, `home-dir.ts`) — no direct tests; composed into `useAgentTaskOperations` (63-case test), so happy paths run but the extracted functions' failure/cancel branches and jobId routing aren't directly asserted.
- `src/hooks/acp/` (`session-config.ts`, `conv-cleanup.ts`, `unresponsive-monitor.ts`, `useEagerAcpSession.ts`, `useAcpAgentGuards.ts`, `inline-generate.ts`) — no direct tests; composed into `useAcpLifecycle` (integration test exists). Same integration-only situation.

**Rust splits — verified COVERED:** `src-tauri/src/commands/acp/tests.rs` (13 tests) and `src-tauri/src/commands/mcp/**` (39 tests: validation 10, config 10, transport 6, types 6, catalog 3, mod 3, state 1).

### Core correctness — mostly covered, one config-drift hazard

- **Markdown round-trip — config drift (MEDIUM).** `markdown-roundtrip.test.ts` (the self-described "#1 spec gate") **hand-assembles a parallel extension array** instead of importing production `workerExtensions` from `src/workers/worker-extensions.ts`. Production `workerExtensions` **includes `MermaidBlock`** (line 524); the round-trip array does not — so Mermaid never goes through the full parse→serialize→compare gate (its converter is tested in isolation in `mermaid-markdown.test.ts`, but not the editor round-trip). Any node added to production silently escapes the gate until someone also edits the test's import list. `worker-extensions.test.ts` already imports the real array for a schema fingerprint — that pattern should be extended to the round-trip test.
- **`src/lib/markdown-html-converters.ts`** (1,091 lines, 26 exports) — common converters are tested via `@/lib/markdown` re-exports. **No visible test:** `stripAnnotationsFromMarkdown`/`applyAnnotationsToEditor`/`injectAnnotationsIntoMarkdown`, `normalizeEmptyTaskItems`, `stripGhostTaskItems`, `stripNodeIdComments`/`applyNodeIdsToEditor`/`injectNodeIdComments`, `extractTableColumnMetadata`/`applyTableColumnMetadata`, `convertTocToHtml`/`restoreTocComments`, `encodeImagePathSpaces`/`decodeImagePathSpaces`. The node-id and annotation round-trip functions are highest-risk (silent comment injection/stripping on save).
- **Chat-store branching/segments — COVERED** (`chat-store-branch-sessions`, `-segments`, `-image-segment`, `chat-store.test.ts` incl. a v3 migration test + branch-resend).
- **Store migrations — COVERED** (permission-store, settings-store `debugLogging`→`logLevel` v0 fixture, chat-store v3). `editor-store` has a `version: 2` migrate but its test exercises only current-shape rehydrate — no v1→v2 fixture (minor gap).
- **Transcription/recording pipeline — COVERED** (`useMeetingRecording`, `useTranscriptionJob`, `useRecording`, `render-transcript`, `recording-time`).

---

## 3. Coverage Tooling State — the biggest systemic gap (HIGH)

The coverage gate is **effectively non-enforcing**, so the baseline overstates protection.

1. **Instruments only imported files.** `vitest.config.ts` sets `provider: 'istanbul'` with **no `all: true` and no `include`** → Istanbul reports only files touched during the run. `coverage-baseline.json` has **72 file entries; the repo has 628 non-test `.ts(x)` source files** (~11%). The headline "70% lines" is 70% *of that 72-file subset*, not the codebase. The ~556 uninstrumented files (including every §2 gap) are invisible.
2. **Thresholds are all 0.** `thresholds: { perFile: true, lines: 0, functions: 0, branches: 0, statements: 0 }` — `pnpm test:coverage` can never fail on low coverage.
3. **`scripts/coverage-check.sh` is warning-only and blind to new files.** Always `exit 0` ("After 2-week observation, change to exit 1"). Per-file it does `if (!baseEntry || !currEntry) continue;` — a newly-added file (i.e. every untested refactor module in §2) is absent from the baseline and **silently skipped**. The gate only catches regressions on files *already* in the baseline.
4. **Baseline freshness.** `coverage-baseline.json` last changed 2026-07-04; `network_proxy.rs` and `tool-executor.ts` changed 2026-07-07. Per (1), split-out files never enter the baseline regardless.

**Net:** CI runs `pnpm test:coverage` + `pnpm coverage:check` (frontend) and `cargo test` (Rust), but the frontend coverage step neither fails a build nor observes most of the tree. The *test suite* is the real safety net; the *coverage gate* is close to a no-op.

---

## 4. Prioritized Recommendations

### Fix now — coverage gate (HIGH, both ~S)

1. ✅ **Done — #549.** **Close the instrumentation gap.** Add `coverage.all: true` + `include: ['src/**/*.{ts,tsx}']` to `vitest.config.ts` so uninstrumented files count as 0% instead of being invisible; regenerate the baseline. This alone surfaces every §2 gap as a measurable number and lets `coverage-check.sh` see new files.
2. ✅ **Done — #549.** **Flag new-but-uncovered files in `coverage-check.sh`.** Change the `if (!baseEntry || !currEntry) continue;` branch so a changed file present in `current` but absent from `baseline` is reported (new files should arrive *with* coverage, not be silently skipped). Optionally flip the observation-period `exit 0` to `exit 1`.

### High-value coverage to add

3. ✅ **Done — #546.** **Single-source the round-trip extension array (MEDIUM, ~S).** Make `markdown-roundtrip.test.ts` import `workerExtensions` instead of hand-listing extensions — immediately brings `MermaidBlock` (and any future node) under the "#1 spec gate." Mermaid parse/serialize can silently break with no gate today.
4. ✅ **Done — #548.** **Unit-test the node-id + annotation converters in `markdown-html-converters.ts` (MEDIUM, ~M).** `stripNodeIdComments`/`injectNodeIdComments`/`applyNodeIdsToEditor` + the annotation trio manipulate HTML comments embedded in saved markdown — a bug corrupts files on save with no current test. Add inject→strip→equal round-trip assertions.
5. ✅ **Done — #547.** **Direct tests for agent-task/acp extracted functions (MEDIUM, ~M).** `run-task.ts` fail/cancel branches, `task-registry.ts` idempotent cleanup + jobId scoping, `acp/conv-cleanup.ts` per-conversation routing, `acp/session-config.ts` `applyFreshSessionConfig`. Now pure/near-pure; today only happy paths get integration coverage via parent hooks — a jobId mismatch or partial failure would ship silently.

### Nice-to-have

6. ✅ **Done — #552.** **`src/components/cmd/` split hooks (LOW-MED, ~M)** — `useCommandBarGeometry`/`PrefixState`/`BusWiring` + the three `resize/*Handle` components; pure geometry/state logic, cheap with `renderHook`.
7. ✅ **Done — #551.** **`src/components/chat/message/` renderers (LOW-MED, ~M)** — at least `SegmentRenderer` and `ToolCallLog` (they branch on segment/tool-call shapes).
8. ✅ **Done — #553.** **`src/components/settings/mcp/` and `cmd/context/` dialogs/pills (LOW, ~M)** — UI validation paths; `CrossProjectScopePill` reflects scope state worth asserting.
9. ✅ **Done — #550.** **`editor-store` v1→v2 migration fixture (LOW, ~S)** — assert the `version: 2` migrate output from an old-shape fixture.

---

## Confirmed Good Patterns

- **Adversarial security tests throughout** — sandbox sibling-config leak prevention, proxy suffix/host-confusion, path-filter prefix-project confusion, secure-default deny, capability-surface allowlist locking. Model coverage for a security-sensitive app.
- **Migration tests feed real old-state fixtures** (permission-store, chat-store v3, settings-store v0).
- **Secret-leak assertions** in `persistence-roundtrip.test.ts`.
- **Rust splits carried their tests through the refactor** — `acp/tests.rs` and the seven-file `mcp/` module each retain dedicated coverage.
- **Transcription/recording pipeline fully covered** across hooks and rendering.
- **Schema-fingerprint test** (`worker-extensions.test.ts`) imports the *real* `workerExtensions` array — the single-sourcing pattern the round-trip test should adopt (rec 3).
