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

### Standalone

```typescript
import { useEditor } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { CustomExtension } from './extensions/custom-extension';

const editor = useEditor({
  extensions: [
    Document,
    Paragraph,
    Text,
    CustomExtension,
  ],
});
```

## ProseMirror Core Concepts

### Schema
Defines what content is allowed in the document

```typescript
// Tiptap handles schema definition through extensions
// Each Node/Mark extension contributes to the schema
```

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

### Plugins
Low-level ProseMirror functionality

```typescript
import { Plugin, PluginKey } from '@tiptap/pm/state';

const myPlugin = new Plugin({
  key: new PluginKey('myPlugin'),

  state: {
    init() {
      return {};
    },
    apply(tr, value, oldState, newState) {
      // Update plugin state
      return value;
    },
  },

  view() {
    return {
      update(view, prevState) {
        // Called when editor updates
      },
      destroy() {
        // Cleanup
      },
    };
  },
});
```

## File Location & Organization

Custom extensions go in:
```
src/components/editor/extensions/
├── index.ts                    # Re-export all extensions
├── slash-command.ts           # Slash command menu
├── ai-decoration.ts           # AI suggestion decorations
└── custom-extension.ts        # Your custom extension
```

**Export pattern:**

```typescript
// custom-extension.ts
export const CustomExtension = Extension.create({
  name: 'customExtension',
  // ...
});

// index.ts
export { CustomExtension } from './custom-extension';
export { SlashCommand } from './slash-command';
export { AIDecoration } from './ai-decoration';
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
Decorations are used for AI suggestions and inline diffs (Phase 5). Use unique PluginKeys:

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

## Decoration Use Cases

**AI Decorations** are used for inline AI suggestions:
- Green decorations for insertions
- Red decorations for deletions
- Accept with Cmd+Enter
- Reject with Cmd+Backspace

**Inline Diffs (Phase 5)** will use decorations for external change tracking:
- Show additions/deletions when files change on disk (e.g., from agentic AI)
- Accept/reject per-change controls (Track Changes style)

**Comments (Phase 5)** will use Tiptap marks for inline comment anchors.

When creating decorations:
- Use unique decoration types
- Don't interfere with selection
- Support undo/redo
- Clean up on editor destroy

## Reference

Read @docs/architecture.md for:
- Editor architecture principles
- State management patterns
- Data flow diagrams
- ProseMirror integration details
