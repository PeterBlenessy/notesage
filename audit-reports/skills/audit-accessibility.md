# Skill Improvement Proposal: audit-accessibility

**Motivated by:** `audit-reports/07-a11y-error-ux.md` (2026-06-03)

---

## 1. Stale/Incorrect Guidance to Fix

### 1a. ARIA Labels section — `title` attribute not flagged as insufficient

**Current text (lines 20-25 of SKILL.md):**
```
- **Icon-only buttons:** Find buttons with only an icon (no text content). Check for `aria-label` or `aria-labelledby`.
```

**Problem:** The audit found four icon buttons in `ConnectionCard.tsx` (lines 336, 352, 376, 387) and one in `TranscriptionSettings.tsx` (line 146) that carry only a `title` attribute — no `aria-label`. The current check says "check for `aria-label` or `aria-labelledby`" but does not teach auditors that `title` is NOT equivalent. Auditors reading the current guidance would mark those buttons as passing.

**Replacement:**
```
- **Icon-only buttons:** Find buttons with only an icon (no text content). Check for `aria-label` or `aria-labelledby`.
  - `title`-only is NOT sufficient — VoiceOver on macOS announces `title` only after a 5-second hover delay and not at all during keyboard navigation. Flag any `<Button size="icon">` or `<button>` that has `title` but no `aria-label`.
  - Grep: `size="icon"` combined with `title=` but no `aria-label=`
```

---

### 1b. ARIA Labels section — inputs section omits the `placeholder`-as-label anti-pattern

**Current text (line 22):**
```
- **Form inputs:** Find inputs without associated `<label>` elements or `aria-label`.
```

**Problem:** Audit findings M5 (`LinkButton.tsx:173`) and M6 (`MermaidPreview.tsx:154`) both have inputs/textareas relying solely on `placeholder`. The current check lists `<label>` and `aria-label` but does not flag `placeholder`-only as a violation, so an auditor could incorrectly mark these as acceptable.

**Replacement:**
```
- **Form inputs:** Find inputs without associated `<label>` elements or `aria-label`.
  - `placeholder` is NOT a label substitute — it disappears on input and is not announced reliably by all screen readers. Flag any `<input>` or `<textarea>` that has `placeholder` but no `aria-label`, `id`+`<label htmlFor>`, or `aria-labelledby`.
  - Grep: `<input` or `<textarea` without `aria-label` or `htmlFor`/`id` pairing nearby.
```

---

## 2. New Checks to Add

### 2a. NEW SECTION: Radix TooltipProvider — Portal Context Severance (Critical)

