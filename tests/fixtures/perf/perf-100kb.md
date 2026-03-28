# The Complete Guide to Building Desktop Applications with Web Technologies

This comprehensive document covers every aspect of building **modern desktop applications** using web technologies, from *architecture decisions* to deployment, testing, security, and performance optimization. It serves as both a reference manual and a practical guide for engineering teams.

## Table of Contents

1. Introduction and Motivation
2. Technology Selection
3. Architecture Design
4. Editor Engine
5. State Management
6. AI Provider Integration
7. Security Architecture
8. Performance Engineering
9. Testing Strategy
10. Deployment Pipeline
11. Workspace and File Management
12. Plugin and Extension System
13. Accessibility
14. Internationalization
15. Troubleshooting Guide
16. API Reference
17. Glossary

---

## 1. Introduction and Motivation

The landscape of desktop application development has undergone a **fundamental transformation** over the past decade. Traditional native frameworks like Cocoa, Win32, and GTK have given way to web-based approaches that leverage the vast ecosystem of modern JavaScript and TypeScript tooling.

### Why Build a Desktop App?

Despite the dominance of web applications and SaaS products, desktop applications continue to offer compelling advantages for certain use cases:

- **Offline capability**: Full functionality without network connectivity is essential for writing tools
- **System integration**: Access to native APIs, filesystem, OS keychain, and hardware
- **Performance**: No browser overhead, direct GPU access via Metal or Vulkan
- **Privacy**: Data stays on the user's device by default, with cloud sync as an opt-in feature
- **Focus**: A dedicated window without browser tabs and distractions

> The best tools feel invisible. A desktop editor should respond to keystrokes instantly, save files reliably, and never lose the user's work. Everything else is secondary to this core promise.

### Project Vision

The goal is to build a rich text markdown editor that feels as polished as **Linear**, **Bear**, or **Craft**, while offering AI-powered writing assistance that respects user privacy. The application must:

- [x] Open and edit markdown files with lossless round-tripping
- [x] Provide a beautiful, distraction-free writing environment
- [x] Support multiple AI providers for writing assistance
- [x] Package as a lightweight native macOS application
- [x] Achieve sub-second startup time
- [x] Store sensitive data in the OS keychain
- [ ] Support collaborative editing via CRDTs
- [ ] Build iOS and Android companion apps
- [ ] Create a plugin marketplace

Tagged as #vision #introduction #goals by @peter.

---

## 2. Technology Selection

Every technology choice in the stack was made deliberately, with alternatives evaluated and documented.

### Desktop Shell: Tauri v2

Tauri was chosen over Electron for its dramatically smaller bundle size and better security model:

| Criterion | Electron | Tauri v2 | Winner |
| --- | --- | --- | --- |
| Bundle size | 85MB+ | 3MB | Tauri |
| Memory usage | 150MB+ | 50MB | Tauri |
| Startup time | 2-3s | 0.5-0.7s | Tauri |
| Security | Node.js access | Sandboxed IPC | Tauri |
| Backend language | JavaScript | Rust | Tauri |
| Ecosystem | Mature | Growing | Electron |
| Cross-platform | Excellent | Good | Electron |
| Webview | Chromium | System | Draw |

```rust
// Tauri application entry point
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::file::read_file,
            commands::file::write_file,
            commands::file::list_directory,
            commands::dialog::open_folder_dialog,
            commands::ai::ai_chat_stream,
            commands::export::export_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
```

### Frontend Framework: React 19

React was chosen for its ecosystem maturity, component model, and the availability of high-quality UI libraries like shadcn/ui:

```typescript
import React, { useState, useCallback } from 'react';
import { useEditorStore } from '@/stores/editor-store';
import { invoke } from '@tauri-apps/api/core';

function App() {
  const { tabs, activeTabIndex } = useEditorStore();
  const activeTab = tabs[activeTabIndex];

  const handleSave = useCallback(async () => {
    if (!activeTab) return;
    await invoke('mark_self_write', { path: activeTab.path });
    const content = serializeEditor();
    await invoke('write_file', { path: activeTab.path, content });
  }, [activeTab]);

  return (
    <Layout>
      <Sidebar />
      <Editor onSave={handleSave} />
      <ChatPanel />
    </Layout>
  );
}
```

### Editor Engine: Tiptap v2 (ProseMirror)

ProseMirror was chosen for its decoration system, which enables inline AI suggestions without modifying the document model. Tiptap provides a React-friendly wrapper:

- **Decoration system**: Widget, inline, and node decorations for visual overlays
- **Plugin architecture**: State management, key bindings, and input rules
- **Transaction model**: Reliable undo/redo across complex operations
- **CRDT compatibility**: Prepared for future collaborative editing

### UI Components: shadcn/ui

shadcn/ui provides pre-built, accessible components that integrate perfectly with Tailwind CSS:

1. **Buttons, inputs, selects**: Standard form elements with consistent styling
2. **Dialogs and popovers**: Accessible modals with focus trapping
3. **Context menus**: Native-feeling right-click menus
4. **Command palette**: Fuzzy search with keyboard navigation
5. **Resizable panels**: Smooth drag-to-resize layout sections

### State Management: Zustand

Zustand was chosen over Redux, Jotai, and Recoil for its simplicity and built-in persist middleware:

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsStore {
  theme: 'light' | 'dark' | 'system';
  softContrast: boolean;
  editorFontSize: number;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  toggleSoftContrast: () => void;
}

const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: 'system',
      softContrast: false,
      editorFontSize: 16,
      setTheme: (theme) => set({ theme }),
      toggleSoftContrast: () => set((s) => ({ softContrast: !s.softContrast })),
    }),
    { name: 'settings-store' }
  )
);
```

Reviewed by @marcus and @elena during the #technology #evaluation phase.

---

## 3. Architecture Design

The application follows a strict layered architecture with clear boundaries between concerns.

### Core Principles

1. **ProseMirror is the single source of truth** for the currently open document
2. **All filesystem access goes through Tauri commands** — the frontend never touches the disk directly
3. **Zustand stores have clear boundaries** — each store manages exactly one domain
4. **Security by default** — API keys in OS keychain, sandboxed agents, permission-gated tool calls

### Component Architecture

```
App.tsx
├── Layout.tsx (ResizablePanelGroup)
│   ├── Sidebar.tsx
│   │   ├── FileTree.tsx
│   │   │   └── FileTreeItem.tsx (recursive)
│   │   └── ProjectSelector.tsx
│   ├── EditorArea
│   │   ├── TabBar.tsx
│   │   │   └── Tab.tsx
│   │   ├── Editor.tsx
│   │   │   ├── Toolbar.tsx
│   │   │   ├── EditorContent.tsx (Tiptap)
│   │   │   ├── BubbleMenu.tsx
│   │   │   ├── FindBar.tsx
│   │   │   └── StatusBar.tsx
│   │   └── Viewers/
│   │       ├── EpubViewer.tsx
│   │       ├── PdfViewer.tsx
│   │       ├── DocxViewer.tsx
│   │       └── PlainTextViewer.tsx
│   ├── ChatPanel.tsx
│   │   ├── ChatMessage.tsx
│   │   ├── ChatInput.tsx
│   │   ├── PermissionCard.tsx
│   │   └── DomainApprovalCard.tsx
│   └── ActivityStrip.tsx
├── SettingsDialog.tsx
├── NewNoteDialog.tsx
├── NewProjectDialog.tsx
├── ExportDialog.tsx
└── CommandPalette.tsx
```

### Data Flow

The unidirectional data flow ensures predictable state updates:

```
User Action → Zustand Store Update → React Re-render → ProseMirror Transaction
     ↑                                                           │
     └───────── Tauri IPC ← Rust Backend ← Filesystem ←─────────┘
```

> Every piece of data in the application has a clear owner and a defined path for updates. This makes debugging straightforward and prevents the tangled state issues common in complex editors.

### Store Dependencies

| Store | Depends On | Used By |
| --- | --- | --- |
| editor-store | — | Editor, TabBar, Sidebar |
| workspace-store | — | Sidebar, FileTree |
| settings-store | — | App, Layout, Editor |
| connections-store | — | Settings, AI hooks |
| routing-store | connections-store | useAIOperations |
| chat-store | — | ChatPanel |
| comment-store | editor-store | CommentPopover |
| permission-store | — | PermissionCard |
| skill-store | — | ChatInput, Settings |
| activity-store | — | ActivityStrip |
| external-change-store | editor-store | Editor, FileWatcher |
| local-ai-store | — | LocalAI settings |
| git-store | workspace-store | Sidebar, CommitDialog |

Tagged as #architecture #components #dataflow. Maintained by @peter.

---

## 4. Editor Engine

The editor is the heart of the application, built on Tiptap v2 which wraps ProseMirror.

### Extension System

Each Tiptap extension can define schema elements, plugins, commands, and input rules. The application uses both built-in Tiptap extensions and custom ones.

#### Built-in Extensions

| Extension | Purpose | Configuration |
| --- | --- | --- |
| StarterKit | Basic nodes and marks | Customized heading levels |
| Table | Table editing | With headers |
| TaskList | Checkbox lists | Default checked state |
| Link | Clickable links | Auto-link detection |
| Image | Inline images | Local file support |
| CodeBlockLowlight | Syntax highlighting | Multiple languages |
| Underline | Underline mark | Default config |
| Placeholder | Empty editor hint | Custom text |
| Typography | Smart quotes | Enabled |
| TextAlign | Paragraph alignment | Left, center, right |

#### Custom Extensions

The application includes 16 custom extensions:

```typescript
// Ghost text for AI completions
const GhostText = Extension.create({
  name: 'ghostText',
  addProseMirrorPlugins() {
    const key = new PluginKey('ghostText');
    return [
      new Plugin({
        key,
        state: {
          init: () => ({ text: null, pos: null }),
          apply(tr, value) {
            const meta = tr.getMeta(key);
            if (meta !== undefined) return meta;
            if (tr.docChanged) return { text: null, pos: null };
            return value;
          },
        },
        props: {
          decorations(state) {
            const { text, pos } = key.getState(state);
            if (!text || pos === null) return DecorationSet.empty;
            const widget = document.createElement('span');
            widget.className = 'ghost-text';
            widget.textContent = text;
            return DecorationSet.create(state.doc, [
              Decoration.widget(pos, widget, { side: 1 }),
            ]);
          },
        },
      }),
    ];
  },
});

