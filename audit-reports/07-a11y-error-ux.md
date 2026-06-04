# Accessibility & Error UX Audit — Notesage

**Date:** 2026-06-03
**Scope:** `src/components/`, `src/styles/`
**Perspectives:** (A) Accessibility — keyboard, ARIA, focus, TooltipProvider, contrast, reduced-motion, semantic HTML; (B) Error UX — silent failures, missing error boundaries, missing loading/empty states, unhandled rejections

---

## Summary

| Severity | Count |
|----------|-------|
| High     | 5     |
| Medium   | 7     |
| Low      | 6     |
| **Total**| **18**|

---

## High Severity

### H1. TooltipProvider violation — TextColorPopover (crash risk)

**File:** `src/components/editor/toolbar/TextColorPopover.tsx:54-78`

**Evidence:**
```tsx
<PopoverContent side="bottom" align="start" className="w-[180px] p-2">
  {TEXT_COLORS.map(({ label, value }) => (
    <Tooltip key={label}>          {/* ← NO TooltipProvider after portal */}
      <TooltipTrigger asChild>
        <button ...>...</button>
      </TooltipTrigger>
      <TooltipContent ...>{label}</TooltipContent>
    </Tooltip>
  ))}
</PopoverContent>
```

**Impact:** `PopoverContent` portals to `document.body`, severing the React context tree. The `<TooltipProvider>` wrapping the toolbar does not reach inside portaled content. Radix throws `Tooltip must be used within TooltipProvider` the moment any color swatch in the text-color popover renders — identical crash mode to PR #173's `BlockSizeToolbar`. The editor's `<ErrorBoundary>` catches it, blanking the entire editor surface.

**Fix:** Wrap the `PopoverContent`'s inner section in its own `<TooltipProvider delayDuration={300}>`:
```tsx
<PopoverContent ...>
  <TooltipProvider delayDuration={300}>
    {TEXT_COLORS.map(({ label, value }) => (
      <Tooltip key={label}>...</Tooltip>
    ))}
  </TooltipProvider>
</PopoverContent>
```

---

### H2. TooltipProvider violation — HighlightPopover (crash risk)

**File:** `src/components/editor/toolbar/HighlightPopover.tsx:57-81`

**Evidence:** Identical pattern to H1 — `<Tooltip>` items for highlight color swatches rendered inside `<PopoverContent>` (portaled) with no `<TooltipProvider>` wrapping the inner content.

**Impact:** Same crash as H1 — opening the highlight color picker crashes the editor.

**Fix:** Same as H1 — add `<TooltipProvider delayDuration={300}>` wrapping the color swatch loop inside `PopoverContent`.

---

### H3. TooltipProvider violation — TableToolbar via TableToolsPopover (crash risk)

**File:** `src/components/editor/TableToolbar.tsx:42` + `src/components/editor/toolbar/TableToolsPopover.tsx:40`

**Evidence:**
```tsx
// TableToolbar.tsx — TableButton component (line ~42)
function TableButton({ ... }) {
  return (
    <Tooltip>                   {/* no standalone provider */}
      <TooltipTrigger asChild>
        <Button ...>...</Button>
      </TooltipTrigger>
      <TooltipContent ...>{label}</TooltipContent>
    </Tooltip>
  );
}

// TableToolsPopover.tsx (line ~40)
<PopoverContent ...>
  <TableToolbarContent ... />    {/* renders TableButton → Tooltip, inside portal */}
</PopoverContent>
```

**Impact:** When `TableToolsPopover` renders `TableToolbarContent` inside portaled `PopoverContent`, every `TableButton` tooltip crashes Radix. `Toolbar.tsx` wraps the outer toolbar in `<TooltipProvider>` (lines 190, 579) but the portal severs the context link.

**Fix:** Add `<TooltipProvider delayDuration={300}>` at the top of `TableToolbarContent`'s render output inside `TableToolsPopover`, or add it as the wrapper inside `PopoverContent`.

