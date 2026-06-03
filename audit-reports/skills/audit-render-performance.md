# Proposal: improvements to `audit-render-performance` SKILL.md

Grounded in audit `05-types-renderperf.md` (2026-06-03). The skill's
broad-subscription and missing-memo core was directionally right but missed every
*high-severity* finding the audit actually produced — all of which live in the
**streaming chat list** hot path (unmemoized markdown re-parse, a global-flag
subscription on every list item, a module-global selector cache, unstable keys).
The proposals add those check classes, fix two stale priority statements, and add
React-19 / React-Compiler and modern-Zustand judgment.

---

## 1. Stale / incorrect guidance to fix

### 1a. Priority list omits the real hot path: streaming lists

The skill's "Priority" note (lines 26, 56) tells the auditor to flag
"top-level/always-visible components first (QuietLayout, QuietSidebar,
FloatingCommandBar, FileTreeItem)" and treats list items only as a footnote. The
audit's two **High** findings (B1, B2) and three **Medium** findings (B3, B4, B5)
are *all* in the chat message list — a streaming, append-heavy list where one global
flag flip re-parses every message's markdown. The skill's priority ordering would
have deprioritized exactly the findings that mattered.

**Replace** (line 26):

```
**Priority:** Flag top-level/always-visible components first (QuietLayout, QuietSidebar, FloatingCommandBar, FileTreeItem) — their re-renders cascade to all children. Modal/dialog components are lower priority.
```

**with:**

```
**Priority:** Two equally-important fronts. (1) Top-level/always-visible components
(QuietLayout, QuietSidebar, FloatingCommandBar) — their re-renders cascade. (2)
**Streaming / append-heavy lists** (the chat message list, activity feeds) — these
are the genuine hot path: an item that subscribes to a global flag, or renders an
unmemoized expensive child (markdown parse, segment grouping), multiplies cost by N
items on every flush. Audit list-render loops with the SAME priority as the shell.
Modal/dialog components are lower priority.
```

### 1b. "Missing useMemo" guidance underweights re-parsing in lists

Current text (lines 35–42) says flag expensive computation "only if genuinely
expensive (operates on collections or does I/O)." This let the auditor's own intuition
miss B1 — a `ReactMarkdown` parse is neither a collection op nor I/O, but it is *the
single most expensive operation in the chat list* (B1, lines 187–203). Add a
qualifier.

**Append to the "Missing useMemo" list (after line 39):**

> - **Markdown / syntax / template parsing inside a list item or streaming message**
>   (`ReactMarkdown`, remark/rehype, segment grouping, regex content-stripping). These
>   are not "collections" but are the costliest per-render work in a chat/feed; treat an
>   unmemoized parse in a frequently-rendered component as **High**, not optional.

---

## 2. New checks to add

### 2a. Unmemoized expensive child + inline plugin/component config in a list

*Motivated by B1 (lines 172–214): `src/components/MarkdownContent.tsx:13` — not
`React.memo`-wrapped, re-runs `ReactMarkdown`, and allocates fresh
`remarkPlugins={[remarkGfm]}` and a fresh `components={{ a: … }}` object every render.*

**Add subsection:**

> ### Unmemoized expensive children & inline render-prop config
>
> For any component rendered once-per-list-item (markdown bodies, code highlighters,
> chart renderers), check:
> - Is the component `React.memo`-wrapped? An unmemoized markdown/parse component
>   re-runs the full parse on every parent re-render.
> - Are its config props **allocated in render**? `remarkPlugins={[remarkGfm]}`,
>   `components={{ a: () => … }}`, `options={{…}}` create a new reference every render
>   and **defeat any internal memoization** the library does — forcing a full re-parse.
>   Hoist static config to module scope (`const REMARK_PLUGINS = [remarkGfm]`); memoize
>   dynamic config with `useMemo` and stabilize embedded callbacks with `useCallback`.
> Severity: **High** when this sits under a list item that re-renders on a global flag (see 2b).

### 2b. List items subscribing to a global store flag

*Motivated by B2 (lines 217–237): `src/components/chat/ChatMessage.tsx:636` —
every memo'd `ChatMessage` subscribes to global `useChatStore((s) => s.isLoading)`,
which is only relevant to the LAST message; the flag toggles twice per send so all N
messages bypass memo and re-render (and re-parse, compounding B1).*

**Add subsection:**

