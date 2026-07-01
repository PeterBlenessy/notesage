# Proposal: Improvements to `audit-dead-code` SKILL.md

Source evidence: `/home/user/notesage/audit-reports/04-architecture-deadcode.md` (2026-06-03 architecture/dead-code pass).
Scope: unused exports, orphaned files, unused deps, unreachable/retained-deprecated code only. Oversized-file/decomposition items are in the `audit-large-files` proposal.

Every change below is traceable to a specific finding. No SKILL.md edits are applied here — this is a draft of proposed changes.

---

## 1. Stale / incorrect guidance to fix

### 1.1 The "unused export" method misses whole-file orphans (the largest real category)

**Current text (SKILL.md lines 14–21):**

```markdown
### Unused Exports

Find exported functions, types, interfaces, and components that are never imported elsewhere:

1. Grep for all `export function`, `export const`, `export interface`, `export type`, `export default` declarations
2. For each export, search for imports of that name across the codebase
3. Flag exports with zero imports (excluding the file that defines them)

Exclude: `src/components/ui/` (shadcn/ui — may be used on-demand), `.d.ts` files, test files.
```

**Problem:** The audit's single biggest dead-code category was **~1,588 lines across 10 fully-orphaned FILES** (B2) — files where zero importers reference the file at all. A per-export name search is both noisier and weaker than a per-file importer check: it can miss a file whose export name collides with a live symbol elsewhere, and it does extra work. The method should lead with a file-level importer sweep, then fall back to per-export.

**Replacement:**

```markdown
### Orphaned Files (do this FIRST — highest-yield)

A file with zero importers anywhere is dead regardless of what it exports.

1. For every non-test `.ts`/`.tsx` in `src/`, run
   `grep -rln "<basename-without-ext>" src` and exclude the file itself and
   `*.test.*`. Zero hits ⇒ orphan candidate.
2. Confirm by also checking dynamic imports and string references
   (`import('...<basename>')`, lazy routes) — see §"Avoiding false positives".
3. Report orphans with line counts; a 491-line orphaned ProseMirror plugin is
   worth far more than a 20-line one.

### Unused Exports (per-name, for partially-used files)

For files that DO have importers, find individual exports never imported:

1. Grep `export function|const|interface|type|default` declarations.
2. Search for imports of that name across the codebase.
3. Flag exports with zero imports (excluding the defining file).

Exclude: `src/components/ui/` (shadcn/ui — may be used on-demand), `.d.ts`,
test files.
```

Cited to B2 — `drag-handle.ts` (491), `GoalTemplateDialog.tsx` (262), `SkillCommandMenu.tsx` (178), `BranchDiffSelector.tsx` (166), `AgentCommandMenu.tsx` (141), `BranchIndicator.tsx` (107), `table-formatting.ts` (61), `project-templates.ts` (48), `DocxPlaceholder.tsx` / `PdfPlaceholder.tsx` (17 each); each verified via `grep -rln <basename> src` excluding self + tests = 0.

### 1.2 Cargo unused-crate method gives false positives for plugin-only crates

**Current text (SKILL.md lines 48–54):**

```markdown
### Unused Dependencies (Cargo)

1. Read `src-tauri/Cargo.toml` dependencies
2. For each crate, search for `use <crate>` or `<crate>::` across `.rs` files
3. Flag crates that appear unused

**Common false positives:** proc-macro crates (used via `#[derive]`), `serde` features, build dependencies.
```

**Problem:** A crate can be *referenced* (`tauri_plugin_fs::init()`) yet still be effectively dead because the capability surface grants it nothing. The current method (`use`/`::` grep) would mark `tauri-plugin-fs` as USED and miss B4 entirely. The check needs a second tier: a referenced-but-inert plugin.

**Replacement (append a tier + expand the false-positive note):**

```markdown
3. Flag crates that appear unused.
4. **Referenced-but-inert plugins:** For Tauri plugin crates that ARE referenced
   only by a `.plugin(<crate>::init())` line, verify the plugin's IPC commands
   are actually reachable — check `capabilities/*.json` for a matching
   `<plugin>:allow-*` grant AND check the renderer imports
   `@tauri-apps/plugin-<name>`. A plugin that is initialized but neither granted
   nor imported is dead weight that widens the attack surface the capability
   lock-down is closing — flag it for removal.