// Comment mark with status-based styling
const CommentMark = Extension.create({
  name: 'commentMark',
  addProseMirrorPlugins() {
    const key = new PluginKey('commentMark');
    return [
      new Plugin({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, decorations) {
            const meta = tr.getMeta(key);
            if (meta) return buildCommentDecorations(tr.doc, meta.comments);
            if (tr.docChanged) return decorations.map(tr.mapping, tr.doc);
            return decorations;
          },
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
        },
      }),
    ];
  },
});
```

### Markdown Round-Tripping

The markdown conversion layer must preserve perfect fidelity through parse and serialize cycles:

```typescript
import { MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown';
import markdownit from 'markdown-it';

// Initialize markdown-it with GFM extensions
const md = markdownit('default', {
  html: false,
  breaks: false,
  linkify: true,
})
  .enable(['table', 'strikethrough'])
  .use(taskListPlugin);

// Parser: Markdown string → ProseMirror document
export function parseMarkdown(content: string): Node {
  const parser = new MarkdownParser(schema, md, tokenHandlers);
  return parser.parse(content) ?? schema.topNodeType.create();
}

// Serializer: ProseMirror document → Markdown string
export function serializeMarkdown(doc: Node): string {
  const serializer = new MarkdownSerializer(nodeSerializers, markSerializers);
  return serializer.serialize(doc, { tightLists: true });
}
```

### Table Serialization

Tables require special handling for GFM-compatible round-tripping:

```typescript
// Custom table serializer for GitHub Flavored Markdown
function serializeTable(state: MarkdownSerializerState, node: Node) {
  const rows: string[][] = [];
  const alignments: string[] = [];

  node.forEach((row, _, rowIndex) => {
    const cells: string[] = [];
    row.forEach((cell) => {
      const content = state.renderInline(cell);
      cells.push(content.trim());
      if (rowIndex === 0) {
        alignments.push(cell.attrs.alignment || 'left');
      }
    });
    rows.push(cells);
  });

  // Calculate column widths
  const widths = rows[0].map((_, colIndex) =>
    Math.max(3, ...rows.map(row => (row[colIndex] || '').length))
  );

  // Header row
  state.write('| ' + rows[0].map((cell, i) => cell.padEnd(widths[i])).join(' | ') + ' |\n');

  // Separator row with alignment
  state.write('| ' + alignments.map((align, i) => {
    const width = widths[i];
    if (align === 'center') return ':' + '-'.repeat(width - 2) + ':';
    if (align === 'right') return '-'.repeat(width - 1) + ':';
    return '-'.repeat(width);
  }).join(' | ') + ' |\n');

  // Data rows
  for (let r = 1; r < rows.length; r++) {
    state.write('| ' + rows[r].map((cell, i) => cell.padEnd(widths[i])).join(' | ') + ' |\n');
  }
}
```

### Supported Content Types

The editor handles all standard markdown content plus several extensions:

- [x] Headings H1 through H6 with anchor links
- [x] Paragraphs with inline formatting
- [x] **Bold**, *italic*, ~~strikethrough~~, `inline code`
- [x] Bullet lists with nesting
- [x] Ordered lists with custom start numbers
- [x] Task lists with interactive checkboxes
- [x] Blockquotes with nested content
- [x] Code blocks with syntax highlighting via lowlight
- [x] Tables with header rows and alignment
- [x] Links with auto-detection
- [x] Images with local file support
- [x] Horizontal rules
- [x] Text color (8-color palette)
- [x] Background highlights (6-color palette)
- [x] Text alignment (left, center, right)
- [ ] Mermaid diagrams (planned)
- [ ] Math equations with KaTeX (planned)
- [ ] Excalidraw embedded drawings (planned)

Tagged as #editor #markdown #prosemirror #tiptap. Reviewed by @elena.

---

## 5. State Management

### Store Architecture

The application uses 20+ Zustand stores, each with a clear domain boundary. Stores communicate through React hooks that read from multiple stores and coordinate actions.

#### Editor Store

```typescript
interface EditorStore {
  tabs: Tab[];
  activeTabIndex: number;

  // Actions
  openTab: (path: string) => void;
  closeTab: (index: number) => void;
  setDirty: (index: number, dirty: boolean) => void;
  moveTab: (from: number, to: number) => void;
  setExternalChange: (index: number, change: ExternalChange | null) => void;
  setCopilotDisabled: (index: number, disabled: boolean) => void;
}

interface Tab {
  path: string;
  dirty: boolean;
  copilotDisabled: boolean;
  externalChange?: ExternalChange;
}

interface ExternalChange {
  content: string;
  timestamp: number;
}
```

#### Workspace Store

```typescript
interface WorkspaceStore {
  explorerFolders: string[];
  projects: Project[];
  fileTree: FileEntry[];

  // Actions
  addExplorerFolder: (path: string) => void;
  removeExplorerFolder: (path: string) => void;
  addProject: (project: Project) => void;
  removeProject: (path: string) => void;
  refreshFileTree: () => Promise<void>;
}

interface Project {
  path: string;
  name: string;
  description: string;
  template: 'default' | 'research' | 'writing' | 'blank';
}
```

#### Connections Store

```typescript
interface ConnectionsStore {
  connections: Connection[];
  addConnection: (conn: Connection, apiKey?: string) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  updateConnection: (id: string, updates: Partial<Connection>) => void;
}

interface Connection {
  id: string;
  provider: ProviderType;
  label: string;
  model?: string;
  capabilities: Capability[];
  sandboxEnabled: boolean;
  networkRestricted: boolean;
  kernelNetworkDeny: boolean;
  customWritablePaths: string[];
  allowedDomains: string[];
  envVars?: Record<string, string>;
}

type ProviderType = 'anthropic' | 'openai' | 'ollama' | 'local_bundled' | 'agent_managed' | 'openai_compatible';
type Capability = 'interactive' | 'agent_tasks' | 'inline_completion';
```

### Persistence Strategy

| Store | Method | What's Persisted |
| --- | --- | --- |
| editor-store | localStorage | Tab list, active index |
| workspace-store | localStorage | Folders, projects |
| settings-store | localStorage | Theme, font, preferences |
| connections-store | localStorage | Connection metadata (no keys) |
| routing-store | localStorage | Provider routing |
| chat-store | localStorage | Conversation history |
| comment-store | JSON sidecar files | Comments per document |
| permission-store | localStorage | Always-allowed tools/domains |
| skill-store | localStorage | Overrides, active agent |
| activity-store | localStorage | Agent task registry |
| external-change-store | None | Pending changes (ephemeral) |
| git-store | None | Branch/status (ephemeral) |
| diff-review-store | None | Review state (ephemeral) |

> The persistence strategy is intentional: anything that represents user decisions (settings, connections, permissions) is persisted. Anything that represents transient state (external changes, git status) is ephemeral and rebuilt on startup.

Tagged as #state #zustand #persistence. Maintained by @david.

---

## 6. AI Provider Integration

The application supports four distinct communication paths for AI features, unified behind a common abstraction layer.

### Provider Abstraction

```typescript
interface AIProvider {
  name: string;
  type: 'api_key' | 'agent_managed' | 'local' | 'local_bundled';

  // Capabilities
  supportsChat: boolean;
  supportsStreaming: boolean;
  supportsWebSearch: boolean;
  supportsToolCalling: boolean;
  supportsInlineCompletion: boolean;

  // Operations
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  stream(messages: ChatMessage[], options?: StreamOptions): AsyncIterator<string>;
  complete?(prefix: string, suffix: string): Promise<string>;
}
```

### Path 1: Direct API

For Anthropic and OpenAI connections with API keys stored in the OS keychain:

```typescript
async function streamDirectAPI(
  messages: ChatMessage[],
  provider: string,
  connectionId: string,
  callbacks: StreamCallbacks
): Promise<void> {
  // Set up event listeners
  const listeners = [
    await listen<string>('ai-stream-chunk', (e) => callbacks.onChunk(e.payload)),
    await listen<string>('ai-stream-thinking-chunk', (e) => callbacks.onThinking(e.payload)),
    await listen('ai-stream-done', () => {
      callbacks.onDone();
      listeners.forEach(unlisten => unlisten());
    }),
    await listen<{ url: string; title: string }>('ai-citation', (e) => {
      callbacks.onCitation(e.payload);
    }),
  ];

  // Invoke Tauri command — Rust resolves API key from keychain
  await invoke('ai_chat_stream', {
    messages,
    provider,
    connectionId, // Key resolved server-side from keychain
    webSearchEnabled: callbacks.webSearchEnabled,
  });
}
```

### Path 2: Agent Client Protocol (ACP)

For Claude Code, Codex, Copilot CLI, and Gemini CLI:

```typescript
async function streamACP(
  message: string,
  instanceId: string,
  sessionId: string,
  callbacks: StreamCallbacks
): Promise<void> {
  // ACP events include text chunks, tool calls, and permission requests
  const unlisten = await listen<AcpEvent>('acp-session-update', (event) => {
    const { type, payload } = event.payload;

    switch (type) {
      case 'text':
        callbacks.onChunk(payload.text);
        break;
      case 'tool_call':
        callbacks.onToolCall(payload);
        break;
      case 'permission_request':
        callbacks.onPermissionRequest(payload);
        break;
      case 'done':
        callbacks.onDone();
        unlisten();
        break;
    }
  });

  await invoke('acp_session_prompt', {
    instanceId,
    sessionId,
    prompt: message,
  });
}
```

### Path 3: Copilot LSP

For inline code completions only (not chat):

```typescript
function useCopilotCompletion(editor: Editor | null) {
  const [ghostText, setGhostText] = useState<string | null>(null);

  useEffect(() => {
    if (!editor) return;

    const debounced = debounce(async () => {
      const position = getCursorPosition(editor);
      const result = await invoke<CompletionResult | null>(
        'copilot_lsp_inline_completion',
        {
          uri: activeTab.path,
          line: position.line,
          character: position.character,
        }
      );

      if (result?.text) {
        // Strip already-typed prefix
        const stripped = stripPrefix(result.text, editor);
        if (stripped) {
          editor.commands.setGhostText(stripped);
        }
      }
    }, 150);

    editor.on('update', debounced);
    return () => editor.off('update', debounced);
  }, [editor]);
}
```

### Path 4: Local Bundled Inference

For fully offline AI using the bundled llama-server:

```rust
// Start llama-server as a sidecar process
pub async fn start_local_server(
    model_path: &str,
    port: u16,
    gpu_layers: i32,
) -> Result<Child, String> {
    let binary = resolve_llama_server_path()?;

    let child = Command::new(binary)
        .args(&[
            "--model", model_path,
            "--port", &port.to_string(),
            "--n-gpu-layers", &gpu_layers.to_string(),
            "--ctx-size", "4096",
            "--host", "127.0.0.1",
        ])
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Failed to start llama-server: {}", e))?;

    // Wait for health check
    wait_for_health(port, Duration::from_secs(30)).await?;

    Ok(child)
}
```

### Model Catalog

The application ships with a curated catalog of 18 LLM models:

| Model | Category | Size | FIM | Thinking | RAM |
| --- | --- | --- | --- | --- | --- |
| Qwen 2.5 Coder 1.5B | Code | 1.7GB | Yes | No | 8GB |
| Qwen 2.5 Coder 7B | Code | 5.1GB | Yes | No | 16GB |
| Qwen 2.5 14B | General | 9.8GB | No | No | 32GB |
| DeepSeek R1 1.5B | Reasoning | 1.3GB | No | Yes | 8GB |
| DeepSeek R1 7B | Reasoning | 5.2GB | No | Yes | 16GB |
| DeepSeek R1 14B | Reasoning | 9.1GB | No | Yes | 32GB |
| Llama 3.2 1B | Compact | 1.3GB | No | No | 8GB |
| Llama 3.2 3B | Compact | 2.3GB | No | No | 8GB |
| Llama 3.1 8B | General | 5.4GB | No | No | 16GB |
| Phi-3.5 Mini | Compact | 2.4GB | No | No | 8GB |
| Gemma 2 2B | Compact | 1.8GB | No | No | 8GB |
| Gemma 2 9B | General | 6.4GB | No | No | 16GB |
| Mistral 7B | General | 4.7GB | No | No | 16GB |
| CodeGemma 7B | Code | 5.0GB | Yes | No | 16GB |
| StarCoder2 3B | Code | 2.1GB | Yes | No | 8GB |
| StarCoder2 7B | Code | 4.9GB | Yes | No | 16GB |
| Phi-4 14B | General | 9.3GB | No | Yes | 32GB |
| Command R 7B | General | 5.1GB | No | No | 16GB |

Tagged as #ai #providers #models #local-ai. Reviewed by @marcus.

---

## 7. Security Architecture

### Defense in Depth

The application implements security at multiple layers, ensuring that a breach at any single layer does not compromise the entire system.

#### Layer 1: Tauri IPC Boundary

All frontend-to-backend communication flows through typed Tauri commands. The frontend cannot access the filesystem, network, or OS APIs directly:

```rust
// Every command explicitly declares its parameters and return types
#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    // Validate path before reading
    validate_path(&path)?;
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}
```

#### Layer 2: OS Keychain for Secrets

API keys are stored in the macOS Keychain, never in localStorage or configuration files:

```rust
use keyring::Entry;

