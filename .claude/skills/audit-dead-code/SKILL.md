---
name: audit-dead-code
description: Audit for unused exports, dead code, unused dependencies, and deprecated code
user-invocable: true
---

# Audit: Dead Code & Dependency Health

Find unused code and problematic dependencies. This is a research-only audit — do not modify any code.

## What to Search For

### Unused Exports

Find exported functions, types, interfaces, and components that are never imported elsewhere:

1. Grep for all `export function`, `export const`, `export interface`, `export type`, `export default` declarations
2. For each export, search for imports of that name across the codebase
3. Flag exports with zero imports (excluding the file that defines them)

Exclude: `src/components/ui/` (shadcn/ui — may be used on-demand), `.d.ts` files, test files.

### Deprecated Code Still in Use

- Find `@deprecated` JSDoc tags and `#[deprecated]` Rust attributes
- Check if the deprecated items are still called/imported anywhere
- Flag deprecated items that are still actively used — they should be migrated or the deprecation removed

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

### Unused Dependencies (Cargo)

1. Read `src-tauri/Cargo.toml` dependencies
2. For each crate, search for `use <crate>` or `<crate>::` across `.rs` files
3. Flag crates that appear unused

**Common false positives:** proc-macro crates (used via `#[derive]`), `serde` features, build dependencies.

### Outdated Dependencies

If `pnpm outdated` or `cargo outdated` is available, run it and report:
- Major version updates (breaking changes — flag as MEDIUM)
- Security-sensitive packages with updates (flag as HIGH)

### Heavy Transitive Dependencies

Check if any direct dependency pulls in a disproportionately large dependency tree. Look at `pnpm ls --depth=1` or `cargo tree --depth=1` for packages with many transitive deps.

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
