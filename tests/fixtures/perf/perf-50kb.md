# Comprehensive Guide to Desktop Application Architecture

This document provides an in-depth exploration of building **modern desktop applications** using web technologies. It covers *architecture patterns*, state management, editor engines, AI integration, testing strategies, and deployment pipelines.

## Table of Contents

1. Introduction
2. Architecture Patterns
3. Editor Engine Deep Dive
4. State Management Patterns
5. AI Provider Integration
6. Security Model
7. Performance Engineering
8. Testing and Quality
9. Deployment and Distribution
10. Appendices

---

## 1. Introduction

Building desktop applications with web technologies has evolved significantly over the past decade. The emergence of **Tauri** as a lightweight alternative to Electron has opened new possibilities for creating performant, secure, and small-footprint applications.

### Why Desktop?

Despite the dominance of web applications, desktop apps offer several advantages:

- **Offline capability**: Full functionality without network connectivity
- **System integration**: Access to native APIs, file system, and OS features
- **Performance**: No browser overhead, direct GPU access
- **Privacy**: Data stays on the user's device by default

> The best tools feel invisible. A desktop editor should respond to keystrokes instantly, save files reliably, and never lose the user's work. Everything else is secondary.

### Project Goals

- [x] Build a rich text markdown editor with lossless round-tripping
- [x] Support multiple AI providers for writing assistance
- [x] Package as a native macOS application under 15MB
- [x] Achieve sub-second startup time
- [ ] Add collaborative editing via CRDTs
- [ ] Build an iOS companion app

Tagged as #architecture #overview by @peter.

---

## 2. Architecture Patterns

The application follows a **layered architecture** with strict boundaries between the desktop shell, frontend UI, and backend services.

### Layer Diagram

```
┌─────────────────────────────────────┐
│         Frontend (React + TS)        │
│  Components │ Hooks │ Stores │ Lib   │
├─────────────────────────────────────┤
│         Tauri IPC Bridge             │
│     invoke() / listen() / emit()     │
├─────────────────────────────────────┤
│         Backend (Rust)               │
│  Commands │ Index │ Export │ State    │
├─────────────────────────────────────┤
│         Operating System             │
│  FileSystem │ Keychain │ Network     │
└─────────────────────────────────────┘
```

### Communication Patterns

All frontend-to-backend communication uses **Tauri IPC commands**. The frontend never directly accesses the filesystem, network, or OS APIs.

```typescript
import { invoke } from '@tauri-apps/api/core';

// Read a file through the security boundary
async function readDocument(path: string): Promise<string> {
  try {
    const content = await invoke<string>('read_file', { path });
    return content;
  } catch (error) {
    toast.error(`Failed to read file: ${error}`);
    throw error;
  }
}

// Write with self-write marking to prevent false change events
async function saveDocument(path: string, content: string): Promise<void> {
  await invoke('mark_self_write', { path });
  await invoke('write_file', { path, content });
}
```

### Error Handling Pattern

Every Tauri command returns `Result<T, String>`. The frontend wraps all calls in try-catch blocks and displays user-friendly error messages via toast notifications.

| Error Type | Frontend Response | User Message |
| --- | --- | --- |
| File not found | Remove from tab list | "File was deleted or moved" |
| Permission denied | Show in status bar | "Cannot write to this location" |
| Network timeout | Retry with backoff | "Connection lost, retrying..." |
| Parse error | Show raw content | "Could not parse markdown" |
| AI provider error | Show error in chat | Provider-specific message |

Reviewed by @elena during the #error-handling sprint.

---

## 3. Editor Engine Deep Dive

The editor is the heart of the application, built on **Tiptap v2** which wraps ProseMirror with a composable extension system.

### Why ProseMirror?

ProseMirror was chosen over simpler alternatives for several critical reasons:

1. **Decoration system** enables inline AI suggestions without modifying the document
2. **Plugin architecture** allows comment marks, search highlights, and ghost text
3. **Transaction model** provides reliable undo/redo across complex operations
4. **CRDT compatibility** enables future collaborative editing

> We evaluated CodeMirror, Slate, Lexical, and Monaco before settling on ProseMirror via Tiptap. The decoration system was the deciding factor — no other editor allows overlaying visual elements on arbitrary text ranges without altering the document model.

### Schema Definition

The editor schema defines the structure of valid documents:

```typescript
import { Schema } from '@tiptap/pm/model';

// Tiptap manages the schema through extensions, but conceptually:
const nodes = {
  doc: { content: 'block+' },
  paragraph: { content: 'inline*', group: 'block' },
  heading: { attrs: { level: { default: 1 } }, content: 'inline*', group: 'block' },
  blockquote: { content: 'block+', group: 'block' },
  code_block: { attrs: { language: { default: null } }, content: 'text*', group: 'block' },
  bullet_list: { content: 'list_item+', group: 'block' },
  ordered_list: { attrs: { start: { default: 1 } }, content: 'list_item+', group: 'block' },
  task_list: { content: 'task_item+', group: 'block' },
  list_item: { content: 'paragraph block*' },
  task_item: { attrs: { checked: { default: false } }, content: 'paragraph block*' },
  table: { content: 'table_row+', group: 'block' },
  table_row: { content: '(table_cell | table_header)+' },
  table_cell: { content: 'block+' },
  table_header: { content: 'block+' },
  horizontal_rule: { group: 'block' },
  image: { attrs: { src: {}, alt: { default: null }, title: { default: null } }, group: 'block' },
  hard_break: { inline: true, group: 'inline' },
  text: { group: 'inline' },
};

const marks = {
  bold: {},
  italic: {},
  underline: {},
  strikethrough: {},
  code: {},
  link: { attrs: { href: {}, title: { default: null } } },
  highlight: { attrs: { color: { default: 'yellow' } } },
  textColor: { attrs: { color: { default: null } } },
};
```

