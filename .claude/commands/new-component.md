---
description: Scaffold a new UI component with correct structure and styling
---

# New Component Command

Creates a new UI component following Notesage conventions.

## Usage

```
/new-component ComponentName
```

## Process

### Step 1: Check shadcn/ui

Before creating any custom component, check if shadcn/ui has it:

```bash
# Common components that should use shadcn/ui:
# button, dialog, dropdown-menu, tooltip, input, select, switch, tabs, etc.
```

**If shadcn/ui has it:**
1. Install: `pnpm dlx shadcn@latest add <component>`
2. Create thin wrapper in `src/components/` if customization needed
3. DO NOT create from scratch

**Example wrapper:**
```tsx
// src/components/IconButton.tsx
import { Button, type ButtonProps } from '@/components/ui/button';
import { type LucideIcon } from 'lucide-react';

interface IconButtonProps extends ButtonProps {
  icon: LucideIcon;
}

export function IconButton({ icon: Icon, ...props }: IconButtonProps) {
  return (
    <Button variant="ghost" size="icon" {...props}>
      <Icon className="h-4 w-4" strokeWidth={1.5} />
    </Button>
  );
}
```

### Step 2: Create Custom Component

**Only if shadcn/ui doesn't have it**, create a custom component.

**File location:**
```
src/components/<category>/<ComponentName>.tsx
```

**Categories:**
- `editor/` - Tiptap editor components
- `sidebar/` - File tree and sidebar
- `tabs/` - Tab bar
- `settings/` - Settings UI
- `chat/` - AI chat panel
- Generic: `src/components/<ComponentName>.tsx`

**Template:**

```typescript
// src/components/example/ExampleComponent.tsx
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
        // Base styles
        'rounded-lg border border-border bg-card p-4',
        // Transitions
        'transition-colors duration-150',
        // Hover state
        'hover:bg-accent/50',
        // Dark mode support (if needed beyond CSS variables)
        // 'dark:border-white/10',
        className
      )}
    >
      {/* Header */}
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

      {/* Content */}
      {children && (
        <div className="mt-3 text-sm text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}
```

### Step 3: Required Elements

Every component must have:

#### Props Interface
```typescript
interface ComponentProps {
  // Required props first
  title: string;
  // Optional props after
  description?: string;
  // Event handlers
  onClick?: () => void;
  // Style override
  className?: string;
}
```

#### Styling Requirements
- **Colors**: CSS variables only (`bg-background`, `text-foreground`, etc.)
- **Spacing**: Tailwind scale (`p-4`, `gap-2`, not `p-[13px]`)
- **Border radius**: `rounded-lg` or `rounded` consistently
- **Transitions**: `transition-colors duration-150` on interactive elements

#### Interactive States
```typescript
className={cn(
  'base-styles',
  'transition-colors duration-150',      // Smooth transitions
  'hover:bg-accent hover:text-accent-foreground',  // Hover
  'active:scale-95',                      // Active
  'focus:outline-none focus:ring-2 focus:ring-primary',  // Focus
  'disabled:opacity-50 disabled:cursor-not-allowed',  // Disabled
  className  // Allow override
)}
```

#### Icons
```typescript
import { Settings } from 'lucide-react';

<Settings className="h-4 w-4" strokeWidth={1.5} />
```

#### Dark Mode
- Use CSS variables (they handle both themes)
- Only add `dark:` classes if you need theme-specific overrides beyond variables

### Step 4: Export

Create index file for easy imports:

```typescript
// src/components/example/index.ts
export { ExampleComponent } from './ExampleComponent';
export type { ExampleComponentProps } from './ExampleComponent';
```

### Step 5: Quality Check

Before completing, verify:

1. ✅ shadcn/ui checked first
2. ✅ Proper TypeScript interface for props
3. ✅ Absolute imports (`@/components/...`)
4. ✅ CSS variables for colors
5. ✅ Tailwind scale for spacing
6. ✅ Transitions on interactive elements
7. ✅ Hover/active/focus/disabled states
8. ✅ lucide-react icons with strokeWidth={1.5}
9. ✅ Works in both light and dark mode
10. ✅ Exported from index.ts

## Examples by Type

### Button Variant
```tsx
// Already exists in shadcn/ui - use that!
import { Button } from '@/components/ui/button';
```

### List Item Component
```tsx
export function ListItem({ label, icon: Icon, active, onClick }: ListItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm',
        'transition-colors duration-150',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={1.5} />
      <span>{label}</span>
    </button>
  );
}
```

### Panel/Container Component
```tsx
export function Panel({ title, children }: PanelProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
```

## Reference

Use the `ui-component` skill for detailed styling guidelines.

Read @docs/design-system.md for complete component specifications.