**Common false positives:** proc-macro crates (used via `#[derive]`), `serde`
features, build dependencies, and crates whose only use is a `#[derive]` or a
sidecar/managed-state registration.
```

Cited to B4 — `src-tauri/src/lib.rs:41` `.plugin(tauri_plugin_fs::init())` with no `fs:allow-*` grant and zero `@tauri-apps/plugin-fs` renderer imports; Cargo dep `tauri-plugin-fs = "2"` exists only for this init.

---

## 2. New checks to add

### 2.1 Transitive-redundant npm dependencies (already provided by a parent package)

**Add as a new subsection under "Unused Dependencies (npm)":**

```markdown
- **Transitively-redundant direct deps:** A dependency can have ZERO direct
  imports yet still resolve because a parent package re-bundles it. For each
  dep with zero `src/` imports, check `pnpm-lock.yaml` to see whether it is
  already a transitive dep of a package you DO import directly. If so, flag the
  direct entry as redundant — removal is safe because it still resolves
  transitively. Verify with `pnpm install` + `pnpm typecheck` after removal.
  This is common when a meta-package (a starter-kit, a framework bundle) absorbs
  what used to be separate add-on packages across a major version bump.
```

Cited to B1 — `@tiptap/extension-underline`, `-link`, `-list-keymap`, `-horizontal-rule` (zero direct imports; all transitive deps of `@tiptap/starter-kit@3.23.6`, imported at `useEditor.ts:2`); `@tiptap/extension-bubble-menu`, `-floating-menu` (zero imports; transitive deps of `@tiptap/react@3.23.6`, menus sourced from `@tiptap/react/menus` at `BubbleMenu.tsx:1`).

### 2.2 Phantom-feature dependencies (dep present for a feature that never shipped)

**Add as a new subsection under "Unused Dependencies (npm)":**

```markdown
- **Phantom-feature deps:** A dependency with zero references in BOTH `src/` and
  `src-tauri/` (no Cargo dep, no capability grant) often signals a feature that
  was planned but never wired. Cross-check the docs/roadmap — if the docs say
  the feature "never shipped" or "was removed," the dep is a false signal that
  the capability is present. Flag for removal.
```

Cited to B1 — `@tauri-apps/plugin-global-shortcut` (^2.3.1): zero refs in `src/` and `src-tauri/`, no Cargo dep, no capability grant; docs state Quick Capture / global-shortcut "never shipped."

### 2.3 Test-only files (dead in production, false coverage signal)

**Add as a new subsection (this category is entirely absent from the skill):**

```markdown
### Test-Only Files (dead in production)

A file whose ONLY references come from test files (including `vi.mock(...)` and
dynamic `import()` inside specs) ships nothing — but its tests pass forever
regardless of app correctness, giving a false coverage signal.

1. For each source file, count non-test references vs test references.
2. Flag files with non-test refs = 0 AND test refs ≥ 1.
3. Recommend EITHER re-wiring the production surface that should consume it OR
   deleting both the component and its orphaned test. Before deleting, check
   whether the component was inlined into a still-live sibling (a 40-line icon
   may have been folded into the file that used to import it).
```

Cited to B3 — `src/components/SymbolSearchResults.tsx` (184 lines, only `truncated-filename-tooltips.test.tsx:471` dynamic import) and `src/components/sidebar/SyncedIcon.tsx` (40 lines, only `FileTreeItem.test.tsx:17` `vi.mock`); note the audit's caution that `SyncedIcon` may have been inlined into `FileTreeItem.tsx`.

---

## 3. Modern-judgment additions

### 3.1 Avoiding dead-code false positives (dynamic imports / Tauri commands / Zustand)

**Add as a new subsection "## Avoiding False Positives":**

```markdown
A plain "imports of <name>" grep produces false dead-code calls in this repo.
Before flagging anything, run these guards:

- **Dynamic & lazy imports:** Search for the basename inside `import('...')`
  string literals and lazy-route registrations, not just static `import` lines.
  A file can be live yet have zero static importers.
- **Tauri command registration (Rust):** A `#[tauri::command]` fn is NOT dead
  just because no Rust code calls it — it is invoked from the frontend by name
  string via `invoke('command_name')`. Confirm "unused command" by checking the
  `generate_handler![]` list in `lib.rs` AND grepping the frontend for the
  command-name string. NOTE: counting `#[tauri::command]` vs `generate_handler!`
  entries can differ by a small delta purely from the multiline handler list —
  treat a 1-off delta as a grep artifact, not a dead command, until name-matched.
- **Zustand selectors / store fields:** A store field consumed only via a
  selector arrow (`useStore(s => s.field)`) will not show up as an import of the
  field name. Grep the field name as a property access across the codebase, and
  do not flag persisted-store fields kept for migration (see §3.2) as dead.
- **Re-export barrels:** A symbol re-exported through an `index.ts` barrel is
  reachable under the barrel path, not the original file path. Resolve barrels
  before declaring zero importers.
```

Cited to the audit's "Non-findings" section: the Rust 202-vs-201 command delta explicitly called a "grep artifact, not a dead command" (lines 234), and the verified-clean Zustand/migration retentions (B-section non-findings, lines 235–237).

### 3.2 Distinguish dead deprecated code from intentionally-retained migration fallbacks

**Replace / expand the existing "Deprecated Code Still in Use" subsection.**

**Current text (SKILL.md lines 23–27):**

```markdown
### Deprecated Code Still in Use

- Find `@deprecated` JSDoc tags and `#[deprecated]` Rust attributes
- Check if the deprecated items are still called/imported anywhere
- Flag deprecated items that are still actively used — they should be migrated or the deprecation removed
```

**Replacement (add a guard so legitimate migration fallbacks aren't flagged):**

```markdown
### Deprecated Code Still in Use

- Find `@deprecated` JSDoc tags and `#[deprecated]` Rust attributes
- Check if the deprecated items are still called/imported anywhere
- Flag deprecated items still actively used — BUT distinguish two cases:
  - **Migration fallback (NOT dead):** a deprecated field/store retained as the
    documented fallback behind a newer field, or a v1→vN one-time migration path.
    These are intentional; verify against the docs before flagging. Record them
    as a non-finding to prevent re-litigation in future audits.
  - **True debt:** a deprecated item with a completed migration and no remaining
    reason to exist — recommend removal.
- For a rename migration, confirm completeness by grepping the OLD name: zero
  stragglers means the rename is done and the compatibility shim (if any) can go.
```

Cited to the audit's "Non-findings" (lines 235–237): `startMessageIndex` is the documented v5-migration fallback behind `startMessageId`; `ai-store` is the documented v1 migration/fallback store; the `openTabs` → `openDocuments` rename is verified complete (0 stragglers). All three would be FALSE positives under the current unguarded rule.

### 3.3 Cross-check orphans and dead exports against the docs inventory

**Add as a one-line note under "Orphaned Files":**

```markdown
- After listing orphans, cross-check them against any documented inventory
  (e.g. the editor-architecture.md extension table). A file listed as ACTIVE in
  the docs but with zero importers is BOTH dead code AND doc drift — report it
  in both lights and recommend the doc row be dropped alongside the file.
```

Cited to B2 — `table-formatting.ts` is listed in editor-architecture.md's extension inventory as active but has 0 imports; `drag-handle.ts` appears there (struck-through) yet is 491 lines of unused plugin code. The audit's fix recommends dropping the `TableFormatting`/`DragHandle` rows.