const SERVICE_PREFIX: &str = "notesage";

pub fn store_credential(connection_id: &str, key: &str) -> Result<(), String> {
    let service = format!("{}:{}", SERVICE_PREFIX, connection_id);
    let entry = Entry::new(&service, "api_key")
        .map_err(|e| format!("Keychain error: {}", e))?;
    entry.set_password(key)
        .map_err(|e| format!("Store error: {}", e))
}

pub fn get_credential(connection_id: &str) -> Result<Option<String>, String> {
    let service = format!("{}:{}", SERVICE_PREFIX, connection_id);
    match Entry::new(&service, "api_key") {
        Ok(entry) => match entry.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        },
        Err(e) => Err(e.to_string()),
    }
}
```

#### Layer 3: Kernel-Level Sandboxing

Agent subprocesses run under macOS Seatbelt profiles that deny all network access except the proxy:

```
;; Generated per-agent Seatbelt profile
(version 1)
(deny default)

;; Allow process execution
(allow process-exec)
(allow process-fork)

;; Allow file reads globally
(allow file-read*)

;; Restrict file writes to specific paths
(allow file-write* (subpath "/tmp"))
(allow file-write* (subpath "/Users/peter/Development/project"))

;; Network: only allow proxy on localhost
(allow network-outbound (remote ip "localhost:54321"))
(allow network-bind (local ip "*:*"))

;; Deny everything else (implicit from deny default)
```

#### Layer 4: HTTP Proxy Domain Filtering

All agent network traffic routes through a localhost HTTP proxy that enforces domain allowlists:

```rust
async fn handle_proxy_request(
    req: Request<Body>,
    state: Arc<ProxyState>,
) -> Result<Response<Body>, hyper::Error> {
    let host = req.uri().host().unwrap_or("unknown");

    // Check against connection's allowlist
    if state.is_domain_allowed(host) {
        return forward_request(req).await;
    }

    // Request user approval via Tauri event
    let approved = state.request_domain_approval(host).await;

    if approved {
        forward_request(req).await
    } else {
        Ok(Response::builder()
            .status(403)
            .body(Body::from("Domain blocked by Notesage"))
            .unwrap())
    }
}
```

#### Layer 5: Permission-Gated Tool Calls

Every ACP tool call requires explicit user approval:

```typescript
interface PermissionRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  instanceId: string;
  sessionId: string;
}

// Three approval tiers
type ApprovalLevel = 'once' | 'session' | 'always';

function handlePermission(request: PermissionRequest, level: ApprovalLevel) {
  if (level === 'always') {
    permissionStore.addAlwaysAllowed(request.toolName);
  }
  if (level === 'session') {
    permissionStore.addSessionAllowed(request.toolName);
  }
  invoke('acp_approve_tool_call', {
    instanceId: request.instanceId,
    sessionId: request.sessionId,
    approved: true,
  });
}
```

### Credential Migration

Existing plaintext API keys in localStorage are automatically migrated to the OS keychain on first launch:

```typescript
// Migration runs once on app startup
async function migrateCredentials(): Promise<void> {
  const raw = localStorage.getItem('notesage-connections');
  if (!raw) return;

  try {
    const migrated = await invoke<number>('migrate_credentials', {
      connectionsJson: raw,
    });
    if (migrated > 0) {
      console.log(`Migrated ${migrated} credentials to OS keychain`);
    }
  } catch (error) {
    console.error('Credential migration failed:', error);
  }
}
```

> Security is not a feature you add at the end — it's a foundation you build on from the start. Every API key, every network request, every tool call goes through at least two layers of validation before it can execute.

Tagged as #security #keychain #sandbox #permissions. Reviewed by @security-team.

---

## 8. Performance Engineering

### Measurement Framework

Performance is measured at multiple levels:

| Level | Tool | Metrics |
| --- | --- | --- |
| App startup | Performance API | Time to interactive |
| Editor ops | `performance.mark()` | Keystroke latency, save time |
| IPC calls | Instrumented invoke | Round-trip time |
| Rendering | React DevTools | Component render count |
| Memory | Activity Monitor | RSS, virtual memory |
| Bundle | Vite analyzer | Chunk sizes |

### Performance Budgets

| Operation | Budget | P50 | P95 | P99 |
| --- | --- | --- | --- | --- |
| App startup | 1000ms | 680ms | 850ms | 950ms |
| File open (1KB) | 50ms | 28ms | 42ms | 48ms |
| File open (10KB) | 100ms | 65ms | 88ms | 95ms |
| File open (50KB) | 150ms | 110ms | 135ms | 148ms |
| File open (100KB) | 200ms | 155ms | 185ms | 198ms |
| Keystroke latency | 16ms | 6ms | 12ms | 15ms |
| Save to disk | 100ms | 55ms | 82ms | 95ms |
| Tab switch | 50ms | 22ms | 38ms | 45ms |
| Theme toggle | 100ms | 35ms | 68ms | 88ms |
| Search (1K files) | 50ms | 25ms | 42ms | 48ms |
| Search (10K files) | 200ms | 120ms | 175ms | 195ms |
| AI stream first token | 500ms | 280ms | 420ms | 480ms |
| Markdown parse (100KB) | 100ms | 45ms | 78ms | 92ms |
| Markdown serialize (100KB) | 100ms | 52ms | 85ms | 95ms |

### Optimization Techniques

#### Debounced Auto-Save

```typescript
function useAutoSave(editor: Editor | null, path: string | undefined) {
  const saveTimerRef = useRef<NodeJS.Timeout>();

  const save = useCallback(async () => {
    if (!editor || !path) return;

    const content = serializeMarkdown(editor.state.doc);
    await invoke('mark_self_write', { path });
    await invoke('write_file', { path, content });

    useEditorStore.getState().setDirty(
      useEditorStore.getState().activeTabIndex,
      false
    );
  }, [editor, path]);

  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(save, 1000);
    };

    editor.on('update', handleUpdate);
    return () => {
      editor.off('update', handleUpdate);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [editor, save]);
}
```

#### Lazy Component Loading

```typescript
const EpubViewer = lazy(() => import('@/components/editor/viewers/EpubViewer'));
const PdfViewer = lazy(() => import('@/components/editor/viewers/PdfViewer'));
const DocxViewer = lazy(() => import('@/components/editor/viewers/DocxViewer'));
const SettingsDialog = lazy(() => import('@/components/settings/SettingsDialog'));
const ExportDialog = lazy(() => import('@/components/ExportDialog'));

function EditorArea({ activeTab }: { activeTab: Tab }) {
  const extension = getFileExtension(activeTab.path);

  return (
    <Suspense fallback={<Skeleton className="h-full w-full" />}>
      {extension === '.md' && <Editor />}
      {extension === '.epub' && <EpubViewer path={activeTab.path} />}
      {extension === '.pdf' && <PdfViewer path={activeTab.path} />}
      {extension === '.docx' && <DocxViewer path={activeTab.path} />}
    </Suspense>
  );
}
```

#### SQLite Index for Fast Search

The document index uses SQLite with FTS5 for sub-50ms search across thousands of files:

```sql
-- Full-text search with ranking
SELECT
    d.path,
    d.title,
    snippet(fts_content, 2, '<mark>', '</mark>', '...', 32) as snippet,
    rank
FROM fts_content
JOIN documents d ON d.path = fts_content.path
WHERE fts_content MATCH ?
ORDER BY rank
LIMIT 20;

-- Tag search with aggregation
SELECT
    t.tag,
    COUNT(DISTINCT t.document_id) as file_count,
    GROUP_CONCAT(DISTINCT d.path) as files
FROM tags t
JOIN documents d ON t.document_id = d.id
WHERE t.tag LIKE ? || '%'
GROUP BY t.tag
ORDER BY file_count DESC
LIMIT 20;

-- Mention cross-reference
SELECT
    m.mention,
    d.path,
    d.title,
    m.line
FROM mentions m
JOIN documents d ON m.document_id = d.id
WHERE m.mention = ?
ORDER BY d.path, m.line;
```

#### Bundle Splitting

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core vendor chunks
          'vendor-react': ['react', 'react-dom'],
          'vendor-editor': ['@tiptap/core', '@tiptap/react', '@tiptap/pm'],
          'vendor-ui': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-tooltip',
          ],
          'vendor-syntax': ['lowlight', 'highlight.js'],

          // Feature chunks
          'feature-chat': [
            './src/components/chat/ChatPanel.tsx',
            './src/components/chat/ChatMessage.tsx',
            './src/components/chat/ChatInput.tsx',
          ],
          'feature-settings': [
            './src/components/settings/SettingsDialog.tsx',
          ],
        },
      },
    },
  },
});
```

Tagged as #performance #optimization #benchmarks. Maintained by @peter.

---

## 9. Testing Strategy

### Test Pyramid

```
            ╱╲
           ╱  ╲         E2E (7 specs, 33 tests)
          ╱    ╲         WebDriverIO + Tauri driver
         ╱──────╲
        ╱        ╲       Integration (Playwright)
       ╱──────────╲      Browser-based component tests
      ╱            ╲
     ╱──────────────╲    Unit Tests (1115 tests)
    ╱                ╲   Vitest + cargo test
   ╱──────────────────╲
```

### Unit Testing

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditorStore } from '@/stores/editor-store';

describe('editor-store', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [], activeTabIndex: 0 });
  });

  describe('openTab', () => {
    it('should add a new tab', () => {
      const { result } = renderHook(() => useEditorStore());
      act(() => result.current.openTab('/test/file.md'));
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].path).toBe('/test/file.md');
    });

    it('should activate existing tab instead of duplicating', () => {
      const { result } = renderHook(() => useEditorStore());
      act(() => {
        result.current.openTab('/test/a.md');
        result.current.openTab('/test/b.md');
        result.current.openTab('/test/a.md');
      });
      expect(result.current.tabs).toHaveLength(2);
      expect(result.current.activeTabIndex).toBe(0);
    });

    it('should set new tab as active', () => {
      const { result } = renderHook(() => useEditorStore());
      act(() => {
        result.current.openTab('/test/a.md');
        result.current.openTab('/test/b.md');
      });
      expect(result.current.activeTabIndex).toBe(1);
    });
  });

  describe('closeTab', () => {
    it('should remove the tab at the given index', () => {
      const { result } = renderHook(() => useEditorStore());
      act(() => {
        result.current.openTab('/test/a.md');
        result.current.openTab('/test/b.md');
        result.current.closeTab(0);
      });
      expect(result.current.tabs).toHaveLength(1);
      expect(result.current.tabs[0].path).toBe('/test/b.md');
    });

    it('should adjust activeTabIndex when closing before active', () => {
      const { result } = renderHook(() => useEditorStore());
      act(() => {
        result.current.openTab('/test/a.md');
        result.current.openTab('/test/b.md');
        result.current.openTab('/test/c.md');
        result.current.closeTab(0);
      });
      expect(result.current.activeTabIndex).toBe(1);
    });
  });

  describe('setDirty', () => {
    it('should mark a tab as dirty', () => {
      const { result } = renderHook(() => useEditorStore());
      act(() => {
        result.current.openTab('/test/file.md');
        result.current.setDirty(0, true);
      });
      expect(result.current.tabs[0].dirty).toBe(true);
    });

    it('should clear dirty flag', () => {
      const { result } = renderHook(() => useEditorStore());
      act(() => {
        result.current.openTab('/test/file.md');
        result.current.setDirty(0, true);
        result.current.setDirty(0, false);
      });
      expect(result.current.tabs[0].dirty).toBe(false);
    });
  });
});
```

### Markdown Round-Trip Tests

```typescript
import { describe, it, expect } from 'vitest';
import { parseMarkdown, serializeMarkdown } from '@/lib/markdown';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(__dirname, '../fixtures');