---

### H4. FloatingCommandBar textarea missing `aria-label`

**File:** `src/components/cmd/FloatingCommandBar.tsx:2537`

**Evidence:**
```tsx
<textarea
  role="combobox"
  aria-haspopup="listbox"
  aria-expanded={showPicker}
  aria-autocomplete="list"
  aria-controls="cmd-bar-picker"
  aria-activedescendant={activeDescendantId}
  // ← no aria-label or aria-labelledby
  placeholder="Ask anything, or type / for skills..."
  ...
/>
```

**Impact:** WCAG 4.1.2 Name, Role, Value — interactive controls must have an accessible name. `placeholder` is not a reliable substitute: some screen readers read it, others do not, and VoiceOver on macOS reads it as "text area" without the label when the field is focused programmatically (e.g., on `⌘K`). The FloatingCommandBar is the primary input surface in the entire app; a screen reader user landing on it hears nothing useful.

**Fix:** Add `aria-label="Chat and command input"` (or equivalent) to the `<textarea>`:
```tsx
<textarea
  role="combobox"
  aria-label="Chat and command input"
  ...
/>
```

---

### H5. FloatingCommandBar and AgentOrb outside ErrorBoundary

**File:** `src/components/QuietLayout.tsx:412-450`

**Evidence:**
```tsx
// Only the editor is wrapped
<ErrorBoundary>
  <Editor ... />
</ErrorBoundary>

// These have no ErrorBoundary:
<FloatingCommandBar ... />   {/* line ~443 */}
<AgentOrb ... />             {/* line ~449 */}
```

**Impact:** An unhandled exception in `FloatingCommandBar` (e.g., from a malformed ACP response, a chat-store corruption, or a rendering error in a segment view) or in `AgentOrb` (e.g., during agent task rendering) will bubble to the root React tree and unmount the entire application. The user loses all unsaved editor content. This is the primary AI interaction surface and the ambient agent indicator — both should degrade gracefully.

**Fix:**
```tsx
<ErrorBoundary>
  <FloatingCommandBar ... />
</ErrorBoundary>
<ErrorBoundary>
  <AgentOrb ... />
</ErrorBoundary>
```

---

## Medium Severity

### M1. Hardcoded chromatic Tailwind colors in StatusBar (design system violation)

**File:** `src/components/editor/StatusBar.tsx:363-367, 383-387, 797-801`

**Evidence:**
```tsx
// Line ~365
serverStatus === 'running' ? 'bg-green-500'
: serverStatus === 'starting' ? 'bg-amber-500 animate-pulse'
: serverStatus === 'error' ? 'bg-red-500'
```

**Impact (design system):** `bg-green-500`, `bg-amber-500`, `bg-red-500` are explicit Tailwind chromatic color classes. The design system mandates: "No color with chroma > 0 in components except via `--color-accent-primary`, `--color-destructive`, or the editor content colour tokens." The documentation explicitly lists `bg-green-500`, `bg-amber-500` (and any `bg-*-NNN` class with a hue) in the anti-patterns section. The status dot is a UI chrome element — it must use CSS variable tokens.

**Impact (reduced-motion):** `bg-amber-500 animate-pulse` fires unconditionally during the `'starting'` state with no `motion-reduce:animate-none` modifier and no `useReducedMotion()` guard. Users who have enabled Reduce Motion in macOS System Preferences still see this animation.

**Fix:**
```tsx
// Use design-system tokens for color
serverStatus === 'running'
  ? 'bg-[oklch(55%_0_0)]'      // or a named CSS var like --color-status-active
: serverStatus === 'starting'
  ? cn('bg-[oklch(55%_0_0)]', !reducedMotion && 'animate-pulse')
: serverStatus === 'error'
  ? 'bg-destructive'            // --color-destructive is the correct semantic token
```
For the semantic "green = running" signal: the design system's `--color-destructive` handles the error (red) case. For running/starting, use a neutral dot or a custom CSS variable `--color-status-ok` defined in `globals.css` following the `oklch(L% 0 0)` palette — or accept that a neutral grey dot with a tooltip is sufficient in a monochrome design system. Import `useReducedMotion` from `src/hooks/useReducedMotion` to gate the pulse.

