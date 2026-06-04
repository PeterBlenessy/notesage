# Proposal: improvements to `audit-type-safety` SKILL.md

Grounded in audit `05-types-renderperf.md` (2026-06-03). The skill's `any`-hunting
core was correct but found almost nothing — production has **0 real `any`
annotations and 3 `as any` casts**. The actual exposure the skill never looked for
is **unvalidated structural assertions at trust boundaries** (`invoke<T>`,
`JSON.parse(...) as T`). The proposals below re-point the skill at that, fix one
stale instruction, and add modern runtime-validation judgment.

---

## 1. Stale / incorrect guidance to fix

### 1a. The skill cannot tell the auditor that `any`-counting alone is insufficient

The skill's entire "What to Search For" leads with `any` / `as` / `@ts-ignore` and
never mentions the IPC or JSON-parse boundary — yet the audit's headline (lines
37–43) is that those literal patterns are effectively absent and the real risk is
elsewhere. The skill is structurally blind to its own most important finding.

**Add this framing at the top of "What to Search For"** (new text, no existing text
removed):

> **Before counting `any`: a low `any` count is NOT a clean bill of health.** The
> sharpest type-safety risk in a Tauri + Zustand app is the **trust boundary** where
> runtime data (Rust IPC, `JSON.parse` of disk/LLM/foreign-config data) is *asserted*
> into a type with no runtime check. A codebase can have zero `any` and still be one
> renamed Rust field away from a crash. Audit the boundaries (sections below) with at
> least the same weight as the `any` search.

### 1b. The example finding is misleading — `JSON.parse(line) as any` is not the representative case

Current example (lines 72–89) shows `JSON.parse(line) as any`. The audit found the
real pattern is `JSON.parse(...) as T` (a *named* type, not `any`) — 33 sites (A2,
lines 83–106). The `as any` framing trains the auditor to grep for `any` and miss
the `as ConcreteType` assertions that are the actual problem.

**Replace** the example finding's code (lines 76–79):

```typescript
const data = JSON.parse(line) as any;
const text = data.choices[0].delta.content;
```

**with** the pattern the audit actually flagged (A2):

```typescript
// The dangerous pattern is asserting a CONCRETE type with no runtime check —
// not `as any`. This passes typecheck and crashes far from the parse site.
const parsed = JSON.parse(rawInput) as ToolArgs;   // path-filter.ts — feeds a security gate
const meta = JSON.parse(raw) as ProjectMetadata;   // useProjectMetadata.ts — config from disk
```

And **append** to that example's Fix block (after line 89): "The repo already ships
the correct model: `acp-utils.ts:360 parseRawInput` does `typeof parsed === 'object'
&& parsed !== null` before returning. Cite it as the in-repo reference guard."

---

## 2. New checks to add

### 2a. IPC boundary — `invoke<T>` asserts without runtime validation

*Motivated by A1 (`05-types-renderperf.md` lines 49–79): 170 `invoke<T>` call sites,
sharpest at `src/components/settings/McpServersSettings.tsx:458` (third-party MCP
config) and `src/components/settings/ConnectionCard.tsx:145` (inline ACP session
shape).*

**Add subsection under "What to Search For":**

> ### Untyped IPC return assertions (`invoke<T>`)
>
> `invoke<T>` from `@tauri-apps/api/core` performs **no runtime validation** — `T` is
> a pure compile-time assertion over whatever JSON Rust serialized. Search for
> `invoke<` and `invoke(` across `src/`. For each:
> - **Is `T` an inline literal** (`invoke<{ id; name; … }>('cmd')`) or a named shared
>   type? Inline literals are local hopes — a Rust signature change produces *no*
>   frontend error, so the two sides drift silently. Flag inline-typed call sites and
>   recommend moving the type into the shared wrapper module (`src/lib/tauri.ts`
>   already centralizes file/git — extend to MCP/ACP/AI).
> - **Does the command carry untrusted data?** Commands that surface data Rust read
>   from *foreign sources* — MCP configs imported from Claude Desktop / Cursor / VS
>   Code, anything parsed out of another tool's config file — must be runtime-validated
>   on the frontend (type guard / zod / valibot) and degrade gracefully, not asserted.
>   `McpServersSettings.tsx:458` → `.map((c) => …)` at `:468` is the canonical unsafe case.
>
> Severity: Medium for inline-typed first-party commands (drift risk); raise to
> Medium-High when the payload originates from untrusted external files.

### 2b. `JSON.parse(...) as T` trust boundaries — security-sensitive parses first