describe('markdown round-trip', () => {
  const fixtures = [
    'headings.md',
    'inline-formatting.md',
    'lists.md',
    'task-lists.md',
    'blockquotes.md',
    'code-blocks.md',
    'tables.md',
    'links-images.md',
    'horizontal-rules.md',
    'mixed-content.md',
  ];

  fixtures.forEach((fixture) => {
    it(`should round-trip ${fixture}`, () => {
      const input = readFileSync(join(FIXTURES_DIR, fixture), 'utf-8');
      const doc = parseMarkdown(input);
      const output = serializeMarkdown(doc);
      expect(normalizeWhitespace(output)).toBe(normalizeWhitespace(input));
    });
  });
});

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]+$/gm, '')  // Trailing whitespace
    .replace(/\n{3,}/g, '\n\n') // Multiple blank lines
    .trim();
}
```

### Rust Backend Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_tags_basic() {
        let md = "Hello #world and #rust-lang";
        let tags = parse_tags(md);
        assert_eq!(tags, vec![
            Tag { name: "world".to_string(), line: 1 },
            Tag { name: "rust-lang".to_string(), line: 1 },
        ]);
    }

    #[test]
    fn test_parse_tags_ignores_code_blocks() {
        let md = "Normal #tag\n```\n#not-a-tag\n```\nAnother #real-tag";
        let tags = parse_tags(md);
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].name, "tag");
        assert_eq!(tags[1].name, "real-tag");
    }

    #[test]
    fn test_parse_tags_ignores_inline_code() {
        let md = "A `#not-a-tag` but #yes-a-tag";
        let tags = parse_tags(md);
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "yes-a-tag");
    }

    #[test]
    fn test_parse_mentions() {
        let md = "Hello @alice and @bob-smith";
        let mentions = parse_mentions(md);
        assert_eq!(mentions, vec![
            Mention { name: "alice".to_string(), line: 1 },
            Mention { name: "bob-smith".to_string(), line: 1 },
        ]);
    }

    #[test]
    fn test_parse_tasks() {
        let md = "- [x] Done task\n- [ ] Pending task";
        let tasks = parse_tasks(md);
        assert_eq!(tasks.len(), 2);
        assert!(tasks[0].checked);
        assert!(!tasks[1].checked);
    }

    #[test]
    fn test_markdown_to_typst_headings() {
        assert_eq!(markdown_to_typst("# H1"), "= H1\n");
        assert_eq!(markdown_to_typst("## H2"), "== H2\n");
        assert_eq!(markdown_to_typst("### H3"), "=== H3\n");
    }

    #[test]
    fn test_markdown_to_typst_emphasis() {
        assert_eq!(markdown_to_typst("**bold**"), "*bold*\n");
        assert_eq!(markdown_to_typst("*italic*"), "_italic_\n");
    }

    #[test]
    fn test_markdown_to_typst_code_block() {
        let input = "```python\ndef hello():\n    print('world')\n```";
        let result = markdown_to_typst(input);
        assert!(result.contains("```python"));
        assert!(result.contains("def hello():"));
    }

    #[test]
    fn test_content_hash() {
        let content = "Hello, world!";
        let hash1 = compute_content_hash(content);
        let hash2 = compute_content_hash(content);
        assert_eq!(hash1, hash2);

        let different = compute_content_hash("Different content");
        assert_ne!(hash1, different);
    }

    #[test]
    fn test_file_entry_ordering() {
        let mut entries = vec![
            FileEntry::new("zebra.md", false),
            FileEntry::new("alpha/", true),
            FileEntry::new("beta.md", false),
            FileEntry::new("gamma/", true),
        ];
        entries.sort();
        assert_eq!(entries[0].name, "alpha");
        assert_eq!(entries[1].name, "gamma");
        assert_eq!(entries[2].name, "beta.md");
        assert_eq!(entries[3].name, "zebra.md");
    }
}
```

### E2E Tests

```typescript
import { test, expect } from '@playwright/test';

test.describe('Application Lifecycle', () => {
  test('should start and show the main window', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="app-container"]')).toBeVisible();
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
  });

  test('should toggle theme', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');

    // Toggle to dark mode
    await page.keyboard.press('Meta+t');
    await expect(html).toHaveClass(/dark/);

    // Toggle back to light mode
    await page.keyboard.press('Meta+t');
    await expect(html).not.toHaveClass(/dark/);
  });

  test('should open settings dialog', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+,');
    await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();
  });

  test('should open and close command palette', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+k');
    await expect(page.locator('[data-testid="command-palette"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="command-palette"]')).not.toBeVisible();
  });
});
```

### Coverage Results

| Module | Lines | Branches | Functions | Target | Status |
| --- | --- | --- | --- | --- | --- |
| stores/ | 84.09% | 78.2% | 82.5% | 80% | Pass |
| hooks/ | 86.95% | 81.4% | 85.1% | 80% | Pass |
| lib/markdown.ts | 89.91% | 85.7% | 88.3% | 85% | Pass |
| lib/ (other) | 72.8% | 66.3% | 71.0% | 70% | Pass |
| components/ | 55.3% | 48.1% | 52.8% | 60% | Fail |
| **Overall** | **70.25%** | **64.8%** | **68.9%** | **65%** | **Pass** |

> Every PR must maintain or improve test coverage. The CI pipeline runs coverage regression checks automatically, and PRs that drop below the baseline are blocked from merging.

Tagged as #testing #coverage #e2e #vitest. Reviewed by @testing-team.

---

## 10. Deployment Pipeline

### Build Process

```bash
# 1. Install dependencies
pnpm install

# 2. Run all checks
pnpm typecheck          # TypeScript type checking
pnpm test               # Unit tests
pnpm test:e2e           # Playwright E2E tests
pnpm coverage:check     # Coverage regression check

# 3. Build for production
pnpm tauri build

# 4. Output
# src-tauri/target/release/bundle/macos/Notesage.app
# src-tauri/target/release/bundle/dmg/Notesage_0.23.2_aarch64.dmg
```

### CI Pipeline

The GitHub Actions workflow runs on every push to `main` and every PR:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'pnpm'

      - run: pnpm install
      - run: pnpm typecheck
      - run: pnpm test:coverage
      - run: pnpm coverage:check

      - name: Playwright E2E
        run: pnpm test:e2e

  rust:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cd src-tauri && cargo test
```

### Release Process

1. Update version in `package.json`
2. Create a git tag: `git tag v0.23.2`
3. Push tag: `git push origin v0.23.2`
4. CI builds and signs the application
5. DMG uploaded to release server
6. Auto-update manifest updated

### Binary Size Tracking

| Component | v0.22.0 | v0.23.0 | v0.23.2 | Budget |
| --- | --- | --- | --- | --- |
| Tauri runtime | 3.1MB | 3.2MB | 3.2MB | 5MB |
| Frontend bundle | 1.6MB | 1.7MB | 1.8MB | 3MB |
| Rust backend | 3.8MB | 4.0MB | 4.1MB | 5MB |
| Bundled fonts | 2.7MB | 2.7MB | 2.7MB | 3MB |
| llama-server | 8.2MB | 8.4MB | 8.5MB | 10MB |
| **Total** | **19.4MB** | **20.0MB** | **20.3MB** | **26MB** |

Tagged as #deployment #ci #release. Maintained by @peter.

---

## 11. Workspace and File Management

### Project Structure

Each project has a `.notesage/` metadata directory:

```
my-project/
├── .notesage/
│   ├── project.json       # Project metadata
│   ├── comments/           # Comment sidecar files
│   │   ├── {uuid}.json     # Per-document comments
│   │   └── path-{hash}.json
│   ├── skills/             # Project-scoped skills
│   ├── agents/             # Project-scoped agents
│   ├── research/           # Research files
│   │   ├── climate-policy.md
│   │   └── renewable-energy.md
│   ├── agents.md           # Agent instructions
│   ├── mcp.json            # MCP server config
│   └── index.db            # SQLite document index
├── notes/
│   ├── meeting-notes.md
│   └── project-plan.md
├── research/
│   └── literature-review.md
└── README.md
```

### File Tree

The sidebar file tree displays all files in the workspace with icons, expansion, and context menus:

```typescript
interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  children?: FileEntry[];
}

function FileTreeItem({ entry, depth }: { entry: FileEntry; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const icon = getFileIcon(entry);

  return (
    <div>
      <button
        className={cn(
          'flex items-center w-full px-2 py-1 text-sm',
          'hover:bg-muted transition-colors duration-150',
          isActive && 'bg-muted border-l-2 border-primary'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => entry.is_directory ? setExpanded(!expanded) : openFile(entry.path)}
      >
        {entry.is_directory && (
          <ChevronRight className={cn('w-4 h-4 transition-transform', expanded && 'rotate-90')} />
        )}
        {icon}
        <span className="truncate">{entry.name}</span>
      </button>
      {expanded && entry.children?.map(child => (
        <FileTreeItem key={child.path} entry={child} depth={depth + 1} />
      ))}
    </div>
  );
}
```

### External Change Detection

The filesystem watcher detects changes made outside the application:

```typescript
function useFileWatcher() {
  useEffect(() => {
    const unlisten = listen<{ path: string; kind: string }>('file-changed', async (event) => {
      const { path, kind } = event.payload;
      const normalizedPath = normalizePath(path);

      switch (kind) {
        case 'create':
        case 'delete':
          await refreshFileTree();
          break;

        case 'modify': {
          const tabIndex = findTabByPath(normalizedPath);
          if (tabIndex === -1) return;

          const diskContent = await invoke<string>('read_file', { path: normalizedPath });
          const tabContent = getTabContent(tabIndex);

          if (diskContent === tabContent) return; // No actual change

          if (isTabDirty(tabIndex)) {
            showReloadBanner(tabIndex, diskContent);
          } else {
            reloadTab(tabIndex, diskContent);
          }
          break;
        }
      }
    });

    return () => { unlisten.then(fn => fn()); };
  }, []);
}
```

### iCloud Sync

Projects can be selectively synced to iCloud:

| Operation | Source | Destination |
| --- | --- | --- |
| Enable sync | `~/Notesage/project/` | `~/Library/Mobile Documents/.../Notesage/project/` |
| Disable sync | iCloud location | `~/Notesage/project/` |
| Auto-discovery | iCloud folder scan | Add to workspace |