**Motivation:** Findings H1 (`TextColorPopover.tsx:54-78`), H2 (`HighlightPopover.tsx:57-81`), H3 (`TableToolbar.tsx:42` + `TableToolsPopover.tsx:40`). These are **crash-risk** bugs, not merely accessibility improvements. The existing skill has no TooltipProvider check whatsoever despite this being a documented, recurrent failure mode in this codebase (previously hit by PR #173's `BlockSizeToolbar`).

**Add after the "ARIA Labels" subsection:**

```markdown
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

4. Flag any violation as **HIGH** severity — it is a guaranteed runtime crash for users who trigger that UI path.

**Known safe pattern** (copy from `src/components/editor/StatusTray.tsx:806-813`):
```tsx
<PopoverContent ...>
  <TooltipProvider delayDuration={300}>
    {/* tooltips here are safe */}
  </TooltipProvider>
</PopoverContent>
```

**Known violations found in 2026-06-03 audit:**
- `src/components/editor/toolbar/TextColorPopover.tsx:54-78` (H1)
- `src/components/editor/toolbar/HighlightPopover.tsx:57-81` (H2)
- `src/components/editor/TableToolbar.tsx:42` + `src/components/editor/toolbar/TableToolsPopover.tsx:40` (H3)

**Components with safe self-contained providers (reference list):**
- `src/components/activity/AgentOrb.tsx`
- `src/components/cmd/FloatingCommandBar.tsx`
- `src/components/editor/StatusBar.tsx`
- `src/components/editor/StatusTray.tsx`
- `src/components/editor/Toolbar.tsx` (lines 190, 579 — but does NOT reach inside portaled PopoverContent)
```

---

### 2b. NEW SUBSECTION: Reduced-Motion Guards on `animate-pulse`

**Motivation:** Findings L1 (`ChatMessage.tsx:738, 764-766, 772`), L2 (`ActivityTaskCard.tsx:458, 482`), L3 (`CommentThread.tsx:202`), L4 (`LinkPreviewCard.tsx:157-158`), M1 partial (`StatusBar.tsx:365`), L6 (`MicButton.tsx:51`). The audit found six files with unguarded `animate-pulse`. The current skill has a "Color Contrast" and "Focus Indicators" section but zero mention of reduced-motion. The design system (`docs/design-system.md`) makes reduced-motion a first-class requirement with named hooks and CSS guards.

**Add as a new subsection inside "Keyboard Navigation" (or as a standalone section between "Focus Indicators" and "Output Format"):**

```markdown
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
- Hook-gated pulse: `src/components/editor/StatusTray.tsx:555`

**Severity guide:**
- Streaming cursors and status indicators during active AI sessions: **Low** (intermittent)  
- Recording/transcription active indicators that run for minutes: **Low-Medium**
- Page-load skeleton loaders (`LinkPreviewCard`): **Low** (brief)
- Unconditional animations on permanently-visible UI (dock/orb): **Medium**
```

---

### 2c. NEW SUBSECTION: Focus Trap and Restoration Verification

**Motivation:** The design system (`docs/design-system.md`) documents focus trap + restoration as a requirement for `TreeOverlay`, `AgentOrb` popover, and Focus Mode. The current skill mentions "Dialog focus traps" in the keyboard navigation section but gives no guidance on *how* to verify trapping or the restoration requirement. Finding H5 (`QuietLayout.tsx:412-450`) — `FloatingCommandBar` and `AgentOrb` outside `ErrorBoundary` — is adjacent: an uncaught exception in the command bar can leave focus stranded.

**Add as a new bullet under "Keyboard Navigation":**

```markdown
- **Focus trap + restoration:** For every modal, popover, sheet, overlay, and full-screen panel:
  1. Verify focus is trapped while open (Tab cycles within the surface, not to elements behind it). Radix `Dialog`, `Popover`, and `AlertDialog` provide this automatically — verify they are not overridden.
  2. Verify focus is **restored to the trigger element** when the surface closes. This is required by the design system for `TreeOverlay` (`src/components/sidebar/quiet/TreeOverlay.tsx`), `AgentOrb` popover (`src/components/activity/AgentOrb.tsx`), and Focus Mode (`src/hooks/useFocusMode.ts`).
  3. Check custom panels that do NOT use Radix — these need manual `focus()` on open and `previousFocus.focus()` on close.
  4. Flag any panel where closing via Escape or a close button leaves focus on `document.body` or nowhere visible as **Medium** severity.
```

---

### 2d. NEW SUBSECTION: `aria-label` on `role="combobox"` inputs (Primary interaction surfaces)

**Motivation:** Finding H4 (`FloatingCommandBar.tsx:2537`) — the primary chat/command textarea has `role="combobox"` but no `aria-label`. The current skill covers icon buttons and form inputs but does not specifically call out the `role="combobox"` pattern, which has its own accessible-name requirements under WCAG 4.1.2.

**Add under "ARIA Labels":**

```markdown
- **`role="combobox"` inputs:** Any element with `role="combobox"` is an interactive control and requires an accessible name via `aria-label` or `aria-labelledby`. `placeholder` alone is insufficient (VoiceOver reads "text area" on programmatic focus). Grep:
  ```bash
  grep -rn 'role="combobox"' src/components/ --include="*.tsx" | grep -v "aria-label\|aria-labelledby"
  ```
  Flag any hit as **High** severity if it is a primary interaction surface (the chat bar, search inputs). The `FloatingCommandBar` textarea at `src/components/cmd/FloatingCommandBar.tsx:2537` was the confirmed violation in the 2026-06-03 audit.
```

---

### 2e. NEW SUBSECTION: Accent and Contrast Token Violations

**Motivation:** Finding M1 (`StatusBar.tsx:363-367, 383-387, 797-801`) — `bg-green-500`, `bg-amber-500`, `bg-red-500` violate the design system's strict-neutral palette and additionally bypass the contrast audit tooling (`pnpm audit:contrast`). The current skill covers WCAG contrast thresholds but says nothing about the project's CSS-variable-only color rule, which is the enforcement mechanism that makes contrast auditable at all.

**Add under "Color Contrast":**

```markdown
- **Design-system color token compliance:** This project prohibits hardcoded chromatic colors in UI components — all color must flow through CSS variables defined in `globals.css`. Hardcoded Tailwind chromatic classes (`bg-green-500`, `bg-amber-500`, `bg-red-500`, `text-blue-*`, etc.) bypass the contrast audit tooling and break theme switching.
  
  Grep for violations:
  ```bash
  grep -rn "bg-\(green\|amber\|yellow\|blue\|indigo\|violet\|teal\|cyan\|pink\|rose\|orange\)-[0-9]" src/components/ --include="*.tsx"
  grep -rn "text-\(green\|amber\|yellow\|blue\|indigo\|violet\|teal\|cyan\|pink\|rose\|orange\)-[0-9]" src/components/ --include="*.tsx"
  ```
  
  Allowed exceptions: `bg-destructive` / `text-destructive` (mapped to `--color-destructive`) and `bg-[var(--color-accent-primary)]` (the single opt-in accent token). Every other chromatic class is a violation.
  
  Flag as **Medium** severity (breaks the theme system and makes contrast unauditable).
```

---

## 3. Preserved Frontmatter + Structure

The SKILL.md frontmatter (`name`, `description`, `user-invocable`) is unchanged. The existing sections — Keyboard Navigation, ARIA Labels, Screen Reader Support, Color Contrast, Focus Indicators, Output Format, Example Finding — are all preserved. The additions above insert into or alongside existing sections; none replace them.
