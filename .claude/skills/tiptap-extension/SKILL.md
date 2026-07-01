---
name: tiptap-extension
description: Use when creating or modifying Tiptap editor extensions, ProseMirror plugins, or working with the editor's document model, decorations, or transactions.
---

# Tiptap Extension Development

## Tiptap Extension Types

### Node
Block-level content (headings, paragraphs, code blocks, tables)

```typescript
import { Node } from '@tiptap/core';

export const CustomNode = Node.create({
  name: 'customNode',

  // Define what content is allowed
  content: 'block+',

  // HTML parsing rules
  parseHTML() {
    return [{ tag: 'custom-node' }];
  },

  // HTML rendering
  renderHTML({ HTMLAttributes }) {
    return ['custom-node', HTMLAttributes, 0];
  },

  // Commands
  addCommands() {
    return {
      setCustomNode: () => ({ commands }) => {
        return commands.setNode(this.name);
      },
    };
  },
});
```

### Mark
Inline formatting (bold, italic, links, code)

```typescript
import { Mark } from '@tiptap/core';

export const CustomMark = Mark.create({
  name: 'customMark',

  // HTML parsing
  parseHTML() {
    return [{ tag: 'custom-mark' }];
  },

  // HTML rendering
  renderHTML({ HTMLAttributes }) {
    return ['custom-mark', HTMLAttributes, 0];
  },

  // Commands
  addCommands() {
    return {
      toggleCustomMark: () => ({ commands }) => {
        return commands.toggleMark(this.name);
      },
    };
  },
});
```

### Extension
General functionality (plugins, keyboard shortcuts, decorations)

```typescript
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export const CustomExtension = Extension.create({
  name: 'customExtension',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('customPlugin'),
        // Plugin logic here
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-X': () => this.editor.commands.customCommand(),
    };
  },
});
```

## Registration Patterns

### With StarterKit (Recommended)

```typescript
import StarterKit from '@tiptap/starter-kit';
import { CustomExtension } from './extensions/custom-extension';

const editor = useEditor({
  extensions: [
    StarterKit,
    CustomExtension,
  ],
});
```

In this repo the editor's extension list is assembled in `src/hooks/useEditor.ts`
(the production extension set). Add new extensions there.

## ProseMirror Core Concepts

### Transactions
**CRITICAL:** Never mutate editor state directly. Always use transactions.

```typescript
// ✅ CORRECT - Use commands/transactions
editor.chain()
  .focus()
  .insertContent('Hello')
  .run();

// ❌ WRONG - Never do this
editor.state.doc.content = newContent;
```

### Decorations
Visual overlays that don't modify the document (for AI suggestions, search highlights)

```typescript
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const decorationPlugin = new Plugin({
  key: new PluginKey('decorations'),

  state: {
    init: () => DecorationSet.empty,
    apply(tr, decorations) {
      // Update decorations based on transaction
      return decorations.map(tr.mapping, tr.doc);
    },
  },

  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});
```

## File Location & Organization

Custom extensions go in:
```
src/components/editor/extensions/
├── index.ts                    # Re-export all extensions
├── slash-command.tsx           # Slash command menu
├── ai-suggestion.ts            # AI suggestion inline-diff decorations
├── decoration-factory.ts       # Shared createDecorationPlugin() helper
└── custom-extension.ts         # Your custom extension
```

**Export pattern (matches the real `index.ts`):**

```typescript
// custom-extension.ts
export const CustomExtension = Extension.create({
  name: 'customExtension',
  // ...
});

// index.ts — re-exports the extension plus its command/helper functions
export {
  AISuggestion,
  AISuggestionPluginKey,
  setSuggestion,
  clearSuggestion,
  hasActiveSuggestion,
} from './ai-suggestion';
export { CustomExtension } from './custom-extension';
```

**Usage in editor:**

```typescript
import { CustomExtension } from './extensions';

const editor = useEditor({
  extensions: [
    StarterKit,
    CustomExtension,
  ],
});
```

## Key Rules

### 1. Never Mutate State Directly
Always use `editor.chain()` or dispatch transactions.

### 2. Keep Decorations Namespace Clean
Decorations drive AI suggestions, inline diffs, comment marks, search
highlights, tag/mention/date badges, and ghost-text completions — all shipped.
Use unique PluginKeys:

```typescript
new PluginKey('myFeature') // ✅ Specific
new PluginKey('decoration') // ❌ Too generic, will conflict
```

### 3. Handle Edge Cases
- Empty document
- Selection at document boundaries
- Multiple simultaneous transactions
- Undo/redo compatibility

### 4. TypeScript Types
Use proper types from Tiptap and ProseMirror:

```typescript
import { Editor } from '@tiptap/core';
import { EditorState, Transaction } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { Node as PMNode } from '@tiptap/pm/model';
```

## Common Patterns

### Adding a Command

```typescript
addCommands() {
  return {
    myCommand: (attrs) => ({ commands, state, dispatch }) => {
      // Implement command logic
      return true; // Return true if command succeeded
    },
  };
}
```

### Keyboard Shortcuts

```typescript
addKeyboardShortcuts() {
  return {
    'Mod-k': () => this.editor.commands.myCommand(),
    'Enter': ({ editor }) => {
      // Custom logic
      return false; // Return false to let default behavior run
    },
  };
}
```

### Input Rules (Markdown Shortcuts)

```typescript
import { InputRule } from '@tiptap/core';

addInputRules() {
  return [
    new InputRule({
      find: /(?:^|\s)((?:~~)((?:[^~]+))(?:~~))$/,
      handler: ({ state, range, match }) => {
        // Convert ~~text~~ to strikethrough
      },
    }),
  ];
}
```

## Decoration Use Cases (all shipped)

**AISuggestion** (`ai-suggestion.ts`) — inline AI suggestion diffs: green for
insertions, red for deletions; accept with `Cmd+Enter`, reject with
`Cmd+Backspace`. Exposes `setSuggestion` / `hasActiveSuggestion`.

**InlineDiff** (`inline-diff.ts`) — a singleton decoration layer shared by
external-change review and git branch diff review; per-hunk accept/reject.

**CommentMark** (`comment-mark.ts`) — inline comment-anchor decorations with
status classes (`comment-open`, `comment-delegated`, `comment-done`); remapped
positions sync back to the store on every `docChanged`.

Other shipped decoration extensions: `SearchHighlight`, `TagHighlight`,
`MentionHighlight`, `DateHighlight`, `GhostText`, and the table extensions.

### Shared factory — `createDecorationPlugin`

Simple decoration extensions (init from state, rebuild on `docChanged`, expose
via `props.decorations()`) should use `createDecorationPlugin` from
`decoration-factory.ts` instead of hand-rolling the boilerplate. Real users:
`tag-highlight.ts`, `mention-highlight.ts`, `date-highlight.ts`,
`table-sparkline.ts`. Complex extensions with unique state management
(`search-highlight`, `comment-mark`, `ghost-text`, `inline-diff`) define their
plugins manually.

When creating decorations:
- Use unique PluginKeys / decoration types
- Don't interfere with selection
- Support undo/redo
- Clean up on editor destroy

## Reference

Read `docs/features/editor-architecture.md` for the authoritative deep
reference — the full custom-extension inventory (every extension, its file, and
type), the decoration system patterns, the per-tab EditorState cache, plugin
state patterns (CommentMark, SearchHighlight, InlineDiff, GhostText), and
markdown round-tripping.

`docs/features/editor.md` covers the user-facing feature surface; `docs/architecture.md`
covers the broader app (stores, IPC, security).
