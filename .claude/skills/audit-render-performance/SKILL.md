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

**Priority:** Flag top-level/always-visible components first (QuietLayout, QuietSidebar, FloatingCommandBar, FileTreeItem) — their re-renders cascade to all children. Modal/dialog components are lower priority.

Search pattern: Find all `useXxxStore()` calls (no argument) and check if the result is destructured.

### Store Circular Dependencies

Check if any stores import from each other or call `getState()` on each other in their actions. Map the dependency graph. Flag any cycles.

### Missing useMemo

Find expensive computations in render bodies:
- Array `.map()`, `.filter()`, `.reduce()` on large collections without `useMemo`
- Recursive tree traversals
- String parsing or transformation

Only flag if the computation is genuinely expensive (operates on collections or does I/O), not trivial expressions.

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
