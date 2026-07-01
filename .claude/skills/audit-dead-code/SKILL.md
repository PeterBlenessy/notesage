---
name: audit-dead-code
description: Audit for unused exports, dead code, unused dependencies, and deprecated code
user-invocable: true
---

# Audit: Dead Code & Dependency Health

Find unused code and problematic dependencies. This is a research-only audit — do not modify any code.

## What to Search For

### Orphaned Files (do this FIRST — highest-yield)

A file with zero importers anywhere is dead regardless of what it exports.

1. For every non-test `.ts`/`.tsx` in `src/`, run
   `grep -rln "<basename-without-ext>" src` and exclude the file itself and
   `*.test.*`. Zero hits ⇒ orphan candidate.
2. Confirm by also checking dynamic imports and string references
   (`import('...<basename>')`, lazy routes) — see §"Avoiding False Positives".
3. Report orphans with line counts; a 491-line orphaned ProseMirror plugin is
   worth far more than a 20-line one.
4. After listing orphans, cross-check them against any documented inventory
   (e.g. the editor-architecture.md extension table). A file listed as ACTIVE in
   the docs but with zero importers is BOTH dead code AND doc drift — report it
   in both lights and recommend the doc row be dropped alongside the file.

### Unused Exports (per-name, for partially-used files)

For files that DO have importers, find individual exports never imported:

1. Grep for all `export function`, `export const`, `export interface`, `export type`, `export default` declarations
2. For each export, search for imports of that name across the codebase
3. Flag exports with zero imports (excluding the file that defines them)

Exclude: `src/components/ui/` (shadcn/ui — may be used on-demand), `.d.ts` files, test files.

### Deprecated Code Still in Use

- Find `@deprecated` JSDoc tags and `#[deprecated]` Rust attributes
- Check if the deprecated items are still called/imported anywhere
- Flag deprecated items still actively used — BUT distinguish two cases:
  - **Migration fallback (NOT dead):** a deprecated field/store retained as the
    documented fallback behind a newer field, or a v1→vN one-time migration path.
    These are intentional; verify against the docs before flagging. Record them
    as a non-finding to prevent re-litigation in future audits (e.g. a
    `startMessageIndex` retained behind `startMessageId`, or a v1 `ai-store` kept
    as a migration/fallback).
  - **True debt:** a deprecated item with a completed migration and no remaining
    reason to exist — recommend removal.
- For a rename migration, confirm completeness by grepping the OLD name: zero
  stragglers means the rename is done and the compatibility shim (if any) can go
  (e.g. an `openTabs` → `openDocuments` rename verified at 0 stragglers).

### Unreachable Code

- Find `return` statements followed by code on subsequent lines
- Find conditions that are always true/false (e.g., checking a type that's already narrowed)
- Find `if (false)` or feature flags that are permanently off

### Unused Dependencies (npm)

1. Read `package.json` dependencies and devDependencies
2. For each dependency, search for imports of that package across `src/` and config files
3. Flag packages that are never imported

**Common false positives to exclude:**
- Tailwind plugins (used in config, not imported)
- Vite plugins (used in `vite.config.ts`)
- Type packages (`@types/*` — used implicitly)
- PostCSS plugins
- Tauri CLI packages

- **Transitively-redundant direct deps:** A dependency can have ZERO direct
  imports yet still resolve because a parent package re-bundles it. For each
  dep with zero `src/` imports, check `pnpm-lock.yaml` to see whether it is
  already a transitive dep of a package you DO import directly. If so, flag the
  direct entry as redundant — removal is safe because it still resolves
  transitively. Verify with `pnpm install` + `pnpm typecheck` after removal.
  This is common when a meta-package (a starter-kit, a framework bundle) absorbs
  what used to be separate add-on packages across a major version bump (e.g.
  `@tiptap/extension-underline`/`-link`/`-list-keymap` absorbed by a newer
  `@tiptap/starter-kit`).
- **Phantom-feature deps:** A dependency with zero references in BOTH `src/` and
  `src-tauri/` (no Cargo dep, no capability grant) often signals a feature that
  was planned but never wired. Cross-check the docs/roadmap — if the docs say
  the feature "never shipped" or "was removed," the dep is a false signal that
  the capability is present. Flag for removal (e.g. a
  `@tauri-apps/plugin-global-shortcut` left behind by a Quick Capture feature
  that never shipped).

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

### Unused Dependencies (Cargo)

1. Read `src-tauri/Cargo.toml` dependencies
2. For each crate, search for `use <crate>` or `<crate>::` across `.rs` files
3. Flag crates that appear unused.
4. **Referenced-but-inert plugins:** For Tauri plugin crates that ARE referenced
   only by a `.plugin(<crate>::init())` line, verify the plugin's IPC commands
   are actually reachable — check `capabilities/*.json` for a matching
   `<plugin>:allow-*` grant AND check the renderer imports
   `@tauri-apps/plugin-<name>`. A plugin that is initialized but neither granted
   nor imported is dead weight that widens the attack surface the capability
   lock-down is closing — flag it for removal (e.g. a `tauri_plugin_fs::init()`
   line with no `fs:allow-*` grant and zero renderer imports).

**Common false positives:** proc-macro crates (used via `#[derive]`), `serde`
features, build dependencies, and crates whose only use is a `#[derive]` or a
sidecar/managed-state registration.

### Outdated Dependencies

If `pnpm outdated` or `cargo outdated` is available, run it and report:
- Major version updates (breaking changes — flag as MEDIUM)
- Security-sensitive packages with updates (flag as HIGH)

### Heavy Transitive Dependencies

Check if any direct dependency pulls in a disproportionately large dependency tree. Look at `pnpm ls --depth=1` or `cargo tree --depth=1` for packages with many transitive deps.

## Avoiding False Positives

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
  do not flag persisted-store fields kept for migration (see the migration-fallback
  guard above) as dead.
- **Re-export barrels:** A symbol re-exported through an `index.ts` barrel is
  reachable under the barrel path, not the original file path. Resolve barrels
  before declaring zero importers.

## Output Format

```markdown
### Unused Exports

| Export | File | Type |
| --- | --- | --- |
| `formatDate` | `src/lib/utils.ts:45` | function |

### Unused Dependencies

| Package | In | Notes |
| --- | --- | --- |
| `lodash` | package.json | No imports found |
```

## Example Finding

### LOW: Deprecated `personaId` field still referenced in 3 files

**Files:** `src/stores/ai-store.ts:12`, `src/hooks/useAIOperations.ts:45`, `src/stores/project-metadata-store.ts:8`

The `personaId` field is marked `@deprecated` (replaced by `agentName` in the addressable agents migration) but is still referenced in 3 files. These references are migration-related and may be intentional, but should be verified.