---

### M2. Icon buttons use `title` only, not `aria-label` — ConnectionCard

**File:** `src/components/settings/connection/ConnectionCard.tsx:336, 352, 376, 387`

**Evidence:**
```tsx
<Button size="icon" variant="ghost" title="Test connection">
  <Wifi className="h-4 w-4" />
</Button>
<Button size="icon" variant="ghost" title="Re-authenticate">
  <Key className="h-4 w-4" />
</Button>
<Button size="icon" variant="ghost" title="Configure">
  <Settings className="h-4 w-4" />
</Button>
<Button size="icon" variant="ghost" title="Disconnect">
  <Trash2 className="h-4 w-4" />
</Button>
```

**Impact:** WCAG 4.1.2 — `title` is NOT a reliable accessible name on interactive elements. VoiceOver on macOS announces the `title` tooltip only after a 5-second hover delay, and not at all when navigating by keyboard. Screen reader users hear "button" with no context for any of these four critical connection management actions.

**Fix:** Replace `title` with `aria-label` on each button (keep `title` for sighted mouse users who want the tooltip):
```tsx
<Button size="icon" variant="ghost" title="Test connection" aria-label="Test connection">
```

---

### M3. Icon buttons with no accessible name at all — AdvancedSettingsForm

**File:** `src/components/settings/connection/AdvancedSettingsForm.tsx:107, 247`

**Evidence:**
```tsx
// Line 107 — Add writable path
<Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleAddPath}>
  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
</Button>

// Line 247 — Add domain
<Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleAddDomain}>
  <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
</Button>
```

**Impact:** No `aria-label`, no `title`, pure icon — completely inaccessible. Screen readers announce "button" only. These buttons control security-critical sandbox settings (writable paths and domain allowlists). A screen reader user cannot discover what these buttons do or find them in the controls list.

**Fix:**
```tsx
<Button ... aria-label="Add writable path" title="Add writable path">
  <Plus ... />
</Button>

<Button ... aria-label="Add allowed domain" title="Add allowed domain">
  <Plus ... />
</Button>
```

---

### M4. Icon button with no accessible name — ModelSelectionForm refresh

**File:** `src/components/settings/connection/ModelSelectionForm.tsx:369`

**Evidence:**
```tsx
<Button variant="ghost" size="icon" className="h-7 w-7 shrink-0"
  onClick={handleRefreshModels} disabled={modelsLoading}>
  {modelsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
</Button>
```

**Impact:** No `aria-label`, no `title`. When loading, screen reader hears nothing useful about why the button is temporarily disabled.

**Fix:**
```tsx
<Button ... aria-label={modelsLoading ? "Loading models" : "Refresh models"}>
```

---

### M5. Unlabeled `<input>` in LinkButton popover

**File:** `src/components/editor/toolbar/LinkButton.tsx:173`

**Evidence:**
```tsx
<input
  type="text"
  value={url}
  onChange={handleUrlChange}
  placeholder="Search documents or paste URL..."
  className="..."
  // ← no aria-label, no id+label association
/>
```

**Impact:** WCAG 1.3.1 / 4.1.2 — the input has no accessible name. `placeholder` disappears on input and is not a substitute for a label. Keyboard users navigating to this input via Tab hear "text field" or nothing; the purpose (URL entry for links) is not communicated.

**Fix:**
```tsx
<label htmlFor="link-url-input" className="sr-only">Link URL or document search</label>
<input
  id="link-url-input"
  type="text"
  ...
/>
```
Or with `aria-label`:
```tsx
<input ... aria-label="Link URL or document search" />
```

---

### M6. Unlabeled `<textarea>` in MermaidPreview editor