### Custom Extensions

The application includes several custom Tiptap extensions:

#### Ghost Text Extension

Renders AI completion suggestions as translucent text at the cursor position:

```typescript
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const ghostTextKey = new PluginKey('ghostText');

export const GhostText = Extension.create({
  name: 'ghostText',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: ghostTextKey,
        state: {
          init: () => ({ text: null, pos: null }),
          apply(tr, value) {
            const meta = tr.getMeta(ghostTextKey);
            if (meta !== undefined) return meta;
            if (tr.docChanged) return { text: null, pos: null };
            return value;
          },
        },
        props: {
          decorations(state) {
            const { text, pos } = ghostTextKey.getState(state);
            if (!text || pos === null) return DecorationSet.empty;

            const widget = document.createElement('span');
            widget.className = 'ghost-text';
            widget.textContent = text;

            return DecorationSet.create(state.doc, [
              Decoration.widget(pos, widget, { side: 1 }),
            ]);
          },
          handleKeyDown(view, event) {
            const { text, pos } = ghostTextKey.getState(view.state);
            if (!text) return false;

            if (event.key === 'Tab') {
              event.preventDefault();
              view.dispatch(
                view.state.tr
                  .insertText(text, pos)
                  .setMeta(ghostTextKey, { text: null, pos: null })
              );
              return true;
            }

            if (event.key === 'Escape') {
              view.dispatch(
                view.state.tr.setMeta(ghostTextKey, { text: null, pos: null })
              );
              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});
```

#### Search Highlight Extension

Highlights find-in-document matches with distinct styling for the current match:

```typescript
function buildSearchDecorations(
  doc: Node,
  query: string,
  currentIndex: number
): DecorationSet {
  if (!query) return DecorationSet.empty;

  const decorations: Decoration[] = [];
  const lowerQuery = query.toLowerCase();
  let matchIndex = 0;

  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text!.toLowerCase();
    let searchFrom = 0;

    while (true) {
      const found = text.indexOf(lowerQuery, searchFrom);
      if (found === -1) break;

      const from = pos + found;
      const to = from + query.length;
      const className = matchIndex === currentIndex
        ? 'search-match-current'
        : 'search-match-other';

      decorations.push(Decoration.inline(from, to, { class: className }));
      matchIndex++;
      searchFrom = found + 1;
    }
  });

  return DecorationSet.create(doc, decorations);
}
```

### Markdown Conversion

The markdown parser and serializer handle bidirectional conversion between markdown text and ProseMirror documents.

```typescript
import { MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown';
import markdownit from 'markdown-it';

// Parser configuration
const md = markdownit('default', { html: false, breaks: false })
  .enable(['table', 'strikethrough']);

// Custom token handlers for task lists
const taskListToken = {
  block: 'task_list',
  getAttrs: () => ({}),
};

const taskItemToken = {
  block: 'task_item',
  getAttrs: (tok: Token) => ({
    checked: tok.attrGet('checked') === 'true',
  }),
};
```

### Per-Tab State Cache

A single editor instance is shared across all tabs. To preserve undo/redo history and selection state, the full ProseMirror `EditorState` is cached per tab:

```typescript
const cachedStates = useRef(new Map<string, EditorState>());

function switchTab(fromTabId: string, toTabId: string) {
  // Save current state
  if (editor) {
    cachedStates.current.set(fromTabId, editor.state);
  }

  // Restore or create fresh state
  const cached = cachedStates.current.get(toTabId);
  if (cached) {
    editor.view.updateState(cached);
    cachedStates.current.delete(toTabId);
  } else {
    loadRawMarkdownIntoEditor(toTabContent);
  }
}
```

Tagged as #editor #extensions #prosemirror for the technical documentation.

---

## 4. State Management Patterns

The application uses **Zustand** for all client-side state management, with the persist middleware for localStorage-backed persistence.

### Store Design Principles

- **Single responsibility**: Each store manages one domain
- **No redundant state**: Derived values computed on read, not stored
- **Selective persistence**: Only persist what survives a restart
- **Action coalescing**: Multiple state changes in a single `set()` call

### Editor Store

```typescript
interface Tab {
  path: string;
  dirty: boolean;
  copilotDisabled: boolean;
  externalChange?: { content: string; timestamp: number };
}

interface EditorStore {
  tabs: Tab[];
  activeTabIndex: number;
  openTab: (path: string) => void;
  closeTab: (index: number) => void;
  setDirty: (index: number, dirty: boolean) => void;
  setExternalChange: (index: number, change: ExternalChange | null) => void;
}
```

### Workspace Store

```typescript
interface WorkspaceStore {
  explorerFolders: string[];
  projects: Project[];
  addExplorerFolder: (path: string) => void;
  removeExplorerFolder: (path: string) => void;
  addProject: (project: Project) => void;
  removeProject: (path: string) => void;
}
```

### Connections Store

The connections store manages multi-provider AI connections with credential security:

```typescript
interface Connection {
  id: string;
  provider: 'anthropic' | 'openai' | 'ollama' | 'local_bundled';
  label: string;
  capabilities: ('interactive' | 'agent_tasks' | 'inline_completion')[];
  sandboxEnabled: boolean;
  networkRestricted: boolean;
  kernelNetworkDeny: boolean;
  customWritablePaths: string[];
  allowedDomains: string[];
}

interface ConnectionsStore {
  connections: Connection[];
  addConnection: (connection: Connection, apiKey?: string) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  updateConnection: (id: string, updates: Partial<Connection>) => void;
}
```

