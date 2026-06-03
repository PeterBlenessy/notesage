---
name: audit-dead-code
description: Audit for unused exports, dead code, unused dependencies, and deprecated code
user-invocable: true
---

# Audit: Dead Code

Find unused and dead code. This is a research-only audit — do not modify any code.

Dependency health (unused, outdated, heavy, vulnerable dependencies) is covered by `/audit-dependencies` — do not duplicate it here.

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

## Output Format

```markdown
### Unused Exports

| Export | File | Type |
| --- | --- | --- |
| `formatDate` | `src/lib/utils.ts:45` | function |
```

End with a `### Confirmed Good Patterns` section.

## Example Finding

### LOW: Deprecated `personaId` field still referenced in 3 files

**Files:** `src/stores/ai-store.ts:12`, `src/hooks/useAIOperations.ts:45`, `src/stores/project-metadata-store.ts:8`

The `personaId` field is marked `@deprecated` (replaced by `agentName` in the addressable agents migration) but is still referenced in 3 files. These references are migration-related and may be intentional, but should be verified.
