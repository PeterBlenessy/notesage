---
name: audit-render-performance
description: Audit for unnecessary re-renders — Zustand subscriptions, missing memoization, inline callbacks
user-invocable: true
---

# Audit: Render Performance & State Management

Search for patterns causing unnecessary re-renders or wasted computation. This is a research-only audit — do not modify any code.

## What to Search For

### Broad Zustand Subscriptions

Find components that destructure from a store hook without a selector:

```typescript
// BAD — subscribes to entire store, re-renders on ANY field change
const { isLoading, activeTool } = useChatStore();

// GOOD — subscribes only to specific fields
const isLoading = useChatStore((s) => s.isLoading);
const activeTool = useChatStore((s) => s.activeTool);
```

**Priority:** Two equally-important fronts. (1) Top-level/always-visible components (QuietLayout, QuietSidebar, FloatingCommandBar) — their re-renders cascade. (2) **Streaming / append-heavy lists** (the chat message list, activity feeds) — these are the genuine hot path: an item that subscribes to a global flag, or renders an unmemoized expensive child (markdown parse, segment grouping), multiplies cost by N items on every flush. Audit list-render loops with the SAME priority as the shell. Modal/dialog components are lower priority.

Search pattern: Find all `useXxxStore()` calls (no argument) and check if the result is destructured.

**Calibration — blast radius:** A whole-array / whole-object subscription is not automatically High. Weigh the actual blast radius: (a) how often the reference changes (a 150ms-debounced write is ~6/sec, not per-keystroke); (b) whether the re-render actually re-renders anything expensive (if ProseMirror, not React, owns the live surface, the shell re-render is cheap); (c) how many entries the array holds (a single-document shell bounds it to 1). When all three are favorable, rate **Low** and recommend narrowing as polish, not as a fix — e.g. `useEditorStore((s) => s.openDocuments.find(d => d.id === s.activeTabId))` with `useShallow`.

### Store Circular Dependencies

Check if any stores import from each other or call `getState()` on each other in their actions. Map the dependency graph. Flag any cycles.

### Missing useMemo

Find expensive computations in render bodies:
- Array `.map()`, `.filter()`, `.reduce()` on large collections without `useMemo`
- Recursive tree traversals
- String parsing or transformation
- **Markdown / syntax / template parsing inside a list item or streaming message** (`ReactMarkdown`, remark/rehype, segment grouping, regex content-stripping). These are not "collections" but are the costliest per-render work in a chat/feed; treat an unmemoized parse in a frequently-rendered component as **High**, not optional.
- **Streaming components:** a plain (non-memo) component that derives data in render (e.g. `groupSegments(segments)`) recomputes on *every* flush of the stream AND on every unrelated re-render the list inflicts on it. Wrap the derivation in `useMemo([...input])` and consider `memo()`-wrapping the component, so it only recomputes when its own input actually changes — not when a sibling/global churn re-renders it.

Only flag if the computation is genuinely expensive (operates on collections, parses, or does I/O), not trivial expressions.

### Missing useCallback

Find event handler functions passed as props to child components that are recreated every render:

```typescript
// BAD — new function every render, child re-renders
<Button onClick={() => handleSave(id)} />

// GOOD — stable reference
const handleClick = useCallback(() => handleSave(id), [id]);
<Button onClick={handleClick} />
```