Maintained by @david with #state-management #zustand tags.

---

## 5. AI Provider Integration

The application supports four distinct AI communication paths, unified behind a common abstraction.

### Path 1: Direct API

For providers that accept API keys (Anthropic, OpenAI) or run locally (Ollama):

```typescript
async function streamChat(
  messages: ChatMessage[],
  provider: string,
  connectionId: string,
  onChunk: (text: string) => void,
  onThinking: (text: string) => void,
  onDone: () => void
): Promise<void> {
  const unlisten = await listen<string>('ai-stream-chunk', (event) => {
    onChunk(event.payload);
  });

  const unlistenThinking = await listen<string>('ai-stream-thinking-chunk', (event) => {
    onThinking(event.payload);
  });

  const unlistenDone = await listen('ai-stream-done', () => {
    onDone();
    unlisten();
    unlistenThinking();
    unlistenDone();
  });

  await invoke('ai_chat_stream', {
    messages,
    provider,
    connectionId,
    webSearchEnabled: false,
  });
}
```

### Path 2: Agent Client Protocol (ACP)

For agent-managed connections (Claude Code, Codex, Copilot CLI, Gemini CLI):

```typescript
async function promptAgent(
  sessionId: string,
  message: string,
  context: AgentContext
): Promise<void> {
  await invoke('acp_session_prompt', {
    instanceId: context.instanceId,
    sessionId,
    prompt: message,
    projectPaths: context.projectPaths,
  });
}
```

### Path 3: Copilot LSP

For inline code completions via the Language Server Protocol:

```typescript
async function requestCompletion(
  uri: string,
  position: { line: number; character: number }
): Promise<InlineCompletion | null> {
  const result = await invoke<InlineCompletion | null>('copilot_lsp_inline_completion', {
    uri,
    line: position.line,
    character: position.character,
  });
  return result;
}
```

### Path 4: Local Bundled Inference

For fully offline AI using the bundled llama-server:

```python
# Model catalog structure (conceptual)
models = [
    {
        "id": "qwen2.5-coder-1.5b",
        "name": "Qwen 2.5 Coder 1.5B",
        "category": "code",
        "size_bytes": 1_700_000_000,
        "supports_fim": True,
        "supports_thinking": False,
        "recommended_ram_gb": 8,
    },
    {
        "id": "deepseek-r1-7b",
        "name": "DeepSeek R1 7B",
        "category": "reasoning",
        "size_bytes": 5_200_000_000,
        "supports_fim": False,
        "supports_thinking": True,
        "thinking_tags": ["<think>", "</think>"],
        "recommended_ram_gb": 16,
    },
]
```

### Routing System

The routing store maps use cases to connections:

| Use Case | Description | Compatible Paths |
| --- | --- | --- |
| interactive | Chat and inline actions | API, ACP, Local |
| agent_tasks | Background delegation | API, ACP, Local |
| inline_completion | Ghost text completions | LSP, Local, API |

Tagged as #ai #providers #routing for the integration docs. Reviewed by @marcus.

---

## 6. Security Model

Security is a core design principle, not an afterthought. The application implements defense-in-depth across multiple layers.

### API Key Storage

API keys are stored in the **OS credential manager** (macOS Keychain via the `keyring` Rust crate):

```rust
use keyring::Entry;

pub fn store_api_key(connection_id: &str, key: &str) -> Result<(), String> {
    let service = format!("notesage:{}", connection_id);
    let entry = Entry::new(&service, "api_key")
        .map_err(|e| format!("Keychain error: {}", e))?;
    entry.set_password(key)
        .map_err(|e| format!("Failed to store key: {}", e))?;
    Ok(())
}

pub fn get_api_key(connection_id: &str) -> Result<Option<String>, String> {
    let service = format!("notesage:{}", connection_id);
    let entry = Entry::new(&service, "api_key")
        .map_err(|e| format!("Keychain error: {}", e))?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to retrieve key: {}", e)),
    }
}
```

### Network Sandboxing

Agent subprocesses are sandboxed with two enforcement layers:

1. **Kernel level (Seatbelt)**: `(deny default)` blocks all network except the proxy port
2. **Proxy level**: HTTP proxy filters requests by domain allowlist

```
;; Seatbelt profile (generated per agent)
(version 1)
(deny default)
(allow process-exec)
(allow file-read*)
(allow file-write* (subpath "/tmp"))
(allow network-outbound (remote ip "localhost:54321"))
(allow network-bind (local ip "*:*"))
```

### Domain Approval Flow

When an agent tries to reach an unknown domain:

- [x] Proxy intercepts the request
- [x] Frontend shows domain approval card
- [x] User chooses: allow once, allow session, allow always, deny
- [x] 30-second auto-deny timeout
- [ ] Batch approval for common domain groups

### Filesystem Permissions

| Operation | Allowed | Boundary |
| --- | --- | --- |
| Read project files | Yes | Project directory |
| Write project files | Yes | Project directory |
| Read system files | No | Blocked by Tauri |
| Write outside project | No | Blocked by Seatbelt |
| Execute binaries | Limited | Allowlisted paths only |
| Access keychain | Yes | App-scoped entries only |

> Security is like insurance — you hope you never need it, but when you do, you're grateful it's there. We chose the strictest defaults and relax only when the user explicitly opts in.

Reviewed by @security-team during the #security #sandboxing audit.

---

## 7. Performance Engineering

Performance is measured, tracked, and optimized systematically. Every release must meet the performance budgets defined in the quality gates.

### Performance Budgets