**File:** `src/components/editor/MermaidPreview.tsx:154`

**Evidence:**
```tsx
<textarea
  ref={textareaRef}
  className="mermaid-editor-textarea"
  value={editSource}
  onChange={(e) => setEditSource(e.target.value)}
  // ← no aria-label
/>
```

**Impact:** WCAG 4.1.2 — textarea has no accessible name. A screen reader user enters the Mermaid source edit mode and hears "text area" with no indication of what to enter.

**Fix:**
```tsx
<textarea ... aria-label="Mermaid diagram source" />
```

---

### M7. Cancel download button uses `title` only — TranscriptionSettings

**File:** `src/components/settings/TranscriptionSettings.tsx:146`

**Evidence:**
```tsx
<Button
  variant="ghost"
  size="icon-xs"
  className="text-muted-foreground hover:text-destructive"
  onClick={() => cancelDownload(model.name)}
  title="Cancel download"
>
  <X className="h-3.5 w-3.5" strokeWidth={1.5} />
</Button>
```

**Impact:** Same `title`-only issue as M2. Screen reader users navigating the model download list cannot identify the cancel action by keyboard.

**Fix:**
```tsx
<Button ... title="Cancel download" aria-label={`Cancel ${model.name} download`}>
```
Using the model name in `aria-label` gives more context ("Cancel small download") when multiple downloads are active.

---

## Low Severity

### L1. `animate-pulse` streaming cursors without reduced-motion guard — ChatMessage

**File:** `src/components/chat/ChatMessage.tsx:738, 764-766, 772`

**Evidence:**
```tsx
// Line 738 — streaming cursor
<span className="inline-block w-1.5 h-3.5 ml-0.5 rounded-sm animate-pulse bg-muted-foreground" />

// Lines 764-766 — typing indicator dots
<div className="h-1.5 w-1.5 rounded-full animate-pulse bg-muted-foreground" />
<div className="h-1.5 w-1.5 rounded-full animate-pulse [animation-delay:150ms] bg-muted-foreground" />
<div className="h-1.5 w-1.5 rounded-full animate-pulse [animation-delay:300ms] bg-muted-foreground" />
```

