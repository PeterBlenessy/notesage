---
name: markdown-roundtrip
description: Use when modifying markdown parsing, serialization, Tiptap schema changes, or any code that affects how markdown is converted to/from the ProseMirror document model.
---

# Markdown Round-Trip Integrity

## Critical Rule

**Markdown round-tripping MUST be lossless.**

```
.md file → Parse → ProseMirror document → Serialize → .md file
```

The input and output markdown must be equivalent (whitespace-normalized).

## Library Used

Check which library is configured:
- **tiptap-markdown** - Tiptap extension for markdown support
- **prosemirror-markdown** - Direct ProseMirror markdown integration

Located in: `src/lib/markdown.ts` or integrated in editor setup.

## Supported Syntax

All of these must round-trip correctly:

### Block Elements
- **Headings**: `# H1` through `###### H6`
- **Paragraphs**: Regular text blocks
- **Lists**:
  - Bullet lists: `- item` or `* item`
  - Ordered lists: `1. item`
  - Task lists: `- [ ] unchecked` and `- [x] checked`
- **Blockquotes**: `> quote text`
- **Code blocks**: Triple backticks with optional language
  ```markdown
  ```javascript
  code here
  ```
  ```
- **Horizontal rules**: `---` or `***`
- **Tables**:
  ```markdown
  | Header 1 | Header 2 |
  |----------|----------|
  | Cell 1   | Cell 2   |
  ```

### Inline Elements
- **Bold**: `**bold**` or `__bold__`
- **Italic**: `*italic*` or `_italic_`
- **Strikethrough**: `~~strikethrough~~`
- **Inline code**: `` `code` ``
- **Links**: `[text](url)` and `[text](url "title")`
- **Images**: `![alt](path)` and `![alt](path "title")`

## Testing Approach

### Test Fixtures

Maintain test fixtures in `tests/fixtures/*.md` covering all syntax:

```
tests/fixtures/
├── headings.md           # All heading levels
├── lists.md              # Bullet, ordered, task lists
├── formatting.md         # Bold, italic, strikethrough, code
├── links-images.md       # Links and images
├── code-blocks.md        # Various code block languages
├── tables.md             # Table formatting
├── blockquotes.md        # Quote formatting
└── complex.md            # Combination of all features
```

### Round-Trip Test

```typescript
import { describe, it, expect } from 'vitest';
import { parseMarkdown, serializeMarkdown } from '@/lib/markdown';

describe('Markdown Round-Trip', () => {
  const fixtures = [
    'headings',
    'lists',
    'formatting',
    'links-images',
    'code-blocks',
    'tables',
    'blockquotes',
    'complex',
  ];

  fixtures.forEach((fixture) => {
    it(`should round-trip ${fixture}.md`, async () => {
      const original = await readFixture(`${fixture}.md`);
      const doc = parseMarkdown(original);
      const output = serializeMarkdown(doc);

      // Normalize whitespace for comparison
      expect(normalize(output)).toBe(normalize(original));
    });
  });
});

function normalize(markdown: string): string {
  return markdown
    .trim()
    .replace(/\r\n/g, '\n')           // Normalize line endings
    .replace(/\n{3,}/g, '\n\n')       // Max 2 consecutive newlines
    .replace(/[ \t]+$/gm, '');        // Remove trailing whitespace
}
```

### Run Tests

```bash
pnpm test:roundtrip    # Run markdown round-trip tests
pnpm test              # Run all tests including round-trip
```

## Common Pitfalls

### 1. Trailing Whitespace

**Problem**: Extra spaces at end of lines

```markdown
# Heading    ← Trailing spaces
```

**Solution**: Strip trailing whitespace in serialization

```typescript
const serialized = serialize(doc)
  .replace(/[ \t]+$/gm, ''); // Remove trailing spaces
```

### 2. Blank Line Handling

**Problem**: Inconsistent blank lines between blocks

```markdown
# Heading

Paragraph
```

**Solution**: Ensure consistent spacing (one blank line between blocks)

### 3. List Indentation