| Metric | Budget | Current | Status |
| --- | --- | --- | --- |
| App startup | < 1s | 0.7s | Pass |
| File open (1KB) | < 50ms | 32ms | Pass |
| File open (10KB) | < 100ms | 78ms | Pass |
| File open (50KB) | < 150ms | 125ms | Pass |
| File open (100KB) | < 200ms | 178ms | Pass |
| Keystroke latency | < 16ms | 8ms | Pass |
| Save to disk | < 100ms | 67ms | Pass |
| Tab switch | < 50ms | 28ms | Pass |
| Theme toggle | < 100ms | 45ms | Pass |
| AI stream start | < 500ms | 320ms | Pass |
| Search (10K files) | < 200ms | 145ms | Pass |

### Optimization Strategies

#### Debounced Operations

Auto-save and search are debounced to prevent excessive computation:

```typescript
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

// Auto-save with 1 second debounce
const debouncedContent = useDebounce(editorContent, 1000);

useEffect(() => {
  if (debouncedContent && activeTab?.dirty) {
    saveDocument(activeTab.path, debouncedContent);
  }
}, [debouncedContent]);
```

#### Virtualized Rendering

Large file trees use virtualized rendering to maintain smooth scrolling:

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

function FileTree({ items }: { items: FileEntry[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
  });

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <FileTreeItem
            key={virtualRow.key}
            item={items[virtualRow.index]}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

#### SQLite Index Performance

The document index uses SQLite with FTS5 for instant search:

```sql
-- Schema for the document index
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    hash TEXT NOT NULL,
    title TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id),
    tag TEXT NOT NULL,
    line INTEGER NOT NULL,
    UNIQUE(document_id, tag, line)
);

CREATE TABLE IF NOT EXISTS mentions (
    id INTEGER PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id),
    mention TEXT NOT NULL,
    line INTEGER NOT NULL,
    UNIQUE(document_id, mention, line)
);

CREATE VIRTUAL TABLE IF NOT EXISTS fts_content USING fts5(
    path,
    title,
    content,
    tokenize='porter unicode61'
);

-- Efficient tag search
SELECT DISTINCT t.tag, COUNT(*) as count
FROM tags t
JOIN documents d ON t.document_id = d.id
WHERE t.tag LIKE ? || '%'
GROUP BY t.tag
ORDER BY count DESC
LIMIT 20;
```

Tagged as #performance #benchmarks #sqlite. Maintained by @peter.

---

## 8. Testing and Quality

### Test Pyramid

The project follows a test pyramid with unit tests as the foundation:

```
        ╱╲
       ╱  ╲     E2E (Playwright/WebDriverIO)
      ╱────╲    Integration (Tauri commands)
     ╱──────╲   Unit (Vitest + cargo test)
    ╱────────╲
```

### Unit Test Examples

```typescript
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

describe('useEditorStore', () => {
  it('should open a new tab', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab('/path/to/file.md');
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].path).toBe('/path/to/file.md');
    expect(result.current.activeTabIndex).toBe(0);
  });

  it('should not duplicate tabs for the same file', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab('/path/to/file.md');
      result.current.openTab('/path/to/file.md');
    });

    expect(result.current.tabs).toHaveLength(1);
  });

  it('should mark tab as dirty on content change', () => {
    const { result } = renderHook(() => useEditorStore());

    act(() => {
      result.current.openTab('/path/to/file.md');
      result.current.setDirty(0, true);
    });

    expect(result.current.tabs[0].dirty).toBe(true);
  });
});
```

### Rust Backend Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_markdown_to_typst_heading() {
        let input = "# Hello World\n\nSome text.";
        let result = markdown_to_typst(input);
        assert!(result.contains("= Hello World"));
        assert!(result.contains("Some text."));
    }

    #[test]
    fn test_markdown_to_typst_code_block() {
        let input = "```rust\nfn main() {}\n```";
        let result = markdown_to_typst(input);
        assert!(result.contains("```rust"));
        assert!(result.contains("fn main() {}"));
    }

    #[test]
    fn test_tag_parsing() {
        let input = "Hello #world and #rust-lang tags.";
        let tags = parse_tags(input);
        assert_eq!(tags, vec!["world", "rust-lang"]);
    }

    #[test]
    fn test_tag_parsing_ignores_code() {
        let input = "Normal #tag but `#not-a-tag` and\n```\n#also-not-a-tag\n```";
        let tags = parse_tags(input);
        assert_eq!(tags, vec!["tag"]);
    }
}
```

### Coverage Tracking

Coverage is tracked per module with regression detection:

| Module | Lines | Branches | Target |
| --- | --- | --- | --- |
| Stores | 84.09% | 78.2% | 80% |
| Hooks | 86.95% | 81.4% | 80% |
| Markdown | 89.91% | 85.7% | 85% |
| Components | 55.3% | 48.1% | 60% |
| Lib utilities | 72.8% | 66.3% | 70% |
| **Overall** | **70.25%** | **64.8%** | **65%** |

### E2E Test Suite

```typescript
import { test, expect } from '@playwright/test';

test.describe('Editor', () => {
  test('should open and edit a markdown file', async ({ page }) => {
    await page.goto('/');

    // Open a file from the sidebar
    await page.click('[data-testid="file-tree-item-readme"]');

    // Verify content loaded
    await expect(page.locator('.ProseMirror')).toContainText('README');

    // Type some text
    await page.click('.ProseMirror');
    await page.keyboard.type('Hello, World!');

    // Verify dirty indicator
    await expect(page.locator('[data-testid="dirty-indicator"]')).toBeVisible();

    // Save with Cmd+S
    await page.keyboard.press('Meta+s');

    // Verify saved
    await expect(page.locator('[data-testid="dirty-indicator"]')).not.toBeVisible();
  });
});
```

Tagged as #testing #coverage #quality. Reviewed by @testing-team.

---

## 9. Deployment and Distribution

### Build Pipeline

The application is built and distributed as a native macOS application:

```bash
# Development
pnpm tauri dev