- [x] Selective per-project sync
- [x] Bidirectional migration
- [x] Auto-discovery of synced projects
- [x] iCloud badge on synced files
- [x] Index excluded from sync (xattr)
- [ ] Conflict resolution UI
- [ ] Sync status monitoring

Tagged as #workspace #files #icloud #watcher. Reviewed by @peter.

---

## 12. Plugin and Extension System

### Tiptap Extension Pattern

Every custom extension follows a consistent structure:

```typescript
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DecorationSet, Decoration } from '@tiptap/pm/view';

// Step 1: Define plugin key
const KEY = new PluginKey('myExtension');

// Step 2: Define state interface
interface State {
  decorations: DecorationSet;
  config: Config;
}

// Step 3: Create extension
export const MyExtension = Extension.create({
  name: 'myExtension',

  addCommands() {
    return {
      setConfig: (config: Config) => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(KEY, { type: 'config', config });
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: KEY,
        state: {
          init: (): State => ({
            decorations: DecorationSet.empty,
            config: defaultConfig,
          }),
          apply(tr, state): State {
            const meta = tr.getMeta(KEY);
            if (meta?.type === 'config') {
              return { ...state, config: meta.config, decorations: rebuild(tr.doc, meta.config) };
            }
            if (tr.docChanged) {
              return { ...state, decorations: state.decorations.map(tr.mapping, tr.doc) };
            }
            return state;
          },
        },
        props: {
          decorations: (state) => KEY.getState(state)?.decorations ?? DecorationSet.empty,
        },
      }),
    ];
  },
});
```

### Skills Platform

Skills extend AI capabilities through file-based definitions:

```yaml
# SKILL.md — Skill definition
---
name: download-webpage
description: Download a webpage and convert to clean markdown
parameters:
  - name: url
    type: string
    required: true
    description: URL to download
  - name: include_images
    type: boolean
    default: false
    description: Whether to include image references
---

# Download Webpage

Downloads the content at the given URL and converts it to clean markdown format suitable for research storage.

## Usage

Provide a URL and the skill will:
1. Fetch the page content
2. Strip navigation, ads, and boilerplate
3. Convert to clean markdown
4. Extract metadata (title, author, date)
5. Return the formatted content
```

### MCP Integration

The Model Context Protocol enables tool integration with external servers:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/peter/Documents"],
      "env": {}
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

Tagged as #plugins #skills #mcp #extensions. Reviewed by @marcus.

---

## 13. Accessibility

### WCAG 2.1 AA Compliance

The application targets WCAG 2.1 AA compliance for all interactive elements.

#### Focus Management

```typescript
// Custom focus ring that matches the design system
const focusRingClass = cn(
  'focus-visible:outline-none',
  'focus-visible:ring-2',
  'focus-visible:ring-ring',
  'focus-visible:ring-offset-2',
  'focus-visible:ring-offset-background'
);
```

#### Keyboard Navigation

| Context | Key | Action |
| --- | --- | --- |
| File tree | Arrow Up/Down | Navigate items |
| File tree | Enter | Open file/expand folder |
| File tree | Delete | Delete with confirmation |
| Tab bar | Cmd+W | Close active tab |
| Editor | Tab | Indent list item |
| Editor | Shift+Tab | Outdent list item |
| Editor | Escape | Clear selection/close popover |
| Chat | Enter | Send message |
| Chat | Shift+Enter | New line in message |
| Command palette | Arrow Up/Down | Navigate results |
| Command palette | Enter | Select result |
| Command palette | Escape | Close palette |

#### Color Contrast

All color combinations meet WCAG AA minimum contrast ratios:

| Pair | Light Mode | Dark Mode | Required |
| --- | --- | --- | --- |
| Foreground / Background | 15.2:1 | 14.8:1 | 4.5:1 |
| Muted / Background | 4.8:1 | 4.6:1 | 4.5:1 |
| Primary / Background | 12.5:1 | 11.8:1 | 4.5:1 |
| Border / Background | 2.1:1 | 2.3:1 | 3:1 (non-text) |

#### Screen Reader

- [x] Semantic HTML throughout
- [x] ARIA labels on icon-only buttons
- [x] Live regions for AI responses
- [x] Focus trapping in modals
- [x] Skip navigation links
- [ ] Table of contents announcements
- [ ] Editor content landmarks

Tagged as #accessibility #wcag #keyboard. Maintained by @accessibility-team.

---

## 14. Internationalization

### Current Status

The application currently supports English only, but the architecture accommodates future localization.

### Translation Architecture

```typescript
// Proposed i18n system
import { createContext, useContext } from 'react';

interface Translations {
  [key: string]: string | Translations;
}

const I18nContext = createContext<{
  t: (key: string) => string;
  locale: string;
  setLocale: (locale: string) => void;
}>({
  t: (key) => key,
  locale: 'en',
  setLocale: () => {},
});

function useTranslation() {
  return useContext(I18nContext);
}

// Usage in components
function SaveButton() {
  const { t } = useTranslation();
  return <Button>{t('editor.save')}</Button>;
}
```

### Planned Locales

| Code | Language | Script | Direction | Priority |
| --- | --- | --- | --- | --- |
| en | English | Latin | LTR | Current |
| sv | Swedish | Latin | LTR | High |
| de | German | Latin | LTR | High |
| fr | French | Latin | LTR | High |
| es | Spanish | Latin | LTR | Medium |
| ja | Japanese | CJK | LTR | Medium |
| zh-Hans | Chinese (Simplified) | CJK | LTR | Medium |
| zh-Hant | Chinese (Traditional) | CJK | LTR | Medium |
| ko | Korean | Hangul | LTR | Medium |
| ar | Arabic | Arabic | RTL | Low |
| he | Hebrew | Hebrew | RTL | Low |

> Internationalization is a foundation, not a feature. Building with i18n in mind from the start is far cheaper than retrofitting it later. Even if we only ship English initially, the architecture should support multiple languages without major refactoring.

Tagged as #i18n #localization. Maintained by @peter.

---

## 15. Troubleshooting Guide

### Common Issues and Solutions

#### Application Won't Start

```bash
# Check for port conflicts
lsof -i :1420

# Check for orphan llama-server processes
ps aux | grep llama-server

# Clean rebuild
cd src-tauri && cargo clean && cd .. && pnpm tauri dev
```

#### Editor Content Not Updating

The most common cause is updating Zustand state without pushing to ProseMirror:

```typescript
// WRONG: Updates store but NOT the editor
tab.content = newContent;

// RIGHT: Updates the editor, which IS the source of truth
editor.commands.setContent(parseMarkdown(newContent));
```

#### Filesystem Watcher Not Detecting Changes

Check for self-write suppression and path normalization issues:

```typescript
// macOS FSEvents canonicalizes /var → /private/var
function normalizePath(path: string): string {
  return path.replace(/^\/private/, '');
}
```

#### AI Provider Connection Failures

| Provider | Check | Command |
| --- | --- | --- |
| Anthropic | API key in keychain | Settings > Connections |
| OpenAI | API key in keychain | Settings > Connections |
| Ollama | Server running | `curl http://localhost:11434/api/tags` |
| Local AI | llama-server status | Settings > Local AI |
| Claude Code | Binary installed | `~/.notesage/bin/claude-agent-acp --version` |
| Codex | Binary installed | `~/.notesage/bin/codex-acp --version` |

#### Build Failures After Changing Tauri Commands

When adding or removing Tauri commands, a clean rebuild may be necessary:

```bash
# Clean Rust build cache
cd src-tauri && cargo clean && cd ..

# Reinstall dependencies and rebuild
pnpm install && pnpm tauri dev
```

- [x] Port conflict resolution documented
- [x] Orphan process cleanup documented
- [x] Path normalization issues documented
- [x] Provider connection debugging documented
- [ ] Memory leak investigation guide
- [ ] Performance profiling guide

Tagged as #troubleshooting #debugging #faq. Maintained by @support-team.

---

## 16. API Reference

### Tauri Commands

#### File Operations

| Command | Parameters | Returns | Description |
| --- | --- | --- | --- |
| `read_file` | `path: string` | `string` | Read file contents |
| `write_file` | `path: string, content: string` | `void` | Write file contents |
| `list_directory` | `path: string` | `FileEntry[]` | List directory recursively |
| `create_file` | `path: string` | `void` | Create empty file |
| `create_directory` | `path: string` | `void` | Create directory |
| `rename_path` | `old: string, new: string` | `void` | Rename file/directory |
| `delete_path` | `path: string` | `void` | Delete file/directory |
| `path_exists` | `path: string` | `boolean` | Check if path exists |
| `copy_directory` | `src: string, dst: string` | `void` | Copy directory recursively |

#### AI Operations

| Command | Parameters | Returns | Description |
| --- | --- | --- | --- |
| `ai_chat_stream` | `messages, provider, connectionId, webSearch` | `void` | Stream chat response |
| `ai_generate_text` | `request: AIRequest` | `string` | Generate text |
| `acp_start_instance` | `provider, connectionId` | `instanceId` | Start ACP agent |
| `acp_session_prompt` | `instanceId, sessionId, prompt` | `void` | Send prompt to agent |
| `acp_approve_tool_call` | `instanceId, sessionId, approved` | `void` | Approve/deny tool |

#### Credential Operations

| Command | Parameters | Returns | Description |
| --- | --- | --- | --- |
| `store_credential` | `service: string, key: string` | `void` | Store in keychain |
| `get_credential` | `service: string` | `string?` | Get from keychain |
| `delete_credential` | `service: string` | `void` | Remove from keychain |
| `migrate_credentials` | `json: string` | `number` | Migrate from localStorage |

#### Export Operations

| Command | Parameters | Returns | Description |
| --- | --- | --- | --- |
| `export_pdf` | `markdown, title, template, toc, pageNums, pageSize` | `bytes` | Generate PDF |
| `save_binary_file` | `path: string, data: bytes` | `void` | Write binary file |

#### Watcher Operations

| Command | Parameters | Returns | Description |
| --- | --- | --- | --- |
| `watch_directory` | `path: string` | `void` | Start watching |
| `unwatch_directory` | — | `void` | Stop all watchers |
| `mark_self_write` | `path: string` | `void` | Suppress change event |
| `clear_self_write` | `path: string` | `void` | Remove suppression |

### Frontend Hooks

| Hook | Purpose | Dependencies |
| --- | --- | --- |
| `useEditor` | Tiptap editor instance | settings-store |
| `useAIOperations` | AI chat and generation | connections-store, routing-store |
| `useFileOperations` | File CRUD via Tauri | editor-store, workspace-store |
| `useFileWatcher` | External change detection | editor-store |
| `useCopilotCompletion` | LSP inline completions | routing-store |
| `useLocalCompletion` | Local inline completions | routing-store, local-ai-store |
| `useCommentDelegation` | Comment → agent flow | comment-store, activity-store |
| `useAgentTaskOperations` | Background agent tasks | activity-store |
| `useSkillOperations` | Skill/agent discovery | skill-store |
| `useRecording` | Audio capture | recording-store |
| `useTranscription` | Whisper transcription | recording-store |
| `useSpeechRecognition` | Live dictation | — |
| `useProjectMetadata` | Project bootstrap | project-metadata-store |
| `useStartWatchers` | Filesystem watcher init | workspace-store, settings-store |
| `useAppLifecycle` | Startup/shutdown hooks | settings-store |
| `useScrollPersistence` | Scroll position per tab | editor-store |
| `useEditorResize` | Editor panel resizing | — |
| `useLocalAI` | llama-server lifecycle | local-ai-store |
| `useModelMetadata` | Model info fetching | — |
| `useAcpLifecycle` | ACP agent management | connections-store |

