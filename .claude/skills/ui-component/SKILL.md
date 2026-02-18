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

| Need | shadcn/ui component | DON'T build custom |
|------|---------------------|-------------------|
| Buttons | `button` | ❌ custom `<MyButton>` |
| Dropdowns | `dropdown-menu` | ❌ custom dropdown |
| Right-click menus | `context-menu` | ❌ custom context menu |
| Modals/dialogs | `dialog` + `alert-dialog` | ❌ custom modal |
| Tab bar | `tabs` | ❌ custom tab component |
| Tooltips | `tooltip` | ❌ custom tooltip |
| Toasts/notifications | `sonner` | ❌ custom toast |
| Text inputs | `input` | ❌ custom input |
| Search/filter | `command` (cmdk) | ❌ custom search |
| Toggle switches | `switch` | ❌ custom toggle |
| Select/combobox | `select` or `combobox` | ❌ custom select |
| Separators | `separator` | ❌ custom `<hr>` |
| Scroll areas | `scroll-area` | ❌ custom scrollbar |
| Resizable panels | `resizable` | ❌ custom splitter |
| Popovers | `popover` | ❌ custom floating div |
| Progress indicators | `progress` | ❌ custom progress bar |
| Skeleton loaders | `skeleton` | ❌ custom loading state |
| Breadcrumbs | `breadcrumb` | ❌ custom breadcrumb |
| File/folder tree | `collapsible` + custom tree | ❌ fully custom tree |

## Step 2: Check Radix UI Primitives

If shadcn/ui doesn't have it, check Radix UI primitives before building from scratch:
- https://www.radix-ui.com/primitives

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
- `sidebar/` — File tree and sidebar
- `tabs/` — Tab bar
- `settings/` — Settings UI
- `chat/` — AI chat panel
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Settings } from 'lucide-react';

export function SettingsButton() {
  return (
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
  );
}
```

## Reference

Read @docs/design-system.md for:
- Full color palette and CSS variable names
- Typography specs (fonts, sizes, weights)
- Spacing and layout guidelines
- Complete component specifications
- Detailed animation and transition patterns