# Production build
pnpm tauri build

# The build produces:
# - .app bundle in src-tauri/target/release/bundle/macos/
# - .dmg installer in src-tauri/target/release/bundle/dmg/
```

### Release Checklist

- [x] All tests passing (`pnpm test:all`)
- [x] Coverage regression check passes
- [x] TypeScript type check passes (`pnpm typecheck`)
- [x] Rust tests passing (`cargo test`)
- [x] App builds without errors
- [x] Manual QA on light and dark mode
- [ ] Code signing with Apple Developer certificate
- [ ] Notarization with Apple
- [ ] DMG uploaded to distribution server

### Version Management

```json
{
  "name": "notesage",
  "version": "0.23.2",
  "description": "A rich text markdown editor with AI collaboration"
}
```

The version in `package.json` is the single source of truth. The Tauri config references it via `"version": "../package.json"`.

### Binary Size Budget

| Component | Size | Budget |
| --- | --- | --- |
| Tauri runtime | 3.2MB | 5MB |
| Frontend bundle | 1.8MB | 3MB |
| Rust backend | 4.1MB | 5MB |
| Bundled fonts | 2.7MB | 3MB |
| llama-server | 8.5MB | 10MB |
| **Total** | **20.3MB** | **26MB** |

Maintained by @peter with #deployment #release #ci tags.

---

## Appendix A: Keyboard Shortcuts Reference

| Category | Shortcut | Action |
| --- | --- | --- |
| File | Cmd+S | Save current file |
| File | Cmd+O | Open file picker |
| File | Cmd+W | Close active tab |
| File | Cmd+N | New note dialog |
| Edit | Cmd+Z | Undo |
| Edit | Cmd+Shift+Z | Redo |
| Edit | Cmd+B | Toggle bold |
| Edit | Cmd+I | Toggle italic |
| Edit | Cmd+U | Toggle underline |
| Edit | Cmd+E | Toggle inline code |
| Edit | Cmd+K | Insert/edit link |
| Search | Cmd+F | Find in document |
| Search | Cmd+Shift+H | Find and replace |
| Search | Cmd+Shift+F | Search files |
| Navigation | Cmd+K | Command palette |
| Navigation | Cmd+1 | Actions dashboard |
| Navigation | Cmd+2 | Mention search |
| Navigation | Cmd+3 | Tag search |
| Navigation | Cmd+4 | Research search |
| AI | Cmd+Shift+C | Toggle chat panel |
| AI | Cmd+Shift+A | Toggle agent panel |
| AI | Cmd+Shift+M | Add comment |
| AI | Cmd+Enter | Accept suggestion |
| AI | Cmd+Backspace | Reject suggestion |
| View | Cmd+T | Toggle theme |
| View | Cmd+, | Open settings |
| View | Cmd+Shift+L | Toggle sidebar |
| View | Cmd+. | Focus mode |

## Appendix B: File Extension Support

| Extension | Viewer | Editable | Search |
| --- | --- | --- | --- |
| .md | Tiptap WYSIWYG | Yes | Cmd+F (ProseMirror) |
| .txt | PlainTextViewer | No | Cmd+F (DOM search) |
| .epub | EpubViewer | No | Cmd+F (foliate-js) |
| .pdf | PdfViewer | No | Cmd+F (pdfjs) |
| .docx | DocxViewer | No | Cmd+F (DOM search) |
| .json | PlainTextViewer | No | Cmd+F (DOM search) |
| .yaml | PlainTextViewer | No | Cmd+F (DOM search) |

## Appendix C: Environment Variables

```bash
# AI Provider Keys (stored in OS keychain, NOT env vars)
# ANTHROPIC_API_KEY — migrated to keychain
# OPENAI_API_KEY — migrated to keychain

# Development
RUST_LOG=info              # Rust logging level
TAURI_DEV_HOST=localhost    # Dev server host
VITE_DEV_SERVER_URL=http://localhost:1420

# Build
TAURI_SIGNING_PRIVATE_KEY  # For update signing
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

## Appendix D: Glossary

| Term | Definition |
| --- | --- |
| ACP | Agent Client Protocol — stdio-based communication with AI agents |
| CFI | Canonical Fragment Identifier — EPUB location reference |
| CRDT | Conflict-free Replicated Data Type — for collaborative editing |
| FIM | Fill-in-the-Middle — code completion technique |
| FTS5 | Full-Text Search 5 — SQLite extension for text search |
| GGUF | GPT-Generated Unified Format — LLM model file format |
| IPC | Inter-Process Communication — Tauri command bridge |
| LSP | Language Server Protocol — for code intelligence |
| MCP | Model Context Protocol — for AI tool integration |
| PM | ProseMirror — the underlying editor framework |

---

*This document is maintained as a living reference. Last updated by @peter on 2026-03-28. Tagged with #documentation #architecture #reference.*

---

## Appendix E: Migration Guides

### Migrating from Electron to Tauri

The migration from Electron to Tauri v2 required significant changes to the application architecture. This appendix documents the key differences and migration strategies.

#### Process Model

Electron uses a multi-process architecture with a **main process** and **renderer processes**. Tauri uses a single Rust process with a webview for the frontend. This has several implications:

- **No Node.js in the backend**: All backend code must be written in Rust
- **No `require()` or `import` for native modules**: Use Tauri plugins or Rust crates
- **IPC is the only communication channel**: No shared memory between frontend and backend
- **Webview limitations**: Some browser APIs may not be available in WKWebView