Tagged as #api #reference #hooks #commands. Maintained by @peter.

---

## 17. Glossary

| Term | Full Name | Description |
| --- | --- | --- |
| ACP | Agent Client Protocol | Stdio-based protocol for communicating with AI agent subprocesses |
| AST | Abstract Syntax Tree | Tree representation of parsed markdown (via comrak) |
| CFI | Canonical Fragment Identifier | Standardized EPUB location reference for bookmarking |
| CRDT | Conflict-free Replicated Data Type | Data structure for collaborative editing without central server |
| CSP | Content Security Policy | Browser security mechanism restricting resource loading |
| FIM | Fill-in-the-Middle | Code completion technique providing prefix and suffix context |
| FTS5 | Full-Text Search 5 | SQLite extension providing efficient text search with stemming |
| GFM | GitHub Flavored Markdown | Extended markdown syntax with tables, task lists, strikethrough |
| GGUF | GPT-Generated Unified Format | Binary format for storing quantized LLM model weights |
| IPC | Inter-Process Communication | Tauri's typed command bridge between frontend and Rust backend |
| LSP | Language Server Protocol | JSON-RPC protocol for code intelligence features |
| MCP | Model Context Protocol | Protocol for AI tool integration with external servers |
| OFL | SIL Open Font License | Permissive license for bundled fonts |
| PM | ProseMirror | Low-level editor framework wrapped by Tiptap |
| RMS | Root Mean Square | Audio signal strength measurement for silence detection |
| SSE | Server-Sent Events | HTTP streaming protocol for AI response chunks |
| TOCTOU | Time-of-Check-Time-of-Use | Race condition class addressed in filesystem operations |
| WASM | WebAssembly | Binary format for portable execution (future plugin system) |

---

*This comprehensive guide is maintained as a living document. For questions or contributions, contact @peter or open an issue tagged with #documentation.*

*Last updated: 2026-03-28. Version 0.23.2. Tagged with #guide #reference #architecture #complete.*

---

## Appendix A: Design System Reference

### Color System

The application uses a strictly **monochrome** palette with oklch color values. No chromatic accent colors are used anywhere in the UI.

#### Light Mode Palette

| Token | Value | Usage |
| --- | --- | --- |
| `--background` | `oklch(100% 0 0)` | Page background |
| `--foreground` | `oklch(14% 0 0)` | Primary text |
| `--card` | `oklch(100% 0 0)` | Card backgrounds |
| `--card-foreground` | `oklch(14% 0 0)` | Card text |
| `--popover` | `oklch(100% 0 0)` | Popover backgrounds |
| `--popover-foreground` | `oklch(14% 0 0)` | Popover text |
| `--primary` | `oklch(20% 0 0)` | Primary buttons, active states |
| `--primary-foreground` | `oklch(98% 0 0)` | Text on primary |
| `--secondary` | `oklch(95% 0 0)` | Secondary backgrounds |
| `--secondary-foreground` | `oklch(20% 0 0)` | Secondary text |
| `--muted` | `oklch(95.5% 0 0)` | Muted backgrounds |
| `--muted-foreground` | `oklch(46% 0 0)` | Muted text |
| `--accent` | `oklch(95% 0 0)` | Accent backgrounds |
| `--accent-foreground` | `oklch(20% 0 0)` | Accent text |
| `--destructive` | `oklch(55% 0.22 29)` | Error/delete actions |
| `--border` | `oklch(90% 0 0)` | Borders |
| `--input` | `oklch(90% 0 0)` | Input borders |
| `--ring` | `oklch(50% 0 0)` | Focus rings |

#### Dark Mode Palette

| Token | Value | Usage |
| --- | --- | --- |
| `--background` | `oklch(18% 0 0)` | Page background |
| `--foreground` | `oklch(98% 0 0)` | Primary text |
| `--card` | `oklch(18% 0 0)` | Card backgrounds |
| `--primary` | `oklch(90% 0 0)` | Primary buttons |
| `--muted` | `oklch(28% 0 0)` | Muted backgrounds |
| `--border` | `oklch(32% 0 0)` | Borders |
| `--ring` | `oklch(60% 0 0)` | Focus rings |

#### Soft Contrast Mode

The soft contrast toggle adjusts extreme lightness values for a gentler reading experience:

```css
/* Light soft contrast */
.soft {
  --background: oklch(96% 0 0);
  --foreground: oklch(20% 0 0);
  --card: oklch(94% 0 0);
  --muted: oklch(92% 0 0);
}

/* Dark soft contrast */
.dark.soft {
  --background: oklch(25% 0 0);
  --foreground: oklch(90% 0 0);
  --card: oklch(28% 0 0);
  --muted: oklch(32% 0 0);
}
```

### Typography Scale

The application uses a consistent type scale based on Tailwind's defaults:

| Level | Class | Size | Weight | Usage |
| --- | --- | --- | --- | --- |
| Display | `text-2xl` | 24px | 600 | Dialog titles |
| Title | `text-xl` | 20px | 600 | Section headings |
| Subtitle | `text-lg` | 18px | 500 | Card titles |
| Body | `text-base` | 16px | 400 | Primary content |
| Small | `text-sm` | 14px | 400 | Secondary content |
| Caption | `text-xs` | 12px | 400 | Labels, timestamps |

#### Font Families

```css
:root {
  /* UI elements */
  --font-ui: "SF Pro Display", "SF Pro Text", system-ui, sans-serif;

  /* Editor content */
  --font-editor: "Source Serif 4", "Charter", "Georgia", serif;

  /* Code blocks */
  --font-mono: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
}
```

### Spacing System

All spacing follows Tailwind's 4px base unit:

| Token | Value | Usage |
| --- | --- | --- |
| `space-1` | 4px | Tight inline spacing |
| `space-2` | 8px | Icon-to-text gaps |
| `space-3` | 12px | Small component padding |
| `space-4` | 16px | Standard component padding |
| `space-6` | 24px | Section separation |
| `space-8` | 32px | Major section gaps |
| `space-12` | 48px | Page-level spacing |

### Component Patterns

#### Buttons

```typescript
// Primary button
<Button variant="default" size="sm">Save</Button>

// Secondary button
<Button variant="secondary" size="sm">Cancel</Button>

// Destructive button
<Button variant="destructive" size="sm">Delete</Button>

// Ghost button (icon-only)
<Button variant="ghost" size="icon">
  <Settings className="h-4 w-4" />
</Button>
```

#### Dialogs

```typescript
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle>Dialog Title</DialogTitle>
      <DialogDescription>
        A brief description of what this dialog does.
      </DialogDescription>
    </DialogHeader>
    <div className="py-4">
      {/* Content */}
    </div>
    <DialogFooter>
      <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
      <Button onClick={handleSubmit}>Confirm</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

#### Tooltips

```typescript
<TooltipProvider delayDuration={300}>
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="ghost" size="icon">
        <HelpCircle className="h-4 w-4" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>
      <p>Helpful explanation text</p>
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```

### Animation Guidelines

All interactive elements include smooth transitions:

```css
/* Default transition for interactive elements */
.interactive {
  transition: background-color 150ms ease-in-out,
              color 150ms ease-in-out,
              border-color 150ms ease-in-out;
}

/* Sidebar folder expand */
.folder-chevron {
  transition: transform 150ms ease-in-out;
}

/* Theme switching */
* {
  transition: background-color 200ms ease-in-out,
              color 200ms ease-in-out;
}

/* Ghost text appearance */
.ghost-text {
  opacity: 0.4;
  font-style: italic;
  transition: opacity 100ms ease-in;
}
```

Tagged as #design-system #colors #typography #components. Reviewed by @elena.

---

## Appendix B: Voice and Transcription Reference

### Whisper Model Comparison

| Model | Parameters | Size | Speed | Accuracy | Recommended |
| --- | --- | --- | --- | --- | --- |
| Tiny | 39M | 39MB | 10x | Fair | Quick dictation |
| Base | 74M | 74MB | 7x | Good | Default |
| Small | 244M | 244MB | 4x | Very Good | High quality |
| Medium | 769M | 769MB | 2x | Excellent | Production |
| Large v3 | 1550M | 1550MB | 1x | Best | Research |

### Audio Processing Pipeline

```rust
// Recording flow
// 1. Start audio capture (cpal stream, native sample rate)
// 2. Accumulate samples in ring buffer
// 3. On stop: resample to 16kHz mono
// 4. Feed to Whisper model for transcription

fn resample_audio(
    samples: &[f32],
    source_rate: u32,
    target_rate: u32,
    channels: u16,
) -> Vec<f32> {
    // Mix to mono if stereo
    let mono = if channels > 1 {
        samples.chunks(channels as usize)
            .map(|chunk| chunk.iter().sum::<f32>() / channels as f32)
            .collect()
    } else {
        samples.to_vec()
    };

    // Resample using linear interpolation
    let ratio = target_rate as f64 / source_rate as f64;
    let output_len = (mono.len() as f64 * ratio) as usize;
    let mut output = Vec::with_capacity(output_len);

    for i in 0..output_len {
        let src_pos = i as f64 / ratio;
        let src_idx = src_pos as usize;
        let frac = src_pos - src_idx as f64;

        let sample = if src_idx + 1 < mono.len() {
            mono[src_idx] * (1.0 - frac as f32) + mono[src_idx + 1] * frac as f32
        } else {
            mono[src_idx.min(mono.len() - 1)]
        };

        output.push(sample);
    }

    output
}
```

### Dictation Flow

The live dictation system processes audio in chunks with silence detection:

```typescript
// Frontend dictation hook
function useDictation(editor: Editor | null) {
  const [isDictating, setIsDictating] = useState(false);

  const startDictation = useCallback(async () => {
    if (!editor) return;

    setIsDictating(true);

    const unlisten = await listen<DictationResult>('dictation-result', (event) => {
      const { text, is_final, error } = event.payload;

      if (error) {
        toast.error(`Dictation error: ${error}`);
        setIsDictating(false);
        return;
      }

      if (text && text.trim()) {
        // Insert transcribed text at cursor
        editor.commands.insertContent(text);
      }

      if (is_final) {
        setIsDictating(false);
        unlisten();
      }
    });

    await invoke('start_dictation', { language: speechLanguage });
  }, [editor]);

  const stopDictation = useCallback(async () => {
    await invoke('stop_dictation');
    setIsDictating(false);
  }, []);

  return { isDictating, startDictation, stopDictation };
}
```

### Hallucination Filtering

Whisper models sometimes produce hallucinated output for silent or near-silent audio segments. The transcription system filters these:

```rust
const HALLUCINATION_PATTERNS: &[&str] = &[
    "Thank you for watching",
    "Thanks for watching",
    "Subscribe to my channel",
    "Please subscribe",
    "Like and subscribe",
    "Thank you so much",
    "Thank you very much",
    "Bye bye",
    "See you next time",
    "music playing",
    "[Music]",
    "(music)",
    "...",
];

