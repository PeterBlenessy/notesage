---
name: audit-type-safety
description: Audit for type system abuse — any types, unsafe casts, missing types, ts-ignore
user-invocable: true
---

# Audit: Type Safety

Audit TypeScript and Rust code for type system abuse that could cause runtime errors. This is a research-only audit — do not modify any code.

## What to Search For

> **Before counting `any`: a low `any` count is NOT a clean bill of health.** The sharpest type-safety risk in a Tauri + Zustand app is the **trust boundary** where runtime data (Rust IPC, `JSON.parse` of disk/LLM/foreign-config data) is *asserted* into a type with no runtime check. A codebase can have zero `any` and still be one renamed Rust field away from a crash. Audit the boundaries (sections below) with at least the same weight as the `any` search.

### `any` Usage (TypeScript)

Search for `: any`, `as any`, `<any>`, and `any[]` in `.ts` and `.tsx` files. For each occurrence:
- Is it justified? (e.g., third-party library without types, complex generic inference)
- Could it be replaced with `unknown` + type narrowing?
- Could a proper interface/type be defined?

Exclude `node_modules/`, generated files, and `.d.ts` vendor declarations.

### Type Assertions (`as`)

Find `as` casts, especially:
- `as any` — completely bypasses type checking
- `as SomeType` without prior type narrowing — may be wrong at runtime
- Double casts: `as unknown as SomeType` — usually a sign of fighting the type system

**Acceptable uses:** `as const`, `as keyof typeof`, DOM element casts after `querySelector` with null check. Casting around a third-party library's imperfect types is also the *acceptable* category — but `as any` there still silences all checking on that prop. Recommend narrowing to the smallest correct interop type instead: `libraryItems as ExcalidrawLibraryItems` with a local interface, or `as unknown as ComponentType<NodeViewProps>` for a Tiptap node-view renderer — so future upstream drift is still caught.

**Missed-migration casts:** when a repo ships a typed escape hatch, flag raw casts that bypass it. Example: `(editor.storage as any).markdown` should be `getEditorStorage<EditorStorageMarkdown>(editor, 'markdown')`. Grep for typed-helper names (`getEditorStorage<`) and look for sibling sites still using the raw `as any` + eslint-disable form — those are cheap, safe wins.

### Untyped IPC return assertions (`invoke<T>`)

`invoke<T>` from `@tauri-apps/api/core` performs **no runtime validation** — `T` is a pure compile-time assertion over whatever JSON Rust serialized. Search for `invoke<` and `invoke(` across `src/`. For each:
- **Is `T` an inline literal** (`invoke<{ id; name; … }>('cmd')`) or a named shared type? Inline literals are local hopes — a Rust signature change produces *no* frontend error, so the two sides drift silently. Flag inline-typed call sites and recommend moving the type into the shared wrapper module (`src/lib/tauri.ts` already centralizes file/git — extend to MCP/ACP/AI).
- **Does the command carry untrusted data?** Commands that surface data Rust read from *foreign sources* — MCP configs imported from Claude Desktop / Cursor / VS Code, anything parsed out of another tool's config file — must be runtime-validated on the frontend (type guard / zod / valibot) and degrade gracefully, not asserted (e.g. an MCP-servers settings panel that maps over an inline-typed imported config).

Severity: Medium for inline-typed first-party commands (drift risk); raise to Medium-High when the payload originates from untrusted external files.

### `JSON.parse(...) as T` (untyped JSON trust boundaries)

Search for `JSON.parse`. Every `JSON.parse(x) as Type` asserts a shape onto parsed text with no check — and the dangerous case is asserting a *named concrete type* (not `as any`), which passes typecheck and crashes far from the parse site. Rank by data provenance, not by frequency:
1. **Security-relevant** — parsed value feeds an access/permission decision. A path-filter parsing tool-call `rawInput` then gating filesystem access is the top case: a malformed parse silently mis-feeds a security gate. Always flag.
2. **External/disk data** — project config, persisted settings, document-embedded data (chart/drawing scenes). Schema gaps surface as a crash on first property access.
3. **Model-generated** — structured-output helpers that assert `JSON.parse(collected) as T` on LLM output. Even grammar-constrained generation can gap the schema; `as T` is a latent crash.

**Fix discipline:** validate the parsed shape with a type guard before use; on failure return a safe default + log. Reference the in-repo model `acp-utils.ts parseRawInput` (`typeof parsed === 'object' && parsed !== null` before returning).

### `@ts-ignore` and `@ts-expect-error`

Find all suppressed type errors. For each:
- Is the suppression still necessary? (The underlying issue may have been fixed)
- Is there a comment explaining why?
- Could the code be restructured to avoid the suppression?

### Missing Return Types

Find public functions and custom hooks without explicit return types. Focus on:
- Exported functions in `src/lib/` and `src/hooks/`
- Store action functions
- Tauri API wrapper functions in `src/lib/tauri.ts`

Inferred return types are fine for simple cases, but complex hooks should have explicit types for documentation and refactoring safety.

### Rust Stringly-Typed APIs

Find places in Rust where `String` is used where an enum or newtype would be safer:
- Provider names passed as `String` instead of an enum
- Event names as string literals (typo = silent failure)
- Status values as strings instead of enums

### When to recommend a runtime validator (not just a type)

A TypeScript type vanishes at runtime. For data that crosses a trust boundary at runtime (IPC, `JSON.parse`, `fetch`, LLM output), the correct fix is a runtime check, not a richer compile-time type. Recommend, in order of effort:
- Hand-rolled type guard (`function isX(v: unknown): v is X`) — zero deps, model is `acp-utils.ts parseRawInput`.
- `zod` / `valibot` schema with `.safeParse` — for anything with >3 fields or nested shapes (e.g. an MCP-import payload), so you get a parsed value *and* a typed error path, and degrade gracefully instead of throwing.

Pair the validator with `unknown` at the boundary: type the raw result as `unknown`, validate, then narrow — never assert straight from `invoke`/`JSON.parse`.

## Output Format

For each finding:

```markdown
### <SEVERITY>: <Short title>

**File:** `<path>:<line>`

<What type safety issue exists and what runtime error it could cause.>

**Fix:** <Suggested type-safe alternative.>
```

Include counts: "Found N `any` usages, M type assertions, K suppressed errors."

Non-null assertions (`!`) on `.pop()`/`.shift()`/`.find()` results that sit inside a length-guarded loop, or on a value with a preceding truthy check, are **not defects** — list them at most as informational with "guarded, cannot throw in practice." Do not inflate severity counts with them.

## Example Finding

### MEDIUM: `as any` in AI streaming response handler

**File:** `src/hooks/useAIOperations.ts:245`

```typescript
// The dangerous pattern is asserting a CONCRETE type with no runtime check —
// not `as any`. This passes typecheck and crashes far from the parse site.
const parsed = JSON.parse(rawInput) as ToolArgs;   // path-filter.ts — feeds a security gate
const meta = JSON.parse(raw) as ProjectMetadata;   // useProjectMetadata.ts — config from disk
```

Asserting a named concrete type onto parsed text with no runtime check — if the response shape changes, this silently produces `undefined`/wrong-shaped data instead of a type error, and crashes far from the parse site.

**Fix:** Define an interface for the parsed shape and use a type guard:
```typescript
interface StreamChunk {
  choices: Array<{ delta: { content?: string } }>;
}
function isStreamChunk(data: unknown): data is StreamChunk { ... }
```
The repo already ships the correct model: `acp-utils.ts parseRawInput` does `typeof parsed === 'object' && parsed !== null` before returning. Cite it as the in-repo reference guard.