```typescript
// Electron approach (main process)
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');

ipcMain.handle('read-file', async (event, path) => {
  return fs.promises.readFile(path, 'utf-8');
});

// Tauri approach (Rust backend)
// src-tauri/src/commands/file.rs
#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| format!("Failed to read {}: {}", path, e))
}
```

#### Bundle Size Comparison

| Component | Electron | Tauri | Savings |
| --- | --- | --- | --- |
| Runtime | 85MB | 3.2MB | 96% |
| Framework | 12MB | 0.8MB | 93% |
| Frontend | 2.5MB | 1.8MB | 28% |
| Total app | 120MB | 20.3MB | 83% |

The dramatic size reduction comes primarily from not bundling Chromium. Tauri uses the system webview (WKWebView on macOS), which is already installed on every Mac.

> Switching to Tauri cut our app size by 83%. Users on slow connections can now download the app in seconds instead of minutes. The tradeoff is platform-specific webview quirks, which we address in the Appendix F troubleshooting section.

Tagged as #migration #electron #tauri by @peter.

#### Frontend Changes

Most React code works unchanged in Tauri. The main differences are:

1. Replace `electron` IPC with `@tauri-apps/api/core` invoke
2. Replace `electron-store` with Zustand persist middleware
3. Replace `node:fs` calls with Tauri file commands
4. Replace `electron-updater` with Tauri's update plugin

- [x] IPC layer migrated
- [x] File operations migrated
- [x] Settings storage migrated
- [x] Auto-updater migrated
- [x] Native dialogs migrated
- [ ] Deep linking (deferred)
- [ ] Protocol handlers (deferred)

### Migrating from localStorage to OS Keychain

API keys were previously stored in localStorage as part of the connections store. This migration moved them to the OS keychain for better security.

```typescript
// Before: keys stored in plain text in localStorage
interface OldConnection {
  id: string;
  provider: string;
  apiKey: string; // Plaintext in localStorage!
}

// After: keys stored in OS keychain
interface NewConnection {
  id: string;
  provider: string;
  // apiKey removed — stored in keychain as "notesage:<id>"
}

// Migration runs automatically on first launch
async function migrateCredentials(): Promise<number> {
  const raw = localStorage.getItem('notesage-connections');
  if (!raw) return 0;

  const migrated = await invoke<number>('migrate_credentials', {
    connectionsJson: raw,
  });

  return migrated;
}
```

Reviewed by @security-team. Tagged with #security #migration #keychain.

---

## Appendix F: Troubleshooting

### Common Issues

#### WKWebView Rendering Differences

macOS WKWebView may render certain CSS properties differently from Chromium:

| Property | Chrome | WKWebView | Workaround |
| --- | --- | --- | --- |
| `backdrop-filter` | Full support | Partial | Add `-webkit-backdrop-filter` |
| `scrollbar-width` | Supported | Not supported | Use `::-webkit-scrollbar` |
| `overflow-anchor` | Supported | Not supported | Manual scroll restoration |
| `color-scheme` | Full | Partial | Explicit dark mode CSS |
| `font-variation-settings` | Full | Partial | Use specific font weights |

#### Filesystem Watcher Issues

The filesystem watcher can sometimes produce unexpected events, especially on macOS:

```rust
// Problem: FSEvents reports phantom modify events after delete
// Solution: Check if file exists before emitting modify events
fn handle_event(event: &DebouncedEvent) -> Option<FileChangeEvent> {
    match event.kind {
        EventKind::Modify(_) => {
            if !Path::new(&event.paths[0]).exists() {
                // Reclassify as delete
                Some(FileChangeEvent {
                    path: event.paths[0].clone(),
                    kind: "delete".to_string(),
                })
            } else {
                Some(FileChangeEvent {
                    path: event.paths[0].clone(),
                    kind: "modify".to_string(),
                })
            }
        }
        _ => None,
    }
}
```

- [x] FSEvents phantom modify events handled
- [x] Self-write suppression working with 5s TTL
- [x] iCloud sync events properly filtered
- [ ] Windows ReadDirectoryChangesW edge cases

#### Agent Authentication Failures

When agent authentication fails, check these common causes:

1. **Network issues**: Verify internet connectivity and proxy settings
2. **Expired tokens**: Remove and re-authenticate the connection
3. **Rate limiting**: Wait a few minutes before retrying
4. **Binary not found**: Check `~/.notesage/bin/` for the agent binary

```bash
# Check agent binary status
ls -la ~/.notesage/bin/

# Verify agent can start
~/.notesage/bin/claude-agent-acp --version

# Check for permission issues
codesign -dv ~/.notesage/bin/claude-agent-acp 2>&1
```

> When all else fails, remove the connection from Settings and re-add it. This forces a clean authentication flow without leftover state.

#### Memory Usage Patterns

Monitor memory usage during extended editing sessions:

| Scenario | Expected | Warning | Critical |
| --- | --- | --- | --- |
| Idle (no files open) | 80MB | 150MB | 250MB |
| Single small file | 100MB | 200MB | 350MB |
| 10 open tabs | 150MB | 300MB | 500MB |
| Large file (100KB) | 120MB | 250MB | 400MB |
| AI chat active | 130MB | 280MB | 450MB |
| Local AI running | 2GB+ | 4GB+ | 8GB+ |

Local AI memory usage depends entirely on the loaded model size. A 7B parameter model typically requires 4-6GB of RAM, while a 1.5B model needs about 1.5GB.

Tagged as #troubleshooting #debugging #support. Maintained by @support-team.

---

## Appendix G: Plugin Development Guide