fn is_hallucination(text: &str) -> bool {
    let normalized = text.trim().to_lowercase();
    HALLUCINATION_PATTERNS.iter().any(|pattern| {
        normalized.contains(&pattern.to_lowercase())
    })
}
```

Tagged as #voice #transcription #whisper #dictation. Maintained by @peter.

---

## Appendix C: Document Index Architecture

### SQLite Schema

The document index maintains a structured representation of all markdown content:

```sql
-- Core documents table
CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    hash TEXT NOT NULL,
    title TEXT,
    word_count INTEGER DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tags extracted from AST
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    line INTEGER NOT NULL,
    column_start INTEGER DEFAULT 0,
    UNIQUE(document_id, tag, line)
);

-- Mentions extracted from AST
CREATE TABLE mentions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    mention TEXT NOT NULL,
    line INTEGER NOT NULL,
    column_start INTEGER DEFAULT 0,
    UNIQUE(document_id, mention, line)
);

-- Headings for document outline
CREATE TABLE headings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    level INTEGER NOT NULL,
    text TEXT NOT NULL,
    line INTEGER NOT NULL
);

-- Tasks with completion status
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    checked BOOLEAN NOT NULL DEFAULT 0,
    line INTEGER NOT NULL
);

-- Goals from frontmatter
CREATE TABLE goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    template TEXT
);

-- Full-text search index
CREATE VIRTUAL TABLE fts_content USING fts5(
    path,
    title,
    content,
    tokenize='porter unicode61'
);

-- Indexes for performance
CREATE INDEX idx_tags_tag ON tags(tag);
CREATE INDEX idx_tags_doc ON tags(document_id);
CREATE INDEX idx_mentions_mention ON mentions(mention);
CREATE INDEX idx_mentions_doc ON mentions(document_id);
CREATE INDEX idx_headings_doc ON headings(document_id);
CREATE INDEX idx_tasks_doc ON tasks(document_id);
CREATE INDEX idx_tasks_checked ON tasks(checked);
CREATE INDEX idx_documents_hash ON documents(hash);
```

### AST Parsing with comrak

The indexing pipeline uses the comrak Rust crate to parse markdown into an AST, avoiding false positives from regex-based approaches:

```rust
use comrak::{parse_document, Arena, Options};
use comrak::nodes::NodeValue;

pub fn extract_tags(content: &str) -> Vec<TagEntry> {
    let arena = Arena::new();
    let options = Options::default();
    let root = parse_document(&arena, content, &options);

    let mut tags = Vec::new();
    let mut in_code = false;

    for node in root.descendants() {
        match &node.data.borrow().value {
            NodeValue::CodeBlock(_) | NodeValue::Code(_) => {
                in_code = true;
            }
            NodeValue::Text(text) => {
                if !in_code {
                    extract_tags_from_text(text, &node.data.borrow().sourcepos, &mut tags);
                }
            }
            _ => {
                in_code = false;
            }
        }
    }

    tags
}

fn extract_tags_from_text(text: &str, pos: &Sourcepos, tags: &mut Vec<TagEntry>) {
    let tag_regex = Regex::new(r"#([a-zA-Z][a-zA-Z0-9_-]*)").unwrap();
    for cap in tag_regex.captures_iter(text) {
        tags.push(TagEntry {
            name: cap[1].to_string(),
            line: pos.start.line,
        });
    }
}
```

### Incremental Updates

The index updates incrementally based on content hash comparison:

```rust
pub async fn index_file(db: &Connection, path: &str, content: &str) -> Result<(), String> {
    let hash = compute_sha256(content);

    // Check if content has changed
    let existing_hash: Option<String> = db.query_row(
        "SELECT hash FROM documents WHERE path = ?",
        [path],
        |row| row.get(0),
    ).optional().map_err(|e| e.to_string())?;

    if existing_hash.as_deref() == Some(&hash) {
        return Ok(()); // Content unchanged, skip reindex
    }

    // Parse and extract all structured data
    let tags = extract_tags(content);
    let mentions = extract_mentions(content);
    let headings = extract_headings(content);
    let tasks = extract_tasks(content);
    let title = extract_title(content);
    let word_count = count_words(content);

    // Update within a transaction
    let tx = db.transaction().map_err(|e| e.to_string())?;

    // Upsert document
    tx.execute(
        "INSERT INTO documents (path, hash, title, word_count, updated_at) \
         VALUES (?, ?, ?, ?, datetime('now')) \
         ON CONFLICT(path) DO UPDATE SET hash=?, title=?, word_count=?, updated_at=datetime('now')",
        rusqlite::params![path, hash, title, word_count, hash, title, word_count],
    ).map_err(|e| e.to_string())?;

    let doc_id: i64 = tx.query_row(
        "SELECT id FROM documents WHERE path = ?",
        [path],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    // Clear existing entries
    tx.execute("DELETE FROM tags WHERE document_id = ?", [doc_id]).ok();
    tx.execute("DELETE FROM mentions WHERE document_id = ?", [doc_id]).ok();
    tx.execute("DELETE FROM headings WHERE document_id = ?", [doc_id]).ok();
    tx.execute("DELETE FROM tasks WHERE document_id = ?", [doc_id]).ok();

    // Insert new entries
    for tag in &tags {
        tx.execute(
            "INSERT INTO tags (document_id, tag, line) VALUES (?, ?, ?)",
            rusqlite::params![doc_id, tag.name, tag.line],
        ).ok();
    }

    for mention in &mentions {
        tx.execute(
            "INSERT INTO mentions (document_id, mention, line) VALUES (?, ?, ?)",
            rusqlite::params![doc_id, mention.name, mention.line],
        ).ok();
    }

    // Update FTS index
    tx.execute("DELETE FROM fts_content WHERE path = ?", [path]).ok();
    tx.execute(
        "INSERT INTO fts_content (path, title, content) VALUES (?, ?, ?)",
        rusqlite::params![path, title, content],
    ).ok();

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
```

### Query Patterns

Common search operations against the index:

```sql
-- Search tags with occurrence count
SELECT tag, COUNT(DISTINCT document_id) as file_count
FROM tags
WHERE tag LIKE ?1 || '%'
GROUP BY tag
ORDER BY file_count DESC, tag ASC
LIMIT 20;

-- Full-text content search
SELECT
    d.path,
    d.title,
    snippet(fts_content, 2, '<b>', '</b>', '...', 48) as snippet,
    rank
FROM fts_content
JOIN documents d ON d.path = fts_content.path
WHERE fts_content MATCH ?
ORDER BY rank
LIMIT 30;

-- Pending tasks across workspace
SELECT
    d.path,
    d.title,
    t.text,
    t.line
FROM tasks t
JOIN documents d ON t.document_id = d.id
WHERE t.checked = 0
ORDER BY d.updated_at DESC, t.line ASC;

-- Document outline (headings)
SELECT level, text, line
FROM headings
WHERE document_id = (SELECT id FROM documents WHERE path = ?)
ORDER BY line ASC;

-- Cross-reference: files mentioning a specific person
SELECT DISTINCT d.path, d.title, m.line
FROM mentions m
JOIN documents d ON m.document_id = d.id
WHERE m.mention = ?
ORDER BY d.path, m.line;
```

> The SQLite index replaces the previous approach of regex-scanning the filesystem on every search. This change improved search latency from 500ms+ (scanning 1000 files) to under 10ms (SQL query). The tradeoff is maintaining index consistency, which the incremental update pipeline handles reliably.

Tagged as #index #sqlite #search #fts5. Maintained by @peter.

---

## Appendix D: Git Integration Reference

### Backend Commands

The git integration provides native git operations through Rust commands:

```rust
// Get repository status
#[tauri::command]
async fn git_status(path: String) -> Result<GitStatus, String> {
    let repo = Repository::discover(&path)
        .map_err(|e| format!("Not a git repository: {}", e))?;

    let mut status_entries = Vec::new();

    let statuses = repo.statuses(Some(
        StatusOptions::new()
            .include_untracked(true)
            .recurse_untracked_dirs(true)
    )).map_err(|e| e.to_string())?;

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let status = match entry.status() {
            s if s.is_wt_modified() => "modified",
            s if s.is_index_new() => "staged",
            s if s.is_wt_new() => "untracked",
            s if s.is_wt_deleted() => "deleted",
            s if s.is_wt_renamed() => "renamed",
            s if s.is_conflicted() => "conflicted",
            _ => "unknown",
        };
        status_entries.push(GitFileStatus { path, status: status.to_string() });
    }

    let head = repo.head().ok();
    let branch = head.as_ref()
        .and_then(|h| h.shorthand())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "HEAD".to_string());

    Ok(GitStatus {
        branch,
        files: status_entries,
        is_clean: status_entries.is_empty(),
    })
}

// List branches
#[tauri::command]
async fn git_branches(path: String) -> Result<Vec<GitBranch>, String> {
    let repo = Repository::discover(&path)
        .map_err(|e| e.to_string())?;

    let mut branches = Vec::new();
    for (branch, branch_type) in repo.branches(None).map_err(|e| e.to_string())? {
        let branch = branch.map_err(|e| e.to_string())?;
        let name = branch.0.name()
            .map_err(|e| e.to_string())?
            .unwrap_or("(unnamed)")
            .to_string();

        let is_head = branch.0.is_head();
        let is_remote = matches!(branch_type, BranchType::Remote);

        branches.push(GitBranch { name, is_head, is_remote });
    }

    Ok(branches)
}

