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

### ARIA Labels

- **Icon-only buttons:** Find buttons with only an icon (no text content). Check for `aria-label` or `aria-labelledby`.
- **Form inputs:** Find inputs without associated `<label>` elements or `aria-label`.
- **Dynamic content:** Do regions that update asynchronously (AI streaming, toast notifications) use `aria-live` attributes?
- **Custom widgets:** Do custom dropdowns, sliders, or tree views have appropriate ARIA roles?

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

End with a `### Confirmed Good Patterns` section.

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