While the plugin system is not yet public, internal extensions follow a consistent pattern. This guide documents the conventions used for building Tiptap extensions.

### Extension Template

Every custom extension follows this structure:

```typescript
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DecorationSet, Decoration } from '@tiptap/pm/view';

// 1. Define a unique plugin key
const myExtensionKey = new PluginKey('myExtension');

// 2. Define the plugin state interface
interface MyExtensionState {
  decorations: DecorationSet;
  active: boolean;
}

// 3. Create the extension
export const MyExtension = Extension.create({
  name: 'myExtension',

  // 4. Define commands
  addCommands() {
    return {
      activateMyExtension: () => ({ tr, dispatch }) => {
        if (dispatch) {
          tr.setMeta(myExtensionKey, { active: true });
        }
        return true;
      },
      deactivateMyExtension: () => ({ tr, dispatch }) => {
        if (dispatch) {
          tr.setMeta(myExtensionKey, { active: false });
        }
        return true;
      },
    };
  },

  // 5. Add ProseMirror plugins
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: myExtensionKey,
        state: {
          init(): MyExtensionState {
            return {
              decorations: DecorationSet.empty,
              active: false,
            };
          },
          apply(tr, value): MyExtensionState {
            const meta = tr.getMeta(myExtensionKey);
            if (meta !== undefined) {
              return {
                ...value,
                active: meta.active,
                decorations: meta.active
                  ? buildDecorations(tr.doc)
                  : DecorationSet.empty,
              };
            }

            if (tr.docChanged && value.active) {
              return {
                ...value,
                decorations: buildDecorations(tr.doc),
              };
            }

            return value;
          },
        },
        props: {
          decorations(state) {
            return myExtensionKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

// 6. Decoration builder
function buildDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText) return;
    // Build decorations based on text content
    const text = node.text ?? '';
    // ... pattern matching logic ...
  });

  return DecorationSet.create(doc, decorations);
}
```

### Testing Extensions

Extensions should be tested at three levels:

1. **Unit tests**: Test the decoration builder in isolation
2. **Integration tests**: Test the plugin state transitions
3. **Visual tests**: Verify rendering in the editor

```typescript
describe('MyExtension', () => {
  it('should create decorations for matching patterns', () => {
    const doc = createTestDoc('Hello #world');
    const decorations = buildDecorations(doc);
    expect(decorations.find().length).toBe(1);
  });

  it('should clear decorations when deactivated', () => {
    const editor = createTestEditor([MyExtension]);
    editor.commands.activateMyExtension();
    expect(getDecorations(editor)).not.toEqual(DecorationSet.empty);

    editor.commands.deactivateMyExtension();
    expect(getDecorations(editor)).toEqual(DecorationSet.empty);
  });

  it('should update decorations on document change', () => {
    const editor = createTestEditor([MyExtension]);
    editor.commands.activateMyExtension();

    const before = getDecorations(editor).find().length;
    editor.commands.insertContent('#new-tag');
    const after = getDecorations(editor).find().length;

    expect(after).toBe(before + 1);
  });
});
```

### Performance Guidelines for Extensions

Extensions that run on every transaction must be efficient:

- **Avoid full document traversal** when only local changes occurred
- **Use `DecorationSet.map()`** to efficiently update decoration positions
- **Debounce expensive operations** (e.g., external API calls)
- **Cache computed results** when the document hasn't changed

```typescript
// Efficient: map existing decorations through the transaction mapping
apply(tr, value) {
  if (!tr.docChanged) return value;

  // Remap existing decorations
  let decorations = value.decorations.map(tr.mapping, tr.doc);

  // Only rebuild decorations near the change
  tr.steps.forEach((step, index) => {
    const map = tr.mapping.maps[index];
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      // Rebuild decorations only in the changed range
      const localDecos = buildDecorationsInRange(tr.doc, newStart, newEnd);
      decorations = decorations.add(tr.doc, localDecos);
    });
  });

  return { ...value, decorations };
}
```

Tagged as #plugins #extensions #development. Reviewed by @marcus and @elena.

---

## Appendix H: Accessibility Compliance

The application aims for WCAG 2.1 AA compliance across all interactive elements.

### Focus Management

All interactive components implement proper focus management:

```typescript
// Focus trap for modal dialogs
function useFocusTrap(ref: RefObject<HTMLElement>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const focusableElements = element.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab') return;

      if (event.shiftKey) {
        if (document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    }

    element.addEventListener('keydown', handleKeyDown);
    firstElement?.focus();

    return () => element.removeEventListener('keydown', handleKeyDown);
  }, [ref]);
}
```

### Color Contrast Requirements

All text must meet minimum contrast ratios:

| Element | Contrast Ratio | WCAG Level |
| --- | --- | --- |
| Body text | 7.2:1 | AAA |
| Headings | 6.8:1 | AAA |
| Muted text | 4.6:1 | AA |
| Placeholder text | 4.5:1 | AA |
| UI labels | 5.1:1 | AA |
| Active states | 4.8:1 | AA |

### Screen Reader Support

- [x] All images have `alt` attributes
- [x] Form inputs have associated labels
- [x] Buttons have descriptive text or `aria-label`
- [x] Live regions announce AI responses
- [x] Document structure uses semantic HTML
- [ ] Custom components expose ARIA roles
- [ ] Keyboard navigation fully documented

```typescript
// Live region for AI streaming responses
<div
  role="log"
  aria-live="polite"
  aria-label="AI assistant response"
  className="chat-messages"
>
  {messages.map((msg) => (
    <ChatMessage key={msg.id} message={msg} />
  ))}
</div>
```

Tagged as #accessibility #wcag #a11y. Maintained by @accessibility-team.

---

