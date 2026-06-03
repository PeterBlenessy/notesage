---
name: audit-accessibility
description: Audit for accessibility — keyboard navigation, ARIA labels, contrast, focus indicators
user-invocable: true
---

# Audit: Accessibility

Audit for basic accessibility compliance (WCAG AA). This is a research-only audit — do not modify any code.

## What to Search For

### Keyboard Navigation

- **Tab order:** Can all interactive elements (buttons, inputs, links, tabs) be reached via Tab key?
- **Dialog focus traps:** Do modal dialogs trap focus correctly? (Can't Tab out of a dialog to elements behind the overlay)
- **Escape to close:** Do all dialogs, popovers, and panels close on Escape?
- **Keyboard shortcuts:** Are all actions accessible via keyboard, not just mouse? Check for click-only interactions without keyboard equivalents.
- **Custom interactive elements:** Find `<div onClick>` or `<span onClick>` without `role`, `tabIndex`, and `onKeyDown` — these are invisible to keyboard users.
- **Focus trap + restoration:** For every modal, popover, sheet, overlay, and full-screen panel:
  1. Verify focus is trapped while open (Tab cycles within the surface, not to elements behind it). Radix `Dialog`, `Popover`, and `AlertDialog` provide this automatically — verify they are not overridden.
  2. Verify focus is **restored to the trigger element** when the surface closes. This is required by the design system for `TreeOverlay` (`src/components/sidebar/quiet/TreeOverlay.tsx`), `AgentOrb` popover (`src/components/activity/AgentOrb.tsx`), and Focus Mode (`src/hooks/useFocusMode.ts`).
  3. Check custom panels that do NOT use Radix — these need manual `focus()` on open and `previousFocus.focus()` on close.
  4. Flag any panel where closing via Escape or a close button leaves focus on `document.body` or nowhere visible as **Medium** severity.

### ARIA Labels

- **Icon-only buttons:** Find buttons with only an icon (no text content). Check for `aria-label` or `aria-labelledby`.
  - `title`-only is NOT sufficient — VoiceOver on macOS announces `title` only after a 5-second hover delay and not at all during keyboard navigation. Flag any `<Button size="icon">` or `<button>` that has `title` but no `aria-label`.
  - Grep: `size="icon"` combined with `title=` but no `aria-label=`
- **Form inputs:** Find inputs without associated `<label>` elements or `aria-label`.
  - `placeholder` is NOT a label substitute — it disappears on input and is not announced reliably by all screen readers. Flag any `<input>` or `<textarea>` that has `placeholder` but no `aria-label`, `id`+`<label htmlFor>`, or `aria-labelledby`.
  - Grep: `<input` or `<textarea` without `aria-label` or `htmlFor`/`id` pairing nearby.
- **`role="combobox"` inputs:** Any element with `role="combobox"` is an interactive control and requires an accessible name via `aria-label` or `aria-labelledby`. `placeholder` alone is insufficient (VoiceOver reads "text area" on programmatic focus). Grep:
  ```bash
  grep -rn 'role="combobox"' src/components/ --include="*.tsx" | grep -v "aria-label\|aria-labelledby"
  ```
  Flag any hit as **High** severity if it is a primary interaction surface (the chat bar, search inputs). The `FloatingCommandBar` textarea (`src/components/cmd/FloatingCommandBar.tsx`) was the confirmed violation in the 2026-06-03 audit.
- **Dynamic content:** Do regions that update asynchronously (AI streaming, toast notifications) use `aria-live` attributes?
- **Custom widgets:** Do custom dropdowns, sliders, or tree views have appropriate ARIA roles?

### Radix TooltipProvider — Portal Context Severance (Critical)

This project's design system mandates that every `<Tooltip>` must live inside a `<TooltipProvider>` ancestor. Radix `Tooltip` reads its config from the provider's React context — without it, Radix throws `Tooltip must be used within TooltipProvider` at render time and the editor's `ErrorBoundary` catches the crash, blanking the entire editor surface.

**The portal problem:** Radix `<PopoverContent>`, `<DropdownMenuContent>`, `<DialogContent>`, and `<SelectContent>` all render via React portals to `document.body`. Any `<TooltipProvider>` that wraps the component *outside* the portal does NOT reach inside it. Inner tooltips crash even when outer tooltips work fine.

**How to audit:**

1. Find every `<Tooltip>` usage in the codebase:
   ```bash
   grep -rn "<Tooltip" src/components/ --include="*.tsx" | grep -v "TooltipProvider\|TooltipTrigger\|TooltipContent"
   ```

2. For each `<Tooltip>` found, check whether it renders inside a Radix portal surface (`PopoverContent`, `DropdownMenuContent`, `DialogContent`, `SelectContent`, `CommandList`, `SheetContent`).

3. If yes: verify there is a `<TooltipProvider>` **inside** that same portal render, not merely in the parent component tree.

4. Flag any violation as **HIGH** severity — it is a guaranteed runtime crash for users who trigger that UI path. (e.g. `TextColorPopover.tsx`, `HighlightPopover.tsx`, and `TableToolbar.tsx` + `TableToolsPopover.tsx` were the confirmed violations in the 2026-06-03 audit.)

**Known safe pattern** (copy from `src/components/editor/StatusTray.tsx`):
```tsx
<PopoverContent ...>
  <TooltipProvider delayDuration={300}>
    {/* tooltips here are safe */}
  </TooltipProvider>
</PopoverContent>
```

**Components with safe self-contained providers (reference list):**
- `src/components/activity/AgentOrb.tsx`
- `src/components/cmd/FloatingCommandBar.tsx`
- `src/components/editor/StatusBar.tsx`
- `src/components/editor/StatusTray.tsx`
- `src/components/editor/Toolbar.tsx` (has providers, but they do NOT reach inside portaled `PopoverContent`)

### Screen Reader Support

- **Semantic HTML:** Are headings (`<h1>`-`<h6>`) used for structure, not just styling?
- **Lists:** Are file trees rendered as `<ul>`/`<li>` or have `role="tree"`/`role="treeitem"`?
- **Status messages:** Do loading indicators and progress bars have `aria-label` describing what's loading?
- **Error messages:** Are form validation errors associated with their inputs via `aria-describedby`?

### Color Contrast

- Check text/background combinations against WCAG AA (4.5:1 for normal text, 3:1 for large text)
- Pay special attention to:
  - Muted text (`text-muted-foreground`) on both light and dark backgrounds
  - Placeholder text in inputs
  - Disabled button text
  - Soft contrast mode — does it reduce contrast below AA?
- **Design-system color token compliance:** This project prohibits hardcoded chromatic colors in UI components — all color must flow through CSS variables defined in `globals.css`. Hardcoded Tailwind chromatic classes (`bg-green-500`, `bg-amber-500`, `bg-red-500`, `text-blue-*`, etc.) bypass the contrast audit tooling (`pnpm audit:contrast`) and break theme switching.

  Grep for violations:
  ```bash
  grep -rn "bg-\(green\|amber\|yellow\|blue\|indigo\|violet\|teal\|cyan\|pink\|rose\|orange\)-[0-9]" src/components/ --include="*.tsx"
  grep -rn "text-\(green\|amber\|yellow\|blue\|indigo\|violet\|teal\|cyan\|pink\|rose\|orange\)-[0-9]" src/components/ --include="*.tsx"
  ```

  Allowed exceptions: `bg-destructive` / `text-destructive` (mapped to `--color-destructive`) and `bg-[var(--color-accent-primary)]` (the single opt-in accent token). Every other chromatic class is a violation. (e.g. `StatusBar.tsx` used `bg-green-500` / `bg-amber-500` / `bg-red-500` in the 2026-06-03 audit.)

  Flag as **Medium** severity (breaks the theme system and makes contrast unauditable).

### Reduced-Motion Compliance

WCAG 2.3.3 (AAA) and the design system both require that animations can be suppressed when the user has enabled "Reduce Motion" in macOS System Preferences.

**What to audit:**

1. **`animate-pulse` without a guard** — this is the most common violation. Every `animate-pulse` must have either:
   - The Tailwind `motion-reduce:animate-none` modifier, OR
   - Be conditional on `useReducedMotion()` from `src/hooks/useReducedMotion.ts`

   Grep:
   ```bash
   grep -rn "animate-pulse" src/components/ --include="*.tsx" | grep -v "motion-reduce"
   ```
   Any hit that also lacks `useReducedMotion` in the same component is a violation.

2. **`animate-spin` on loaders** — same rule. `Loader2` spinners and `RefreshCw` rotate animations should respect reduced-motion.
   ```bash
   grep -rn "animate-spin" src/components/ --include="*.tsx" | grep -v "motion-reduce"
   ```

3. **CSS keyframe animations in `globals.css`** — custom keyframes (e.g., `@keyframes orb-pulse`) must have a `@media (prefers-reduced-motion: reduce)` guard that zeroes or removes the animation. Check `src/styles/globals.css`.

4. **Transition durations on layout-affecting properties** — `transition-all`, `transition-transform`, and `transition-height` in large containers should use `motion-reduce:transition-none` or be conditional.

**Correct patterns (copy from these):**
- `useReducedMotion()` hook: `src/hooks/useReducedMotion.ts`
- CSS `@media` guard: `src/styles/globals.css` (`.orb-pulsing` block)
- Hook-gated pulse: `src/components/editor/StatusTray.tsx`

**Severity guide:**
- Streaming cursors and status indicators during active AI sessions: **Low** (intermittent)
- Recording/transcription active indicators that run for minutes: **Low-Medium**
- Page-load skeleton loaders (e.g. `LinkPreviewCard`): **Low** (brief)
- Unconditional animations on permanently-visible UI (dock/orb): **Medium**

### Focus Indicators

- Are custom focus styles visible in both light and dark mode?
- Do focus indicators have sufficient contrast (3:1 against adjacent colors)?
- Are default browser focus rings replaced with styled alternatives? (Design system says yes)
- Check shadcn/ui components — do they maintain focus visibility?

## Output Format

For each finding:

```markdown
### <SEVERITY>: <Short title>

**File:** `<path>:<line>`

<What accessibility barrier exists and who it affects.>

**Fix:** <Remediation with code example.>
```

## Example Finding

### MEDIUM: Icon-only toolbar buttons missing aria-label

**File:** `src/components/editor/Toolbar.tsx:145-180`

The formatting toolbar has 15+ icon-only buttons (bold, italic, undo, etc.) rendered as `<Button size="icon">` without `aria-label`. Screen readers announce these as "button" with no indication of what they do.

**Fix:** Add `aria-label` to each icon button:
```tsx
<Button size="icon" aria-label="Bold" onClick={toggleBold}>
  <Bold className="h-4 w-4" />
</Button>
```
