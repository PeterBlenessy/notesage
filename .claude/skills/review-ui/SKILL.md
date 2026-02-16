---
name: review-ui
description: Run a design review of recently changed UI components
user-invocable: true
agent: design-reviewer
---

# UI Design Review

Runs the design-reviewer agent on recently changed UI components.

## What It Does

1. Finds all `.tsx` files that have been modified:
   - If git history exists: uses `git diff` to find changed files
   - If no git: reviews all `.tsx` files in `src/components/`

2. Runs the `design-reviewer` agent on those files

3. Presents findings organized by severity:
   - **Critical**: Breaks design system, blocks merge
   - **Warning**: Looks unprofessional, should fix
   - **Suggestion**: Could be better

## What Gets Checked

- **shadcn/ui usage**: Are you building custom components that already exist in shadcn/ui?
- **Color system**: Hardcoded hex values vs CSS variables
- **Interactive states**: Missing hover/active/focus states
- **Transitions**: Abrupt vs smooth state changes
- **Dark mode**: Does it work in both light and dark themes?
- **Typography**: Consistent fonts, sizes, weights
- **Spacing**: Tailwind scale vs arbitrary values
- **Border radius**: Consistent across components
- **Premium feel**: Does it look like Linear, Bear, or Craft?
- **Icons**: lucide-react with correct sizing and weight

## Quick Fixes Reference

**Hardcoded colors:**
```diff
- className="bg-[#3B82F6] text-white"
+ className="bg-primary text-primary-foreground"
```

**Missing hover state:**
```diff
- className="rounded px-2 py-1"
+ className="rounded px-2 py-1 hover:bg-accent transition-colors duration-150"
```

**Missing transitions:**
```diff
- className="bg-background"
+ className="bg-background transition-colors duration-150"
```

**Arbitrary spacing:**
```diff
- className="p-[13px] gap-[7px]"
+ className="p-3 gap-2"
```

**Wrong icon sizing:**
```diff
- <Settings className="h-5 w-5" />
+ <Settings className="h-4 w-4" strokeWidth={1.5} />
```

## When to Use

- **Before creating a PR**: Catch design issues early
- **After UI changes**: Verify changes meet standards
- **When unsure**: Get feedback on component styling
- **Regular check-ins**: Ensure consistency across codebase

## Reference

The design-reviewer agent reads @docs/design-system.md for complete requirements.