> ### Per-item subscription to a list-global flag
>
> A `React.memo`-wrapped list item that *also* subscribes to a store field which only
> the **last/active** item needs (`isLoading`, `isStreaming`, `activeId`) silently
> defeats its own memo: when that global flips, **every** item re-renders. This is the
> classic "memo'd but still re-rendering" trap.
> - Grep memo'd list-item components for `useXxxStore((s) => s.<globalFlag>)`.
> - **Fix:** compute the flag once in the *parent* list (which already knows `isLast`)
>   and pass it down as a prop (`isActivelyStreaming={isLoading && isLast}`), dropping
>   the per-item subscription. Then non-active items never re-render on the transition.
> Severity: **High** (multiplies by N items, and by any unmemoized child per 2a).

### 2c. New-object props & unstable `key` in list render loops

*Motivated by B3 (lines 241–272): `src/components/chat/ChatMessageList.tsx:262-265`
spreads `{ ...message, content: stripped }` every render (defeating `ChatMessage`'s
memo for quick-reply messages) and runs `parseQuickReplies` in render; line 283 uses
`key={index}` despite a stable `message.id`.*

**Add subsection:**

> ### Render-loop prop identity & keys
>
> In the list's `.map(...)` body, check:
> - **New-object props:** `{ ...item, field: derived }` or any inline object/array passed
>   as a prop creates a fresh reference each render and **defeats `React.memo`** on the
>   child. Precompute the derived item once (`useMemo` keyed on the source array, or move
>   the transform into the store at write time so the field is already clean).
> - **In-render parsing:** string/regex work (`parseQuickReplies(content)`) per item per
>   render — memoize or hoist to the store.
> - **`key={index}`:** an array-index key on a list whose order/identity changes (branch
>   switches, reordering) makes React reconcile wrong-to-wrong and **remount** subtrees,
>   losing local state (`copied`, toggles). Use the stable domain id (`key={item.id}`).
>   Note: this is a **correctness** bug, not a perf one — the React Compiler does NOT fix it.

### 2d. Module-global / closure-cached selectors

*Motivated by B4 (lines 276–307): `src/stores/chat-store.ts:992-1017` — `selectMessages`
memoizes the active thread in a single module-scoped closure (`cachedThread`,
`cachedKey`), shared by `FloatingCommandBar:266` and `ChatMessageList:62`.*

**Add subsection:**

> ### Module-global closure caches in selectors
>
> Flag any selector that memoizes via a **module-level** mutable closure
> (`let cached…` captured in an IIFE returning the selector). A single shared cache is a
> correctness landmine: it only holds while exactly one subscriber renders one entity at
> a time. Two subscribers at different store snapshots (or React 18/19 concurrent
> rendering) thrash the cache key back and forth; any future "two side-by-side" view
> corrupts it. A comment warning "returns a new array → infinite re-renders if reference
> isn't stable" is the tell.
> - **Fix:** store the computed value **on the entity in the reducer** (recompute when its
>   inputs change) so the selector is an O(1) field read returning an already-stable
>   reference; or in the component use `useShallow` over the raw inputs + a local
>   `useMemo`. A module-global closure cache should not be the long-term pattern.

### 2e. Unmemoized derived computation in a streaming component

*Motivated by B5 (lines 311–328): `src/components/chat/ChatMessage.tsx:528-529` —
`SegmentRenderer` is a plain function component calling `groupSegments(segments)` in
render; during a tool-calling stream `segments` updates every 50ms flush, re-grouping
dozens of times/sec.*

**Add to the "Missing useMemo" section:**

> - **Streaming components:** a plain (non-memo) component that derives data in render
>   (`groupSegments(segments)`) recomputes on *every* flush of the stream AND on every
>   unrelated re-render the list inflicts on it. Wrap the derivation in `useMemo([...input])`
>   and consider `memo()`-wrapping the component, so it only recomputes when its own input
>   actually changes — not when a sibling/global churn re-renders it.

### 2f. MutationObserver / imperative-DOM layout thrash

*Motivated by B7 (lines 355–373): `src/components/chat/ChatMessageList.tsx:108-118`
observes `{ childList: true, subtree: true, characterData: true }` and reads
`scrollHeight` / writes `scrollTop` on every streamed character — forced sync layout per chunk.*

**Add subsection (new check class the skill lacks entirely):**