*Motivated by A2 (lines 83–106): 33 production `JSON.parse` sites; highest-risk
`src/lib/ai/path-filter.ts:64,193` (tool-call args feeding a filesystem security
gate), `src/hooks/useProjectMetadata.ts:73`, `src/stores/editor-styles-store.ts:147,160`,
`src/lib/ai/structured.ts:79` (LLM-generated output).*

**Add subsection under "What to Search For":**

> ### `JSON.parse(...) as T` (untyped JSON trust boundaries)
>
> Search for `JSON.parse`. Every `JSON.parse(x) as Type` asserts a shape onto parsed
> text with no check. Rank by data provenance, not by frequency:
> 1. **Security-relevant** — parsed value feeds an access/permission decision.
>    `path-filter.ts` parsing tool-call `rawInput` then gating filesystem access is the
>    top case: a malformed parse silently mis-feeds a security gate. Always flag.
> 2. **External/disk data** — project config (`useProjectMetadata`), persisted settings
>    (`editor-styles-store`), document-embedded data (`useExportOperations` chart/drawing
>    scenes). Schema gaps surface as a crash on first property access.
> 3. **Model-generated** — `structured.ts` asserts `JSON.parse(collected) as T` on LLM
>    output. Even grammar-constrained generation can gap the schema; `as T` is a latent crash.
>
> **Fix discipline:** validate the parsed shape with a type guard before use; on failure
> return a safe default + log. Reference the in-repo model `acp-utils.ts parseRawInput`.

### 2c. Prefer the project's typed storage helper over raw `(editor.storage as any)`

*Motivated by A3 (lines 110–125): `src/lib/external-diff.ts:146` uses
`(editor.storage as any).markdown` with an eslint-disable, despite the repo shipping
`getEditorStorage<EditorStorageMarkdown>(editor, 'markdown')` in
`src/lib/editor-storage.ts:41` for exactly this.*

**Add to the "Type Assertions (`as`)" section:**

> **Missed-migration casts:** when a repo ships a typed escape hatch, flag raw casts that
> bypass it. Example: `(editor.storage as any).markdown` in `external-diff.ts:146` should
> be `getEditorStorage<EditorStorageMarkdown>(editor, 'markdown')`. Grep for typed-helper
> names (`getEditorStorage<`) and look for sibling sites still using the raw `as any` +
> eslint-disable form — those are cheap, safe wins.

### 2d. Third-party interop casts — narrow, don't `as any`

*Motivated by A4 (lines 129–144): `DrawingEditor.tsx:285,288` (Excalidraw `libraryItems`,
`onLibraryChange`) and `toc.ts:187` (`ReactNodeViewRenderer(TocView as any, …)`).*

**Add to the "Type Assertions (`as`)" section, under "Acceptable uses":**

> Casting around a third-party library's imperfect types is the *acceptable* category —
> but `as any` there still silences all checking on that prop. Recommend narrowing to the
> smallest correct interop type instead: `libraryItems as ExcalidrawLibraryItems` with a
> local interface, or `as unknown as ComponentType<NodeViewProps>` for a Tiptap node-view
> renderer — so future upstream drift is still caught.

### 2e. Guarded non-null assertions are not defects — don't over-report

*Motivated by A5 (lines 148–159): `.pop()!` / `.shift()!` / `message.timestamp!` are all
inside length guards or preceded by truthy checks; the audit explicitly listed them as
informational, not defects.*

**Add a one-line calibration note to the Output Format section:**

> Non-null assertions (`!`) on `.pop()`/`.shift()`/`.find()` results that sit inside a
> length-guarded loop, or on a value with a preceding truthy check, are **not defects** —
> list them at most as informational with "guarded, cannot throw in practice." Do not
> inflate severity counts with them.

---

## 3. Modern-judgment additions (skill predates these)

### 3a. Runtime validation at the boundary is the actual fix — name the tools

The skill's only fix vocabulary is "define an interface / type guard." The audit's
recurring remedy is **runtime** validation. Add to the skill (new short subsection):

> ### When to recommend a runtime validator (not just a type)
>
> A TypeScript type vanishes at runtime. For data that crosses a trust boundary at
> runtime (IPC, `JSON.parse`, `fetch`, LLM output), the correct fix is a runtime check,
> not a richer compile-time type. Recommend, in order of effort:
> - Hand-rolled type guard (`function isX(v: unknown): v is X`) — zero deps, model is
>   `acp-utils.ts parseRawInput`.
> - `zod` / `valibot` schema with `.safeParse` — for anything with >3 fields or nested
>   shapes (e.g. the MCP-import payload), so you get a parsed value *and* a typed error
>   path, and degrade gracefully instead of throwing.
>
> Pair the validator with `unknown` at the boundary: type the raw result as `unknown`,
> validate, then narrow — never assert straight from `invoke`/`JSON.parse`.
