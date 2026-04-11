# Dependency Upgrades — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-04-11 |
| **Status** | Complete |
| **Audit** | [2026-04-11-dependencies](../audit/2026-04-11-dependencies.md) |
| **Total** | 10 tasks: 6S, 3M, 1L |
| **Suggested order** | Security (#1) → Patch batch (#2) → Minor batches (#3-#6) → Major evaluations (#7-#10) |

**Risks:**

- Tiptap minor upgrade (#4) touches 20 packages — test markdown round-trip and all editor extensions thoroughly
- Major upgrades (#7-#10) should each be a separate branch with full test suite validation
- lucide-react 1.x (#8) may rename icons — TypeScript will catch missing imports but visual review needed

---

## Immediate — Security & Deprecated

### #1 — Replace deprecated @zed-industries/claude-agent-acp ✅

**Description:** Replace `@zed-industries/claude-agent-acp` (deprecated) with `@agentclientprotocol/claude-agent-acp` in package.json. This is a package rename — same API, same binary name, drop-in replacement. Update version from ^0.18.0 to ^0.26.0.

**Acceptance criteria:**

- package.json references `@agentclientprotocol/claude-agent-acp`
- `pnpm install` succeeds
- ACP agent connection still works (spawn, auth, prompt, tool calls)
- No TypeScript errors

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `package.json`, `pnpm-lock.yaml`

---

## Patch Batch — Low Risk

### #2 — Apply all patch-level updates ✅

**Description:** Batch update all packages with patch-level updates available. These are bug fixes only — guaranteed non-breaking per semver.

Packages: react 19.2.5, react-dom 19.2.5, @codemirror/commands 6.10.3, @codemirror/language 6.12.3, @tauri-apps/plugin-http 2.5.8, @tauri-apps/plugin-updater 2.10.1, @tauri-apps/cli 2.10.1, jsdom 29.0.2, recharts 3.8.1, zustand 5.0.12

**Acceptance criteria:**

- `pnpm update --latest` for patch packages
- `pnpm typecheck` passes
- `pnpm test` passes
- App starts and basic editing works

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `package.json`, `pnpm-lock.yaml`

---

## Minor Batches — Low-Medium Risk

### #3 — Upgrade CodeMirror minor versions ✅

**Description:** Upgrade @codemirror/state 6.5.4→6.6.0 and @codemirror/view 6.39.15→6.41.0. Minor versions — new features, non-breaking.

**Acceptance criteria:**

- Code editor (source mode, code files) works correctly
- CodeMirror search panel works
- No regressions in syntax highlighting

**Complexity:** S **Category:** frontend **Dependencies:** #2 **Files:** `package.json`

---

### #4 — Upgrade Tiptap v3.19 → v3.22 (20 packages) ✅

**Description:** Batch upgrade all @tiptap/\* packages from 3.19.0 to 3.22.3. This is a minor version bump across 20 packages. Must be done together as they share internal version dependencies.

**Acceptance criteria:**

- All @tiptap/\* packages at 3.22.3
- Markdown round-trip tests pass (`pnpm test`)
- All editor extensions work (slash commands, tables, callouts, drawings, charts, link previews)
- Bubble menu, toolbar, tab switching all functional
- Undo/redo works across tab switches

**Complexity:** M **Category:** frontend **Dependencies:** #2 **Files:** `package.json`

---

### #5 — Upgrade Tailwind v4.1 → v4.2 ✅

**Description:** Upgrade tailwindcss 4.1.18→4.2.2 and @tailwindcss/vite 4.1.18→4.2.2. Minor version — new utilities, non-breaking.

**Acceptance criteria:**

- App renders correctly in both light and dark mode
- Soft contrast slider still works
- No visual regressions in sidebar, editor, chat panel

**Complexity:** S **Category:** frontend **Dependencies:** #2 **Files:** `package.json`

---

### #6 — Upgrade remaining minor packages ✅

**Description:** Upgrade: @tauri-apps/plugin-dialog 2.6→2.7, @playwright/test 1.58→1.59, @vitest/coverage-istanbul 4.0→4.1, vitest 4.0→4.1, pdfjs-dist 5.4→5.6, react-resizable-panels 4.6→4.9, tailwind-merge 3.4→3.5.

**Acceptance criteria:**

- All tests pass
- PDF viewer works
- Panel resizing works
- Native dialogs (open folder, save file) work

**Complexity:** S **Category:** frontend **Dependencies:** #2 **Files:** `package.json`

---

## Major Upgrades — Evaluation Required

### #7 — Evaluate and upgrade TypeScript 5.8 → 6.0 ✅

**Description:** Upgrade TypeScript to v6.0.2. Run `pnpm typecheck` and fix any new errors surfaced by stricter checks. This is a dev dependency only — no runtime impact.

**Acceptance criteria:**

- `pnpm typecheck` passes with 0 errors
- All tests pass
- No new `@ts-ignore` or `as any` added (fix properly)

**Complexity:** M **Category:** frontend **Dependencies:** #2 **Files:** `package.json`, potentially source files with new type errors

---

### #8 — Evaluate and upgrade lucide-react 0.564 → 1.x ✅

**Description:** Upgrade lucide-react to v1.8.0. The v1.0 release standardized icon naming. Find all lucide-react imports, check for renamed icons, update imports.

**Acceptance criteria:**

- All icon imports resolve (TypeScript catches this)
- Visual review: all icons render correctly in toolbar, sidebar, settings, chat
- No missing or broken icons

**Complexity:** M **Category:** frontend **Dependencies:** #2 **Files:** `package.json`, potentially icon import updates across components

---

### #9 — Evaluate Vite 8 + @vitejs/plugin-react 6 bundle upgrade ✅

**Description:** Research and test upgrading Vite 7.3→8.0 and @vitejs/plugin-react 4.7→6.0 together (both require Node &gt;=22.12, which we have). Test in a branch.

**Acceptance criteria:**

- `pnpm tauri dev` starts successfully
- HMR works (edit a component, see change without reload)
- `pnpm tauri build` produces working binary
- All tests pass
- Tailwind v4.2 compatible with Vite 8

**Complexity:** L **Category:** frontend **Dependencies:** #5 (Tailwind upgrade first) **Files:** `package.json`, potentially `vite.config.ts`

---

### #10 — Add basic-ftp override to silence dev-only audit warning ✅

**Description:** Add `"basic-ftp": ">=5.2.2"` to pnpm overrides in package.json to resolve the 2 HIGH audit warnings. These are dev-only (WebDriverIO transitive) and not in production, but the override silences `pnpm audit` for cleaner CI output.

**Acceptance criteria:**

- `pnpm audit` reports 0 vulnerabilities
- Real E2E tests still pass (`pnpm test:e2e-real`)

**Complexity:** S **Category:** frontend **Dependencies:** None **Files:** `package.json`