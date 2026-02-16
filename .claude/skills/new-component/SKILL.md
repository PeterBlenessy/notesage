---
name: new-component
description: Scaffold a new UI component with correct structure and styling
user-invocable: true
argument-hint: "<ComponentName>"
---

# New Component

Creates a new UI component following Notesage conventions and the design system.

## Process

### Step 1: Check shadcn/ui First

**NEVER build a custom component if shadcn/ui already has one.** Check the mapping:

| Need | shadcn/ui component |
|------|---------------------|
| Buttons | `button` |
| Dropdowns | `dropdown-menu` |
| Right-click menus | `context-menu` |
| Modals/dialogs | `dialog` + `alert-dialog` |
| Tab bar | `tabs` |
| Tooltips | `tooltip` |
| Toasts/notifications | `sonner` |
| Text inputs | `input` |
| Search/filter | `command` (cmdk) |
| Toggle switches | `switch` |
| Select/combobox | `select` or `combobox` |
| Separators | `separator` |
| Scroll areas | `scroll-area` |
| Resizable panels | `resizable` |
| Popovers | `popover` |
| Progress indicators | `progress` |
| Skeleton loaders | `skeleton` |
| Breadcrumbs | `breadcrumb` |
| File/folder tree | `collapsible` + custom tree |

**If shadcn/ui has it:**
1. Install: `pnpm dlx shadcn@latest add <component>`
2. Create thin wrapper in `src/components/` if customization needed
3. DO NOT create from scratch

### Step 2: Create Custom Component

**Only if shadcn/ui doesn't have it**, create a custom component.

**File location:**
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

### Step 3: Required Elements

#### Props Interface
```typescript
interface ComponentProps {
  title: string;        // Required props first
  description?: string; // Optional props after
  onClick?: () => void; // Event handlers
  className?: string;   // Style override
}
```

#### Styling Requirements
- **Colors**: CSS variables only (`bg-background`, `text-foreground`, etc.)
- **Spacing**: Tailwind scale (`p-4`, `gap-2`, not `p-[13px]`)
- **Border radius**: `rounded-lg` or `rounded` consistently
- **Transitions**: `transition-colors duration-150` on interactive elements
- **Icons**: lucide-react with `strokeWidth={1.5}`, sizes 16/18-20/24px

#### Interactive States
```typescript
className={cn(
  'base-styles',
  'transition-colors duration-150',
  'hover:bg-accent hover:text-accent-foreground',
  'active:scale-95',
  'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
  'disabled:opacity-50 disabled:cursor-not-allowed',
  className
)}
```

#### Dark Mode
- Use CSS variables (they handle both themes)
- Only add `dark:` classes for theme-specific overrides beyond variables

### Step 4: Export

```typescript
// src/components/<category>/index.ts
export { ComponentName } from './ComponentName';
```

### Step 5: Quality Check

Before completing, verify:

1. shadcn/ui checked first
2. Proper TypeScript interface for props
3. Absolute imports (`@/components/...`)
4. CSS variables for colors
5. Tailwind scale for spacing
6. Transitions on interactive elements
7. Hover/active/focus/disabled states
8. lucide-react icons with `strokeWidth={1.5}`
9. Works in both light and dark mode
10. Exported from index.ts

## Component Template

```tsx
import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExampleComponentProps {
  title: string;
  children?: ReactNode;
  onAction?: () => void;
  className?: string;
}

export function ExampleComponent({
  title,
  children,
  onAction,
  className,
}: ExampleComponentProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card p-4',
        'transition-colors duration-150',
        'hover:bg-accent/50',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">{title}</h3>
        {onAction && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onAction}
            className="transition-all duration-150 hover:scale-105"
          >
            <ChevronDown className="h-4 w-4" strokeWidth={1.5} />
          </Button>
        )}
      </div>
      {children && (
        <div className="mt-3 text-sm text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}
```

## Reference

- @docs/design-system.md — Full color palette, typography, spacing, component specs
- Use the `ui-component` skill for detailed styling guidelines