> ### Imperative-DOM layout thrash (MutationObserver / scroll sync)
>
> The skill's other checks are React-render concerns; this is an imperative one the React
> Compiler will never fix. Flag autoscroll/measure code that:
> - Observes with `subtree: true, characterData: true` — fires on **every text mutation
>   anywhere** in the subtree (i.e. every streamed character), and
> - Reads a layout property (`scrollHeight`, `getBoundingClientRect`) then writes one
>   (`scrollTop`) **synchronously in the callback** — a forced reflow per chunk.
> - **Fix:** batch the read+write into a single `requestAnimationFrame` (coalesce many
>   mutations into one layout/scroll per frame); narrow the observer to `childList` where
>   possible instead of `characterData` on the whole subtree.

### 2g. Whole-array store subscriptions — calibrate by blast radius

*Motivated by B6 (lines 332–351): `src/components/editor/Editor.tsx:93` subscribes to
the whole `openDocuments` array, but the audit rated it **Low** because the 150ms
serialize debounce + ProseMirror-owns-the-document + single-doc shell bound the blast
radius.*

**Add a calibration note to the "Broad Zustand Subscriptions" section:**

> A whole-array / whole-object subscription is not automatically High. Weigh the actual
> blast radius: (a) how often the reference changes (a 150ms-debounced write is ~6/sec,
> not per-keystroke); (b) whether the re-render actually re-renders anything expensive
> (if ProseMirror, not React, owns the live surface, the shell re-render is cheap); (c)
> how many entries the array holds (a single-document shell bounds it to 1). When all
> three are favorable, rate **Low** and recommend narrowing as polish, not as a fix —
> e.g. `useEditorStore((s) => s.openDocuments.find(d => d.id === s.activeTabId))` with
> `useShallow`.

---

## 3. Modern-judgment additions (skill predates these)

### 3a. React 19 / React Compiler — what it auto-fixes vs. what it does NOT

*Motivated by the audit's dedicated React-Compiler note (lines 377–391).*

**Add subsection:**

> ### React 19 / React Compiler scope
>
> If the project adopts the React Compiler, it **auto-memoizes** component bodies and
> hoists inline allocations — so 2a (markdown memo + inline `components`/`remarkPlugins`),
> 2c's in-render parsing, and 2e (`groupSegments` in render) are largely neutralized
> automatically. **Do NOT defer the following on the assumption the compiler covers them:**
> - **Zustand subscription granularity** (2b over-broad flag, 2d closure cache, 2g
>   whole-array) — the compiler does not touch store-selector shape.
> - **`key={index}` reconciliation bugs** (2c) — a correctness issue, never a memo one.
> - **Imperative-DOM layout thrash** (2f) — outside React's render model entirely.
>
> When reporting, label each finding "compiler-covered" or "must-fix-by-hand" so the team
> doesn't wrongly wave findings away behind a future compiler adoption.

### 3b. Modern Zustand selector best practices

*Reinforced by B4's fix (lines 301–307) and B6's fix (lines 348–351), both of which
the audit expresses in terms of `useShallow` and stable references the skill never names.*

**Add subsection:**

> ### Zustand selector hygiene (current best practice)
>
> - **Never select a new object/array inline:** `useStore((s) => ({ a: s.a, b: s.b }))`
>   or `useStore((s) => s.items.filter(...))` returns a fresh reference every call and
>   re-renders on every store change. Use **`useShallow`** (`useStore(useShallow((s) =>
>   ({ a: s.a, b: s.b })))`) for multi-field selects, or split into atomic selectors.
> - **Derived collections** belong in a `useMemo` in the component (over atomic-selected
>   inputs) or precomputed on the entity in the reducer — not recomputed in the selector
>   on every snapshot.
> - **`getState()` for read-at-event-time:** when a component needs a store value only
>   inside a callback (e.g. workspace roots at click time — see B1's fix at lines 210–213),
>   read `useStore.getState()` lazily in the handler instead of subscribing. This removes
>   the subscription from the render path entirely.
> - **`useSyncExternalStore`:** when auditing a *hand-rolled* external subscription (a
>   custom store, an event-emitter bridge, a `window`/media-query listener) that uses
>   `useEffect` + `useState` to mirror external state, flag it — the tear-safe, concurrent-
>   correct primitive is `useSyncExternalStore`. (Zustand uses it internally; bespoke
>   subscriptions often don't.)