**Impact:** WCAG 2.3.3 (AAA) — blinking/flashing content should be suppressible. While `animate-pulse` is slow enough to avoid seizure threshold (it's under 3Hz), users with vestibular disorders who set Reduce Motion still see it. `globals.css` has a `@media (prefers-reduced-motion: reduce)` guard for `.orb-pulsing` but NOT for Tailwind's `animate-pulse` class.

**Fix:** Add `motion-reduce:animate-none` Tailwind modifier:
```tsx
<span className="... animate-pulse motion-reduce:animate-none bg-muted-foreground" />
<div className="... animate-pulse motion-reduce:animate-none ..." />
```
Alternatively, use `useReducedMotion()` as done correctly in `StatusTray.tsx:555`.

---

### L2. `animate-pulse` streaming cursors without reduced-motion guard — ActivityTaskCard

**File:** `src/components/activity/ActivityTaskCard.tsx:458, 482`

**Evidence:**
```tsx
<span className="inline-block w-1.5 h-3.5 ml-0.5 rounded-sm animate-pulse bg-muted-foreground" />
```

**Impact:** Same as L1 — identical streaming cursor pattern with no reduced-motion guard.

**Fix:** Add `motion-reduce:animate-none` to each occurrence.

---

### L3. `animate-pulse` streaming cursor without reduced-motion guard — CommentThread

**File:** `src/components/editor/CommentThread.tsx:202`

**Evidence:**
```tsx
<span className="inline-block w-1.5 h-3.5 ml-0.5 rounded-sm animate-pulse bg-muted-foreground" />
```

**Impact:** Same as L1.

**Fix:** Add `motion-reduce:animate-none`.

---

### L4. `animate-pulse` skeleton loaders without reduced-motion guard — LinkPreviewCard

**File:** `src/components/editor/LinkPreviewCard.tsx:157-158`

**Evidence:**
```tsx
<div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
<div className="h-3 w-full bg-muted rounded animate-pulse" />
```

**Impact:** Skeleton loading animation fires unconditionally while fetching OpenGraph metadata. Unlike streaming cursors, these appear during any link preview load.

**Fix:** Add `motion-reduce:animate-none` to each skeleton element.

---

### L5. Editor file-load error message is always "File not found" regardless of actual error

**File:** `src/components/editor/Editor.tsx:162-164, 571-582`

**Evidence:**
```tsx
// Error is stored as string but the UI only shows a generic message
useEditorStore.getState().setTabLoadError(tabId, `File not found: ${path}`);

// In render (~line 571):
if (activeTab.loadError) {
  return (
    <div>
      <p>File not found</p>
      <p>This file may have been moved or deleted.</p>
    </div>
  );
}
```

**Impact:** The actual error string (e.g., "Permission denied", "Path is a directory", "I/O error reading ...") is discarded from the UI. A user whose file fails to open due to a permissions error sees "File not found" — a misleading diagnosis. They may waste time looking for a "deleted" file that is actually accessible but permission-gated.

**Fix:** Display the actual `activeTab.loadError` string in the UI, or at minimum branch on common error patterns:
```tsx
<p>{activeTab.loadError.includes('not found') ? 'File not found' : 'Could not open file'}</p>
<p className="text-xs text-muted-foreground font-mono">{activeTab.loadError}</p>
```

---

### L6. MicButton `animate-pulse` has no reduced-motion guard

**File:** `src/components/editor/toolbar/MicButton.tsx:51`

**Evidence:**
```tsx
isRecording
  ? "animate-pulse text-[var(--color-accent-primary)]"
  : "text-muted-foreground"
```

**Impact:** The recording-state indicator pulses indefinitely during a meeting recording with no reduced-motion guard. This is a lower priority than chat streaming cursors because it requires an active recording session, but it fires continuously — the longest-duration pulse in the app.

**Fix:**
```tsx
import { useReducedMotion } from "@/hooks/useReducedMotion";

const reducedMotion = useReducedMotion();
// ...
isRecording
  ? cn(!reducedMotion && "animate-pulse", "text-[var(--color-accent-primary)]")
  : "text-muted-foreground"
```

---

## Reference: Correct Patterns

The following components demonstrate the correct patterns for each issue class:

| Pattern | Reference implementation |
|---------|--------------------------|
| TooltipProvider inside PopoverContent | `src/components/editor/StatusTray.tsx:806-813` (documented why) |
| `useReducedMotion()` for pulse gating | `src/components/editor/StatusTray.tsx:555` |
| Icon button `aria-label` | `src/components/sidebar/quiet/ProjectsSection.tsx:1311` |
| `role="treeitem"` + `aria-label` | `src/components/sidebar/quiet/ProjectsSection.tsx:1311-1328` |
| `aria-label` on `role="combobox"` | `src/components/activity/AgentPanel.tsx` (uses it correctly on search inputs) |

---

## Appendix: TooltipProvider Grep Surface

All `<Tooltip` usages were checked against their call hierarchy. Violations are the three confirmed crashes above. Other usages (CalloutPicker, MicButton, BubbleMenu toolbar items) are safe when called from within `Toolbar.tsx`'s `<TooltipProvider>` but would crash if ever rendered in isolation — they do not provide their own provider and depend on the ambient provider being present.

Components with self-contained `<TooltipProvider>` (safe regardless of context):
- `src/components/activity/AgentOrb.tsx`
- `src/components/cmd/FloatingCommandBar.tsx`
- `src/components/editor/StatusBar.tsx` (multiple providers across major sections)
- `src/components/editor/StatusTray.tsx`
- `src/components/settings/TranscriptionSettings.tsx` (line 100)
- `src/components/editor/Toolbar.tsx` (lines 190, 579)
