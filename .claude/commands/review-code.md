---
description: Run a code review of recently changed files
agent: code-reviewer
---

# Code Review Command

Runs the code-reviewer agent on recently changed files to ensure code quality and convention adherence.

## Usage

```
/review-code
```

## What It Does

1. Finds all `.ts` and `.tsx` files that have been modified:
   - If git history exists: uses `git diff` to find changed files
   - If no git: reviews all files in `src/`

2. Runs the `code-reviewer` agent on those files

3. Presents findings organized by severity:
   - **Critical**: Will break or severely degrade code
   - **Warning**: Violates conventions, should fix
   - **Suggestion**: Could be better

## What Gets Checked

The code-reviewer agent checks for:

### TypeScript
- **No `any` types**: Use proper types or `unknown` with narrowing
- **Interfaces preferred**: Over type aliases for objects
- **Complete types**: All parameters and returns properly typed

### React
- **Functional components**: No class components
- **Hooks rules**: Called at top level, complete dependencies
- **One component per file**: Single responsibility

### Naming Conventions
- **PascalCase**: Components (`UserProfile`, `SettingsDialog`)
- **camelCase**: Functions and variables (`getUserData`, `isLoading`)
- **UPPER_SNAKE**: Constants (`MAX_FILE_SIZE`, `API_ENDPOINT`)
- **File names**: Match component names

### Imports
- **Absolute paths**: Use `@/` not `../../`
- **Organized**: Group by external, internal, relative

### shadcn/ui Usage
- **Don't rebuild**: Use shadcn/ui when it exists
- **Compose**: Extend shadcn/ui, don't fork

### Tauri Patterns
- **Result types**: Commands return `Result<T, String>`
- **Typed wrappers**: Frontend uses typed invoke wrappers
- **Error handling**: User-facing errors show toasts

### Store Patterns
- **Clear boundaries**: Each store has single responsibility
- **Persist correctly**: Using Zustand persist middleware
- **No global state**: Use appropriate store

### Editor/ProseMirror
- **No mutation**: Never mutate editor state directly
- **Use transactions**: Always use `editor.chain()` or dispatch

## Example Output

```markdown
## Critical Issues

### 1. Using `any` type
**File**: src/lib/utils.ts:23
**Issue**: `function processData(data: any)`
**Fix**: Define proper interface or use `unknown`

### 2. Direct editor state mutation
**File**: src/components/editor/Plugin.tsx:45
**Issue**: `editor.state.doc.content = newContent`
**Fix**: Use `editor.chain().setContent(newContent).run()`

## Warnings

### 3. Relative import paths
**File**: src/components/Header.tsx:3
**Issue**: `import { Button } from '../../ui/button'`
**Fix**: Use `import { Button } from '@/components/ui/button'`

### 4. Missing error toast
**File**: src/hooks/useFileSystem.ts:67
**Issue**: File save error only logged to console
**Fix**: Add `toast.error('Failed to save: ${error}')`

## Suggestions

### 5. Type alias instead of interface
**File**: src/types/user.ts:5
**Issue**: `type User = { name: string }`
**Fix**: `interface User { name: string }`
```

## When to Use

Run this command:

- **Before creating a PR**: Catch issues early
- **After code changes**: Verify conventions followed
- **Learning**: Understand project patterns
- **Refactoring**: Ensure consistency maintained

## Workflow

Typical workflow:

```bash
# 1. Write code
# Edit src/components/MyComponent.tsx

# 2. Run code review
/review-code

# 3. Fix critical and warning issues
# Address the feedback

# 4. Run type check
pnpm typecheck

# 5. Re-run to verify
/review-code

# 6. Commit when clean
git commit -m "Add feature with proper types"
```

## Quick Fixes Reference

### Common Issues and Fixes

**Using `any` type:**
```diff
- function process(data: any) {
+ interface ProcessData {
+   name: string;
+   value: number;
+ }
+ function process(data: ProcessData) {
```

**Relative imports:**
```diff
- import { Button } from '../../../components/ui/button';
+ import { Button } from '@/components/ui/button';
```

**Missing error toast:**
```diff
  try {
    await saveFile(path, content);
  } catch (error) {
    console.error(error);
+   toast.error(`Failed to save: ${error}`);
  }
```

**Incomplete useEffect dependencies:**
```diff
  useEffect(() => {
    fetchData(userId);
- }, []);
+ }, [userId]);
```

**Class component:**
```diff
- class MyComponent extends React.Component {
-   render() { return <div />; }
- }
+ export function MyComponent() {
+   return <div />;
+ }
```

**Direct mutation:**
```diff
- editor.state.doc = newDoc;
+ editor.chain().setContent(newContent).run();
```

**Type alias for object:**
```diff
- type User = {
+ interface User {
    name: string;
  }
```

## False Positives

If the reviewer flags something incorrectly:

1. **Verify it's wrong**: Sometimes conventions have exceptions
2. **Document why**: Add comment explaining the exception
3. **Consider refactoring**: Maybe the pattern is outdated
4. **Update conventions**: If the pattern should be allowed, update docs

## Integration with Development

Use in combination with:

- **TypeScript compiler**: `pnpm typecheck`
- **Linter**: ESLint rules (if configured)
- **Pre-commit hook**: Auto-run on changed files
- **CI/CD**: Run in PR checks
- **Code review**: Reference in PR feedback

## Advanced Usage

### Review specific files

Manually specify files by editing the command logic to accept arguments:

```bash
# Future enhancement - not yet implemented
/review-code src/components/MyComponent.tsx src/hooks/useData.ts
```

### Review by domain

Focus on specific areas:

```bash
# Review only stores
/review-code  # Then manually filter for src/stores/*.ts

# Review only components
/review-code  # Then manually filter for src/components/**/*.tsx
```

## TypeScript Configuration

Ensure `tsconfig.json` is properly configured:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

## Reference

The code-reviewer agent reads:
- @CLAUDE.md - Code conventions
- @docs/architecture.md - Architecture patterns

You can manually review those files to understand all coding standards.