**Priority:** Only flag when the child component would actually re-render (i.e., it's not trivial DOM). Focus on callbacks passed to memoized components or components rendered in lists.

### useMemo With Unstable Dependencies

Find `useMemo` calls where one or more dependencies are inline arrow functions, objects, or arrays that are recreated every render — this defeats the memoization entirely.

### Inline Object/Array Creation in JSX

Find `style={{...}}` or similar patterns that create new object references every render. Lower priority — only flag in frequently-rendered components (list items, tree nodes).

### Large useEffect Dependency Arrays

Find useEffect hooks with 5+ dependencies. These often fire more frequently than intended. Check if any dependency has unstable identity (array, object, callback).

### Unmemoized expensive children & inline render-prop config

For any component rendered once-per-list-item (markdown bodies, code highlighters, chart renderers), check:
- Is the component `React.memo`-wrapped? An unmemoized markdown/parse component re-runs the full parse on every parent re-render.
- Are its config props **allocated in render**? `remarkPlugins={[remarkGfm]}`, `components={{ a: () => … }}`, `options={{…}}` create a new reference every render and **defeat any internal memoization** the library does — forcing a full re-parse. Hoist static config to module scope (`const REMARK_PLUGINS = [remarkGfm]`); memoize dynamic config with `useMemo` and stabilize embedded callbacks with `useCallback`.

Severity: **High** when this sits under a list item that re-renders on a global flag (see below).

### Per-item subscription to a list-global flag

A `React.memo`-wrapped list item that *also* subscribes to a store field which only the **last/active** item needs (`isLoading`, `isStreaming`, `activeId`) silently defeats its own memo: when that global flips, **every** item re-renders. This is the classic "memo'd but still re-rendering" trap.
- Grep memo'd list-item components for `useXxxStore((s) => s.<globalFlag>)`.
- **Fix:** compute the flag once in the *parent* list (which already knows `isLast`) and pass it down as a prop (`isActivelyStreaming={isLoading && isLast}`), dropping the per-item subscription. Then non-active items never re-render on the transition.

Severity: **High** (multiplies by N items, and by any unmemoized child above).

### Render-loop prop identity & keys

In the list's `.map(...)` body, check:
- **New-object props:** `{ ...item, field: derived }` or any inline object/array passed as a prop creates a fresh reference each render and **defeats `React.memo`** on the child. Precompute the derived item once (`useMemo` keyed on the source array, or move the transform into the store at write time so the field is already clean).
- **In-render parsing:** string/regex work (e.g. `parseQuickReplies(content)`) per item per render — memoize or hoist to the store.
- **`key={index}`:** an array-index key on a list whose order/identity changes (branch switches, reordering) makes React reconcile wrong-to-wrong and **remount** subtrees, losing local state (`copied`, toggles). Use the stable domain id (`key={item.id}`). Note: this is a **correctness** bug, not a perf one — the React Compiler does NOT fix it.

### Module-global closure caches in selectors

Flag any selector that memoizes via a **module-level** mutable closure (`let cached…` captured in an IIFE returning the selector). A single shared cache is a correctness landmine: it only holds while exactly one subscriber renders one entity at a time. Two subscribers at different store snapshots (or React 18/19 concurrent rendering) thrash the cache key back and forth; any future "two side-by-side" view corrupts it. A comment warning "returns a new array → infinite re-renders if reference isn't stable" is the tell.
- **Fix:** store the computed value **on the entity in the reducer** (recompute when its inputs change) so the selector is an O(1) field read returning an already-stable reference; or in the component use `useShallow` over the raw inputs + a local `useMemo`. A module-global closure cache should not be the long-term pattern.

### Imperative-DOM layout thrash (MutationObserver / scroll sync)

The skill's other checks are React-render concerns; this is an imperative one the React Compiler will never fix. Flag autoscroll/measure code that:
- Observes with `subtree: true, characterData: true` — fires on **every text mutation anywhere** in the subtree (i.e. every streamed character), and
- Reads a layout property (`scrollHeight`, `getBoundingClientRect`) then writes one (`scrollTop`) **synchronously in the callback** — a forced reflow per chunk.
- **Fix:** batch the read+write into a single `requestAnimationFrame` (coalesce many mutations into one layout/scroll per frame); narrow the observer to `childList` where possible instead of `characterData` on the whole subtree.

### React 19 / React Compiler scope

If the project adopts the React Compiler, it **auto-memoizes** component bodies and hoists inline allocations — so unmemoized markdown (+ inline `components`/`remarkPlugins`), in-render parsing, and in-render derivations (`groupSegments`) are largely neutralized automatically. **Do NOT defer the following on the assumption the compiler covers them:**
- **Zustand subscription granularity** (over-broad flag, closure cache, whole-array) — the compiler does not touch store-selector shape.
- **`key={index}` reconciliation bugs** — a correctness issue, never a memo one.
- **Imperative-DOM layout thrash** — outside React's render model entirely.

When reporting, label each finding "compiler-covered" or "must-fix-by-hand" so the team doesn't wrongly wave findings away behind a future compiler adoption.

### Zustand selector hygiene (current best practice)

- **Never select a new object/array inline:** `useStore((s) => ({ a: s.a, b: s.b }))` or `useStore((s) => s.items.filter(...))` returns a fresh reference every call and re-renders on every store change. Use **`useShallow`** (`useStore(useShallow((s) => ({ a: s.a, b: s.b })))`) for multi-field selects, or split into atomic selectors.
- **Derived collections** belong in a `useMemo` in the component (over atomic-selected inputs) or precomputed on the entity in the reducer — not recomputed in the selector on every snapshot.
- **`getState()` for read-at-event-time:** when a component needs a store value only inside a callback (e.g. workspace roots at click time), read `useStore.getState()` lazily in the handler instead of subscribing. This removes the subscription from the render path entirely.
- **`useSyncExternalStore`:** when auditing a *hand-rolled* external subscription (a custom store, an event-emitter bridge, a `window`/media-query listener) that uses `useEffect` + `useState` to mirror external state, flag it — the tear-safe, concurrent-correct primitive is `useSyncExternalStore`. (Zustand uses it internally; bespoke subscriptions often don't.)

## Output Format

For each finding:

```markdown
### <SEVERITY>: <Short title>

**File:** `<path>:<line>`

<What's wrong, how many re-renders it causes, and which components are affected.>

**Fix:** <Suggested fix.>
```

End with a `### Confirmed Good Patterns` section noting components that use selectors correctly.

## Example Finding

### HIGH: QuietSidebar — whole-store destructure subscribes to every field

**File:** `src/components/sidebar/quiet/QuietSidebar.tsx`

```typescript
// Illustrative anti-pattern — destructuring the whole store
const { projects, addProject, removeProject, notesTree,
  pendingCreate, pendingCreateProject, setPendingCreate } = useWorkspaceStore();
```

The QuietSidebar is always visible. Destructuring the whole store subscribes the component to every field — any workspace state change (file tree update, project addition, unrelated flag flip) triggers a full re-render of the sidebar and all its children.

**Fix:** Use individual selectors:
```typescript
const explorerFolders = useWorkspaceStore((s) => s.explorerFolders);
const projects = useWorkspaceStore((s) => s.projects);
// ... etc
```