## Appendix I: Internationalization Roadmap

While the application currently supports English only, the architecture is designed to accommodate future internationalization.

### Translation Strategy

The proposed approach uses a JSON-based translation system:

```typescript
// Translation files in src/i18n/
// en.json
{
  "editor.save": "Save",
  "editor.open": "Open File",
  "editor.newNote": "New Note",
  "sidebar.explorer": "Explorer",
  "sidebar.search": "Search",
  "chat.placeholder": "Ask AI anything...",
  "chat.send": "Send",
  "settings.title": "Settings",
  "settings.appearance": "Appearance",
  "settings.connections": "Connections"
}

// sv.json (Swedish)
{
  "editor.save": "Spara",
  "editor.open": "Oppna fil",
  "editor.newNote": "Ny anteckning",
  "sidebar.explorer": "Utforskaren",
  "sidebar.search": "Sok",
  "chat.placeholder": "Fraga AI vad som helst...",
  "chat.send": "Skicka",
  "settings.title": "Installningar",
  "settings.appearance": "Utseende",
  "settings.connections": "Anslutningar"
}
```

### Supported Locales (Planned)

| Locale | Language | Status |
| --- | --- | --- |
| en | English | Current |
| sv | Swedish | Planned |
| de | German | Planned |
| fr | French | Planned |
| ja | Japanese | Planned |
| zh | Chinese | Planned |
| ko | Korean | Planned |
| es | Spanish | Planned |

### RTL Support

Right-to-left language support requires additional CSS considerations:

```css
/* RTL layout adjustments */
[dir="rtl"] .sidebar {
  border-left: 1px solid var(--border);
  border-right: none;
}

[dir="rtl"] .editor-content {
  text-align: right;
}

[dir="rtl"] .toolbar {
  flex-direction: row-reverse;
}
```

Tagged as #i18n #localization #roadmap by @peter.

---

## Appendix J: Data Flow Diagrams

### File Open Flow

When a user opens a markdown file, the following sequence occurs:

1. User clicks file in sidebar or uses `Cmd+O` dialog
2. Frontend checks if file is already open in a tab
3. If not open, calls `invoke('read_file', { path })` to read content
4. Markdown content parsed via `prosemirror-markdown` into ProseMirror document
5. Editor state created with fresh history (no stale undo entries)
6. Tab added to `editor-store` with clean dirty state
7. Filesystem watcher confirms the file is being monitored
8. Document indexed in SQLite for search (tags, mentions, headings)

```typescript
async function openFile(path: string): Promise<void> {
  const { tabs, activeTabIndex, openTab } = useEditorStore.getState();

  // Check for existing tab
  const existingIndex = tabs.findIndex(t => t.path === path);
  if (existingIndex >= 0) {
    useEditorStore.setState({ activeTabIndex: existingIndex });
    return;
  }

  // Read file content through IPC
  const content = await invoke<string>('read_file', { path });

  // Parse markdown to ProseMirror
  const doc = markdownParser.parse(content);

  // Open new tab
  openTab(path);

  // Editor will pick up the new tab and load content
  // via the activeTab effect in Editor.tsx
}
```

### Save Flow

Saving follows a careful sequence to prevent data loss and false change detection:

```typescript
async function saveFile(path: string, content: string): Promise<void> {
  // 1. Mark as self-write to suppress watcher events
  await invoke('mark_self_write', { path });

  // 2. Serialize ProseMirror document to markdown
  const markdown = markdownSerializer.serialize(editor.state.doc);

  // 3. Write to disk through IPC
  await invoke('write_file', { path, content: markdown });

  // 4. Clear dirty state
  useEditorStore.getState().setDirty(activeTabIndex, false);

  // 5. Trigger document reindex for updated tags/mentions
  await invoke('index_file', { path, content: markdown });
}
```

### AI Chat Flow

The AI chat flow differs based on the active provider path:

| Step | Direct API | ACP Agent | Local Bundled |
| --- | --- | --- | --- |
| 1. User sends message | `addMessage()` | `addMessage()` | `addMessage()` |
| 2. Build context | System prompt + history | Session context | System prompt + history |
| 3. Send request | `ai_chat_stream` | `acp_session_prompt` | `ai_chat_stream` |
| 4. Transport | HTTPS to API | stdio to subprocess | HTTP to localhost |
| 5. Stream chunks | SSE events | ACP events | SSE events |
| 6. Update UI | Throttled flush (50ms) | Throttled flush (50ms) | Throttled flush (50ms) |
| 7. Handle tools | Web search only | Full tool calling | None |
| 8. Complete | Store in chat-store | Store in chat-store | Store in chat-store |

> The beauty of the provider abstraction is that the chat panel has no idea which path is being used. It just sends messages and receives responses. The routing logic is entirely contained in `useAIOperations`.

Tagged as #dataflow #architecture #diagrams. Reviewed by @marcus.

---

## Appendix K: Configuration Reference

### Tauri Configuration

The main Tauri configuration lives in `src-tauri/tauri.conf.json`:

```json
{
  "productName": "Notesage",
  "version": "../package.json",
  "identifier": "com.notesage.app",
  "build": {
    "frontendDist": "../dist",
    "devUrl": "http://localhost:1420"
  },
  "app": {
    "windows": [
      {
        "title": "Notesage",
        "width": 1200,
        "height": 800,
        "minWidth": 800,
        "minHeight": 600
      }
    ],
    "security": {
      "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'"
    }
  }
}
```

### Vite Configuration

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          editor: ['@tiptap/core', '@tiptap/react', '@tiptap/pm'],
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
        },
      },
    },
  },
});
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

Maintained by @peter with #config #build #tooling tags.
