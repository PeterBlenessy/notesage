---
name: ui-component
description: Use when creating, scaffolding, modifying, or styling any UI component. Ensures shadcn/ui is used first, design system compliance, proper theming, and polished visual quality.
---

# UI Component Development

## Step 1: Always Check shadcn/ui First

**NEVER build a custom component if shadcn/ui already has one.** Install with:

```bash
pnpm dlx shadcn@latest add <component-name>
```

### Common Components → shadcn/ui Mapping

The full mapping table lives in `docs/design-system.md` ("Component Strategy —
USE SHADCN/UI FIRST"). Don't duplicate it here — read it before scaffolding.
A few quick reminders for the common cases:

- Buttons → `button`; dropdowns → `dropdown-menu`; right-click → `context-menu`
- Dialogs → `dialog` + `alert-dialog`; tooltips → `tooltip` (see provider rule
  below); toasts → `sonner`; popovers → `popover`
- Search/filter → `command` (cmdk); select → `select`; switch → `switch`
- Resizable panels → `resizable`; scroll areas → `scroll-area`

App-specific notes:

- There is **no document tab bar** — the Classic Layout's `TabBar` was deleted.
  Quiet Composer is a single-document shell; the active document surfaces in
  `TitleBar`, not a tab strip. Don't build a document tab strip. (The shadcn
  `tabs` primitive itself is still fine for in-dialog tabbed content — e.g.
  `ImageInsertDialog.tsx`'s URL/Upload tabs; it just isn't used for documents.)
- File/folder tree → `collapsible` + custom tree (the flat `QuietSidebar`
  sections + the in-sidebar inline `→`-expand one-level peek via `FolderPeek`,
  not a fully custom tree). There is no `TreeOverlay` — it was removed in
  sidebar-simplification; deeper subtrees are reached on demand inline.

## Step 2: Check Radix UI Primitives

If shadcn/ui doesn't have it, check Radix UI primitives before building from scratch:
- https://www.radix-ui.com/primitives

## Radix Tooltip — `<TooltipProvider>` Is Mandatory

**Every `<Tooltip>` MUST live inside a `<TooltipProvider>` ancestor.** Radix
`Tooltip` reads its config from the provider's React context — without it, the
component throws `Tooltip must be used within TooltipProvider` at render time
and the editor's ErrorBoundary catches the crash. This rule has been violated
multiple times in this repo (see `docs/design-system.md` §"Radix Tooltip").

- Self-contained component (toolbar, popover, isolated widget) → wrap its own
  outer element in `<TooltipProvider>`. Don't rely on a parent providing one.
- A tree of tooltip-using components → one provider near the layout root.
- Testing a tooltip-bearing component in isolation → add the provider to the
  test render (or wrap it inside the component).

Reference implementations that wrap their own provider: `AgentOrb.tsx`,
`FloatingCommandBar.tsx`, `CommitDialog.tsx`, `TitleBar.tsx`.

## Step 3: Style with Tailwind + CSS Variables

### Required Styling

- **Colors:** Use CSS variables from `globals.css` only. Never hardcode hex values.
  - `bg-background`, `text-foreground`, `border-border`, `bg-primary`, `text-muted-foreground`
- **Spacing:** Use Tailwind's spacing scale consistently
  - `p-4`, `gap-2`, `space-y-4` (not arbitrary values like `p-[13px]`)
- **Border radius:** Consistent across app
  - `rounded-lg` (8px) or `rounded` (6px) - pick one and stick to it
- **Transitions:** Everything interactive must transition
  - `transition-colors duration-150 ease-in-out` (default)
  - `transition-all duration-150` (if multiple properties change)
- **Icons:** lucide-react with `strokeWidth={1.5}` for refined look
  - Sizes: 16px (inline/sidebar), 18-20px (toolbar), 24px (empty states)
  - Color: `text-muted-foreground` (default), accent on active/hover

### Required States

Every interactive element must have:
- **Hover:** `hover:bg-accent` or `hover:bg-primary/10`
- **Active:** `active:scale-95` or background shift
- **Focus:** Custom focus ring, not browser default
  - `focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2`
- **Disabled:** `disabled:opacity-50 disabled:cursor-not-allowed`

### Light + Dark Mode Support

- Test component in both themes
- Use `dark:` prefix for dark mode overrides
- Images/logos need white background: `bg-white p-0.5 rounded`
- Avoid pure black `#000` or pure white `#FFF` backgrounds

## Anti-Patterns — NEVER DO THESE

- ❌ Default browser checkboxes, radio buttons, or selects
- ❌ Unstyled scrollbars
- ❌ Pure black (#000000) or pure white (#FFFFFF) backgrounds
- ❌ Borders thicker than 1px on UI elements
- ❌ Box shadows that look like 2010 (large, dark, obvious)
- ❌ Inconsistent border-radius (pick 6px or 8px everywhere)
- ❌ Abrupt state changes without transitions
- ❌ Hardcoded hex colors (use CSS variables)
- ❌ Generic gray (#808080) - use the defined palette
- ❌ Unaligned elements - everything snaps to grid
- ❌ Default focus rings - replace with custom

## Quality Check — Before Submitting

Ask yourself these 7 questions:

1. **Would this look out of place in Linear or Craft?** If yes, redo it.
2. **Does every interactive element have hover/active/focus states?**
3. **Are colors from the defined palette (CSS variables), not hardcoded?**
4. **Is spacing consistent with the rest of the app?**
5. **Does it look good in BOTH light and dark mode?**
6. **Are transitions smooth and intentional?**
7. **Would a designer approve this, or say "it works but it's ugly"?**

## Scaffolding a New Component

### File Location

```
src/components/<category>/<ComponentName>.tsx
```

**Categories:**
- `editor/` — Tiptap editor components
- `sidebar/` — file tree and sidebar (`sidebar/quiet/` for Quiet Composer)
- `cmd/` — floating command bar (Quiet Composer chat surface)
- `settings/` — settings UI (`settings/v2/` for the current shell)
- `chat/` — AI chat message + segment components
- `activity/` — agent orb + panel
- Generic: `src/components/<ComponentName>.tsx`

### Props Interface

```typescript
interface ComponentProps {
  title: string;        // Required props first
  description?: string; // Optional props after
  onClick?: () => void; // Event handlers
  className?: string;   // Style override
}
```

### Export

```typescript
// src/components/<category>/index.ts
export { ComponentName } from './ComponentName';
```

## Component Structure Example

```tsx
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Settings } from 'lucide-react';

export function SettingsButton() {
  // TooltipProvider is mandatory — wrap it here so the component never crashes
  // when rendered without an ambient provider.
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="transition-all duration-150 hover:scale-105"
          >
            <Settings className="h-4 w-4" strokeWidth={1.5} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Settings</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

## Reference

Read `docs/design-system.md` for:
- Full color palette and CSS variable names
- Typography specs (fonts, sizes, weights)
- Spacing and layout guidelines
- Complete component specifications
- Detailed animation and transition patterns
