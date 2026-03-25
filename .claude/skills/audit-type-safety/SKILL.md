---
name: audit-type-safety
description: Audit for type system abuse — any types, unsafe casts, missing types, ts-ignore
user-invocable: true
---

# Audit: Type Safety

Audit TypeScript and Rust code for type system abuse that could cause runtime errors. This is a research-only audit — do not modify any code.

## What to Search For

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

**Acceptable uses:** `as const`, `as keyof typeof`, DOM element casts after `querySelector` with null check.

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

## Output Format

For each finding:

```markdown
### <SEVERITY>: <Short title>

**File:** `<path>:<line>`

<What type safety issue exists and what runtime error it could cause.>

**Fix:** <Suggested type-safe alternative.>
```

Include counts: "Found N `any` usages, M type assertions, K suppressed errors."

## Example Finding

### MEDIUM: `as any` in AI streaming response handler

**File:** `src/hooks/useAIOperations.ts:245`

```typescript
const data = JSON.parse(line) as any;
const text = data.choices[0].delta.content;
```

Parsing streaming SSE data as `any` — if the response shape changes, this silently produces `undefined` instead of a type error.

**Fix:** Define an interface for the streaming response shape and use a type guard:
```typescript
interface StreamChunk {
  choices: Array<{ delta: { content?: string } }>;
}
function isStreamChunk(data: unknown): data is StreamChunk { ... }
```
