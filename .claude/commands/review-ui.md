---
description: Run a design review of recently changed UI components
agent: design-reviewer
---

# UI Design Review Command

Runs the design-reviewer agent on recently changed UI components.

## Usage

```
/review-ui
```

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

The design-reviewer agent checks for:

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

## Example Output

```markdown
## Critical Issues

### 1. Hardcoded colors in CustomButton
**File**: src/components/CustomButton.tsx:15
**Issue**: Using `bg-[#3B82F6]` instead of CSS variable
**Fix**: Replace with `bg-primary`

### 2. Should use shadcn/ui Dialog
**File**: src/components/Modal.tsx
**Issue**: Custom modal implementation
**Fix**: Delete file and use: `pnpm dlx shadcn@latest add dialog`

## Warnings

### 3. Missing hover state
**File**: src/components/Sidebar.tsx:42
**Issue**: File items have no hover effect
**Fix**: Add `hover:bg-accent transition-colors duration-150`

## Suggestions

### 4. Inconsistent spacing
**File**: src/components/Header.tsx:8
**Issue**: Using `p-[13px]` instead of Tailwind scale
**Fix**: Use `p-3` (12px) or `p-4` (16px)
```

## When to Use

Run this command:

- **Before creating a PR**: Catch design issues early
- **After UI changes**: Verify changes meet standards
- **When unsure**: Get feedback on component styling
- **Regular check-ins**: Ensure consistency across codebase

## Workflow

Typical workflow:

```bash
# 1. Make UI changes
# Edit src/components/MyComponent.tsx

# 2. Run design review
/review-ui

# 3. Fix critical and warning issues
# Address the feedback

# 4. Re-run to verify
/review-ui

# 5. Commit when clean
git commit -m "Add MyComponent with design system compliance"
```

## Quick Fixes Reference

### Common Issues and Fixes

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

**Default focus ring:**
```diff
- <input className="border rounded" />
+ <input className="border rounded focus:outline-none focus:ring-2 focus:ring-primary" />
```

**Wrong icon sizing:**
```diff
- <Settings className="h-5 w-5" />
+ <Settings className="h-4 w-4" strokeWidth={1.5} />
```

## False Positives

If the reviewer flags something incorrectly:

1. **Explain the context**: Sometimes custom implementations are necessary
2. **Document why**: Add a comment explaining the exception
3. **Verify it's necessary**: Double-check shadcn/ui doesn't have it
4. **Keep it clean**: Even custom components should follow design system

## Integration with Development

Use in combination with:

- **Pre-commit hook**: Auto-run on changed files
- **CI/CD**: Run in PR checks
- **Code review**: Reference in PR descriptions
- **Documentation**: Track common issues

## Reference

The design-reviewer agent reads @docs/design-system.md for complete requirements.

You can manually review that file to understand all design standards.
