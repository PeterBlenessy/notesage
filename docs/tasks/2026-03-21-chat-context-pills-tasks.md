# Chat Context Pills — Tasks

**PRD:** [chat-context-pills](../prds/2026-03-21-chat-context-pills.md)**Date:** 2026-03-21

## Summary

**5 tasks: 2S, 3M** — All frontend-only, no backend changes.

**Implementation order:** #1 (types + state hook) → #2 (pill UI component) → #3 (wire into ChatInput) → #4 (modify context injection) → #5 (design polish + verification)

**Risks:** None significant. The main coupling point is between `ChatPanel` (which owns context state) and `useAIOperations` (which builds the system message). The PRD suggests passing attached file paths as a parameter — this requires threading the list through `sendChatMessage` or reading it from a shared ref.

---

## Tasks

### 1. Create `ContextItem` type and `useChatContext` hook

**Complexity:** S | **Category:** frontend | **Dependencies:** None

**Description:**

Create a small hook that manages the context pills state, derived from the active tab.

- Define the `ContextItem` interface in a new file `src/hooks/useChatContext.ts`
- Hook reads `activeTabId` and active tab's `filePath`/`fileName` from `editor-store`
- Maintains `contextItems: ContextItem[]` as local state
- On active tab change (file path changes): reset items, add new file item with `dismissed: false`
- On no active tab: empty items
- Expose: `contextItems` (non-dismissed only), `allContextItems`, `dismissItem(id)`, `attachedFilePaths` (convenience getter: non-dismissed file paths as `string[]`)

**Acceptance criteria:**

- Hook correctly tracks active tab file as a context item
- Dismissing an item marks it as dismissed (hidden but in state)
- Tab switch resets all items and adds the new file
- No tab → empty list

**Files:**

- Create: `src/hooks/useChatContext.ts`

---

### 2. Create `ContextPill` component

**Complexity:** M | **Category:** frontend | **Dependencies:** #1

**Description:**

Build the individual pill component matching the PRD design spec.

- File icon (lucide `File`, 14px, `strokeWidth={1.5}`) on the left
- Filename label (truncated at \~20 chars with ellipsis)
- X close button (lucide `X`, 12px) — visible only on hover, smooth fade-in (150ms `opacity` transition)
- Full file path in a shadcn `Tooltip` on hover
- Pill styling: `rounded-md bg-accent text-accent-foreground text-xs` (\~22px height)
- Smooth appear/disappear transition (150ms opacity + scale)
- Wrap in `TooltipProvider` (per project convention — see `ActivityStrip.tsx` for pattern)

**Acceptance criteria:**

- Pill renders filename with file icon
- X button hidden by default, fades in on hover
- Tooltip shows full path
- Clicking X calls `onDismiss` callback
- Looks correct in light, dark, and soft contrast modes

**Files:**

- Create: `src/components/chat/ContextPill.tsx`

---

### 3. Wire pills into `ChatInput` and `ChatPanel`

**Complexity:** M | **Category:** frontend | **Dependencies:** #1, #2

**Description:**

Integrate the context pills into the chat input area and connect state management.

**ChatPanel.tsx:**

- Call `useChatContext()` hook
- Pass `contextItems` and `dismissItem` to `ChatInput` via new props

**ChatInput.tsx:**

- Add new props: `contextItems: ContextItem[]`, `onDismissContext: (id: string) => void`
- Render a pills row above the textarea (inside the outer border `div`)
- Layout: `flex flex-wrap gap-1.5 px-3 pt-2 pb-1`
- Only render the row if there are visible (non-dismissed) items — no empty space when empty
- Render a `ContextPill` for each item

**Acceptance criteria:**

- Active file pill appears above textarea when a tab is open
- Clicking X on pill removes it from the row
- Switching tabs shows the new file, previous pill gone
- No tab → no pills row (no empty space)
- Pills row is inside the `ChatInput` border, visually part of the input area

**Files:**

- Modify: `src/components/chat/ChatInput.tsx`
- Modify: `src/components/chat/ChatPanel.tsx`

---

### 4. Modify `useAIOperations` context injection

**Complexity:** M | **Category:** frontend | **Dependencies:** #1, #3

**Description:**

Change `buildProjectContext()` to use the attached file paths from context pills instead of unconditionally including `activeTab`.

**Option A (parameter threading):** Add `attachedFilePaths` to `sendChatMessage` opts and thread it through to `buildProjectContext`. This is cleanest but requires changing the callback signature.

**Option B (shared ref):** `useChatContext` exposes a stable ref that `useAIOperations` reads. Avoids changing `sendChatMessage` signature but couples via ref.

Recommended: **Option A** — explicit data flow, easier to reason about.

**Changes to** `useAIOperations.ts`**:**

- `sendChatMessage` opts: add `attachedFilePaths?: string[]`

- `buildProjectContext`: accept `attachedFilePaths` parameter

- Replace the current `activeTab` block (lines 264-271) with a loop over `attachedFilePaths`:

  ```typescript
  for (const filePath of attachedFilePaths) {
    parts.push(`File in context: ${filePath}`);
  }
  ```

- If `attachedFilePaths` is undefined/empty, include nothing (no file context)

- Same change in `acpSystemMessage` path (`buildProjectContext` is shared)

**Changes to** `ChatPanel.tsx`**:**

- Pass `attachedFilePaths` from `useChatContext()` through to `sendChatMessage` call

**Acceptance criteria:**

- When pill is visible: file path included in system message
- When pill is dismissed: file path excluded from system message
- No content preview (500 chars) — path only
- Works for direct API, ACP, and local bundled providers
- When no pills: no file context in system message at all

**Files:**

- Modify: `src/hooks/useAIOperations.ts`
- Modify: `src/components/chat/ChatPanel.tsx`

---

### 5. Design polish and verification

**Complexity:** S | **Category:** frontend | **Dependencies:** #2, #3, #4

**Description:**

Final pass to verify all quality gates from the PRD.

- Test in light mode, dark mode, and soft contrast mode
- Verify no layout shift when pills appear/disappear
- Verify pill wrap behavior with artificially long filenames
- Verify tooltip positioning doesn't clip at panel edges
- Verify the pills row doesn't steal focus from the textarea
- Test with all three provider types (direct API, ACP, local)
- Test edge cases: rapid tab switching, closing all tabs, opening non-markdown files

**Acceptance criteria:**

- All PRD quality gates (Functional + Design) pass
- No regressions in chat panel behavior

**Files:**

- May need minor tweaks to files from #2, #3, #4