**Problem**: Nested lists with wrong indentation

```markdown
- Item 1
  - Nested ← Should be 2 spaces, not 4
```

**Solution**: Configure markdown serializer for 2-space indentation

### 4. Table Alignment

**Problem**: Table column alignment markers lost

```markdown
| Left | Center | Right |
|:-----|:------:|------:|
```

**Solution**: Preserve alignment in table schema

### 5. Image Alt Text

**Problem**: Image alt text contains special characters

```markdown
![Image with "quotes"](path)
```

**Solution**: Properly escape alt text in serialization

### 6. Code Block Language

**Problem**: Code block language identifier lost

```markdown
```javascript  ← Must preserve language
const x = 1;
```
```

**Solution**: Store language in code block node attributes

## Schema Modifications

When modifying Tiptap schema, ensure backward compatibility:

### Adding New Node Type

```typescript
const NewNode = Node.create({
  name: 'newNode',

  // Define markdown parsing
  parseHTML() {
    return [{ tag: 'new-node' }];
  },

  // Define markdown serialization
  addAttributes() {
    return {
      markdownAttrs: {
        default: null,
      },
    };
  },

  // Markdown serialization rule
  serializeMarkdown(state, node) {
    state.write('<!-- new node -->');
    state.renderContent(node);
    state.write('<!-- /new node -->');
  },
});
```

### Testing Schema Changes

After any schema change:
1. Run full test suite: `pnpm test`
2. Run round-trip tests: `pnpm test:roundtrip`
3. Manually test with real documents
4. Check for breaking changes in existing documents

## Markdown Normalization

Some normalization is acceptable:

### Acceptable Changes
- **Whitespace**: Trailing spaces removed, consistent line endings
- **Heading markers**: `# Heading` preferred over `Heading\n=====`
- **List markers**: `-` preferred over `*` for bullets
- **Emphasis**: `**bold**` preferred over `__bold__`
- **Blank lines**: Consistent spacing between blocks

### Unacceptable Changes
- **Content loss**: Any text, links, or formatting lost
- **Semantic changes**: Heading level changes, list type changes
- **Order changes**: List items reordered, table rows shuffled
- **Attribute loss**: Link titles, image alt text, code block languages lost

## Debugging Round-Trip Issues

### 1. Add Logging

```typescript
function debugRoundTrip(markdown: string) {
  console.log('Original:', markdown);

  const doc = parseMarkdown(markdown);
  console.log('Parsed doc:', doc.toJSON());

  const output = serializeMarkdown(doc);
  console.log('Serialized:', output);

  console.log('Match:', markdown === output);
}
```

### 2. Check Schema

```typescript
// Verify all nodes have markdown serialization
editor.schema.nodes.forEach((node, name) => {
  if (!node.spec.toMarkdown) {
    console.warn(`Node ${name} missing markdown serialization`);
  }
});
```

### 3. Test Incremental Changes

When fixing issues:
1. Create minimal test case
2. Fix that specific case
3. Verify all other tests still pass
4. Add test to fixture suite

## Integration with Editor

### Parsing (Load File)

```typescript
export async function openFile(path: string, editor: Editor) {
  const markdown = await invoke<string>('read_file', { path });
  const doc = parseMarkdown(markdown);
  editor.commands.setContent(doc);
}
```

### Serialization (Save File)

```typescript
export async function saveFile(path: string, editor: Editor) {
  const doc = editor.state.doc;
  const markdown = serializeMarkdown(doc);
  await invoke('write_file', { path, content: markdown });
}
```

### Auto-Save

```typescript
useEffect(() => {
  if (!editor) return;

  const autosave = debounce(() => {
    const markdown = serializeMarkdown(editor.state.doc);
    saveFile(currentPath, markdown);
  }, 1000);

  editor.on('update', autosave);

  return () => {
    editor.off('update', autosave);
  };
}, [editor, currentPath]);
```

## Reference

Read @docs/product-description.md for:
- Complete list of required markdown features
- Quality gates for markdown support
- Testing requirements