// Create commit
#[tauri::command]
async fn git_commit(
    path: String,
    files: Vec<String>,
    message: String,
) -> Result<String, String> {
    let repo = Repository::discover(&path)
        .map_err(|e| e.to_string())?;

    let mut index = repo.index().map_err(|e| e.to_string())?;

    for file in &files {
        index.add_path(Path::new(file))
            .map_err(|e| format!("Failed to stage {}: {}", file, e))?;
    }

    index.write().map_err(|e| e.to_string())?;
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

    let sig = repo.signature().map_err(|e| e.to_string())?;
    let parent = repo.head().ok()
        .and_then(|h| h.peel_to_commit().ok());

    let parents: Vec<&Commit> = parent.as_ref().map(|p| vec![p]).unwrap_or_default();

    let oid = repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &message,
        &tree,
        &parents,
    ).map_err(|e| e.to_string())?;

    Ok(oid.to_string())
}
```

### Frontend Integration

The sidebar displays git status indicators on files:

```typescript
function GitStatusBadge({ status }: { status: string }) {
  const { icon, className, label } = useMemo(() => {
    switch (status) {
      case 'modified':
        return { icon: 'M', className: 'text-amber-600', label: 'Modified' };
      case 'staged':
        return { icon: 'S', className: 'text-green-600', label: 'Staged' };
      case 'untracked':
        return { icon: 'U', className: 'text-muted-foreground', label: 'Untracked' };
      case 'deleted':
        return { icon: 'D', className: 'text-red-600', label: 'Deleted' };
      case 'renamed':
        return { icon: 'R', className: 'text-blue-600', label: 'Renamed' };
      case 'conflicted':
        return { icon: '!', className: 'text-red-600 font-bold', label: 'Conflict' };
      default:
        return { icon: '?', className: 'text-muted-foreground', label: 'Unknown' };
    }
  }, [status]);

  return (
    <span className={cn('text-xs font-mono ml-auto', className)} title={label}>
      {icon}
    </span>
  );
}
```

### Commit Dialog

```typescript
function CommitDialog({ open, onOpenChange }: CommitDialogProps) {
  const [message, setMessage] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const { files, branch } = useGitStore();

  const handleCommit = async () => {
    if (!message.trim() || selectedFiles.size === 0) return;

    try {
      const commitHash = await invoke<string>('git_commit', {
        path: projectPath,
        files: Array.from(selectedFiles),
        message: message.trim(),
      });

      toast.success(`Committed ${commitHash.substring(0, 7)}`);
      onOpenChange(false);
      setMessage('');
      setSelectedFiles(new Set());

      // Refresh git status
      await refreshGitStatus();
    } catch (error) {
      toast.error(`Commit failed: ${error}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Commit Changes</DialogTitle>
          <DialogDescription>
            Branch: <code className="text-xs">{branch}</code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2 max-h-48 overflow-auto">
            {files.map(file => (
              <label key={file.path} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selectedFiles.has(file.path)}
                  onCheckedChange={(checked) => {
                    const next = new Set(selectedFiles);
                    checked ? next.add(file.path) : next.delete(file.path);
                    setSelectedFiles(next);
                  }}
                />
                <GitStatusBadge status={file.status} />
                <span className="truncate">{file.path}</span>
              </label>
            ))}
          </div>

          <Textarea
            placeholder="Commit message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCommit} disabled={!message.trim() || selectedFiles.size === 0}>
            Commit {selectedFiles.size} file{selectedFiles.size !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### Branch Diff Review

Compare the current branch against another branch with inline decorations:

```typescript
function useBranchDiff(baseBranch: string | null) {
  const [hunks, setHunks] = useState<DiffHunk[]>([]);

  useEffect(() => {
    if (!baseBranch) return;

    async function loadDiff() {
      const result = await invoke<BranchDiffResult>('git_diff_branch', {
        path: projectPath,
        baseBranch,
      });

      const parsed = parseDiffOutput(result.diff);
      setHunks(parsed);
    }

    loadDiff();
  }, [baseBranch]);

  const acceptAll = useCallback(() => {
    setHunks(hunks.map(h => ({ ...h, status: 'accepted' })));
  }, [hunks]);

  const rejectAll = useCallback(() => {
    setHunks(hunks.map(h => ({ ...h, status: 'rejected' })));
  }, [hunks]);

  return { hunks, acceptAll, rejectAll };
}
```

Tagged as #git #integration #commits #branches. Reviewed by @david.

---

## Appendix E: PDF Export Engine Reference

### Typst Integration

The PDF export engine uses Typst 0.14 as an embedded compiler:

```rust
use typst::Library;
use typst::World;

struct NotesageWorld {
    library: Library,
    main_source: Source,
    fonts: Vec<Font>,
}

impl World for NotesageWorld {
    fn library(&self) -> &Library {
        &self.library
    }

    fn main(&self) -> Source {
        self.main_source.clone()
    }

    fn source(&self, id: SourceId) -> Source {
        self.main_source.clone()
    }

    fn font(&self, id: usize) -> Option<Font> {
        self.fonts.get(id).cloned()
    }

    fn book(&self) -> &FontBook {
        // Font book for font resolution
        &self.font_book
    }
}
```

### Markdown to Typst Conversion

The converter maps markdown AST nodes to Typst markup:

| Markdown | Typst | Notes |
| --- | --- | --- |
| `# Heading` | `= Heading` | Level mapped by = count |
| `**bold**` | `*bold*` | Asterisks swapped |
| `*italic*` | `_italic_` | Underscores |
| `` `code` `` | `` `code` `` | Same syntax |
| `> quote` | `#quote[...]` | Block function |
| `- item` | `- item` | Same syntax |
| `1. item` | `+ item` | Different numbering |
| `[link](url)` | `#link("url")[text]` | Function syntax |
| `![alt](src)` | `#image("src")` | Function syntax |
| `---` | `#line(length: 100%)` | Horizontal rule |

```rust
fn convert_node(node: &AstNode) -> String {
    match &node.data.borrow().value {
        NodeValue::Heading(heading) => {
            let level = "=".repeat(heading.level as usize);
            let text = render_children(node);
            format!("{} {}\n", level, text)
        }
        NodeValue::Paragraph => {
            let text = render_children(node);
            format!("{}\n\n", text)
        }
        NodeValue::Strong => {
            let text = render_children(node);
            format!("*{}*", text)
        }
        NodeValue::Emph => {
            let text = render_children(node);
            format!("_{}_", text)
        }
        NodeValue::Code(code) => {
            format!("`{}`", code.literal)
        }
        NodeValue::CodeBlock(block) => {
            let lang = if block.info.is_empty() { "" } else { &block.info };
            format!("```{}\n{}```\n\n", lang, block.literal)
        }
        NodeValue::BlockQuote => {
            let text = render_children(node);
            format!("#quote[{}]\n\n", text)
        }
        NodeValue::Link(link) => {
            let text = render_children(node);
            format!("#link(\"{}\")[{}]", link.url, text)
        }
        NodeValue::Table(_) => {
            render_table(node)
        }
        _ => render_children(node),
    }
}
```

### Template System

Three template presets are available, each defined as a `.typ` file:

```typst
// clean.typ — Minimal, modern layout
#set page(
  paper: "PAPER_SIZE",
  margin: (top: 2cm, bottom: 2cm, left: 2.5cm, right: 2.5cm),
)

#set text(
  font: "Inter",
  size: 11pt,
  lang: "en",
)

#set heading(numbering: none)

#set par(
  justify: false,
  leading: 0.8em,
  first-line-indent: 0pt,
)

CONTENT
```

```typst
// academic.typ — Scholarly layout with numbered headings
#set page(
  paper: "PAPER_SIZE",
  margin: (top: 2.5cm, bottom: 2.5cm, left: 3cm, right: 3cm),
  header: [
    #set text(size: 9pt, fill: gray)
    TITLE
    #h(1fr)
    #counter(page).display()
  ],
)

#set text(
  font: "Source Serif 4",
  size: 12pt,
  lang: "en",
)

#set heading(numbering: "1.1")

#set par(
  justify: true,
  leading: 0.9em,
  first-line-indent: 1.5em,
)

CONTENT
```

```typst
// report.typ — Professional report with title page
#set page(
  paper: "PAPER_SIZE",
  margin: (top: 2.5cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm),
)

// Title page
#align(center + horizon)[
  #text(size: 28pt, weight: "bold")[TITLE]
  #v(1cm)
  #text(size: 14pt, fill: gray)[#datetime.today().display()]
]

#pagebreak()

// Table of contents
TOC_PLACEHOLDER

#pagebreak()

// Main content
CONTENT
```

### Bundled Fonts

Three font families are bundled with the application, all under the SIL Open Font License:

| Font | Style | Files | Size |
| --- | --- | --- | --- |
| Inter | Sans-serif | Regular, Medium, SemiBold, Bold, Italic | 1.2MB |
| Source Serif 4 | Serif | Regular, Medium, SemiBold, Bold, Italic | 1.0MB |
| JetBrains Mono | Monospace | Regular, Bold | 0.5MB |

Tagged as #export #pdf #typst #fonts. Maintained by @peter.

---

## Appendix F: Research System Reference

### Research File Format

Research files use standard markdown with structured YAML frontmatter:

```yaml
---
source_url: "https://example.com/article"
title: "The Future of Desktop Applications"
author: "Jane Smith"
date_saved: "2026-03-15"
tags:
  - desktop
  - technology
  - architecture
word_count: 2450
---

# The Future of Desktop Applications

Research content here...
```

### Skill Definitions

The research workflow is powered by five interconnected skills:

```yaml
# download-webpage/SKILL.md
---
name: download-webpage
description: Fetch a URL and convert the page content to clean markdown
parameters:
  - name: url
    type: string
    required: true
  - name: include_images
    type: boolean
    default: false
---
```

```yaml
# save-research/SKILL.md
---
name: save-research
description: Save research content with metadata and tags
parameters:
  - name: content
    type: string
    required: true
  - name: title
    type: string
    required: true
  - name: source_url
    type: string
  - name: tags
    type: array
    items:
      type: string
---
```

```yaml
# synthesize-sources/SKILL.md
---
name: synthesize-sources
description: Read multiple research sources and generate a cross-source synthesis
parameters:
  - name: source_paths
    type: array
    items:
      type: string
    required: true
  - name: focus_topic
    type: string
---
```

### Search Implementation

Research search uses the Rust backend for fast filesystem scanning with frontmatter parsing:

```rust
pub async fn search_research(
    dirs: Vec<String>,
    query: Option<String>,
    tag: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ResearchSearchResult>, String> {
    let limit = limit.unwrap_or(50);
    let mut results = Vec::new();

    for dir in &dirs {
        let dir_path = Path::new(dir);
        if !dir_path.is_dir() { continue; }

        for entry in WalkDir::new(dir_path).max_depth(2) {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.path().extension().map_or(false, |ext| ext == "md") {
                continue;
            }

            let content = tokio::fs::read_to_string(entry.path())
                .await
                .map_err(|e| e.to_string())?;

            let (frontmatter, body) = parse_frontmatter(&content);

            let mut relevance = 0.0;
            let mut matched = false;

            if let Some(ref q) = query {
                let q_lower = q.to_lowercase();
                if frontmatter.title.to_lowercase().contains(&q_lower) {
                    relevance += 1.0;
                    matched = true;
                }
                if frontmatter.tags.iter().any(|t| t.to_lowercase().contains(&q_lower)) {
                    relevance += 0.8;
                    matched = true;
                }
                if frontmatter.source_url.to_lowercase().contains(&q_lower) {
                    relevance += 0.6;
                    matched = true;
                }
                if body.to_lowercase().contains(&q_lower) {
                    relevance += 0.5;
                    matched = true;
                }
            }

            if let Some(ref t) = tag {
                if frontmatter.tags.iter().any(|ft| ft.eq_ignore_ascii_case(t)) {
                    relevance += 0.8;
                    matched = true;
                }
            }

            if query.is_none() && tag.is_none() {
                matched = true;
            }

            if matched {
                let snippet = body.chars().take(200).collect::<String>();
                results.push(ResearchSearchResult {
                    file: entry.path().to_string_lossy().to_string(),
                    title: frontmatter.title,
                    tags: frontmatter.tags,
                    source_url: frontmatter.source_url,
                    snippet,
                    relevance,
                    date_saved: frontmatter.date_saved,
                    word_count: frontmatter.word_count,
                });
            }
        }
    }

    results.sort_by(|a, b| b.relevance.partial_cmp(&a.relevance).unwrap());
    results.truncate(limit);

    Ok(results)
}
```

### Citation Formats

Three citation formats are supported for inserting research references:

```typescript
type CitationFormat = 'inline' | 'footnote' | 'academic';

function formatCitation(research: ResearchResult, format: CitationFormat): string {
  switch (format) {
    case 'inline':
      return `[${research.title}](${research.source_url})`;
    case 'footnote':
      return `${research.title}[^1]\n\n[^1]: ${research.source_url}`;
    case 'academic':
      return `(${research.author}, ${research.year}). *${research.title}*. Retrieved from ${research.source_url}`;
  }
}
```

> The research system is designed to be a natural extension of the writing workflow. Capture sources, organize with tags, search across projects, and cite directly in documents — all without leaving the editor.

Tagged as #research #skills #citations #search. Maintained by @peter and @marcus.

---

*End of document. Total sections: 17 chapters + 6 appendices. This fixture file is used for performance benchmarking of markdown parsing, serialization, and editor rendering at the 100KB document size tier.*
