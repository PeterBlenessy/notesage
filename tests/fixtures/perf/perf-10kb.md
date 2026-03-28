# Building a Modern Desktop Editor

This document covers the architecture decisions behind building a **rich text markdown editor** with *AI collaboration* features, packaged as a lightweight desktop application.

## Table of Contents

1. Architecture Overview
2. Editor Engine
3. State Management
4. AI Integration
5. Performance Considerations
6. Testing Strategy

---

## Architecture Overview

The application follows a layered architecture with clear separation between the **desktop shell**, the **frontend UI**, and the **backend services**. Each layer communicates through well-defined interfaces using `IPC` commands.

### Core Principles

- **Single source of truth**: The editor state lives in ProseMirror, not in a separate store
- **Security boundary**: All filesystem access goes through Tauri commands
- **Offline first**: The app works without network connectivity
- **Privacy by default**: Data stays on the user's device

> The best architecture is the one that gets out of the way. We chose simplicity over cleverness at every decision point, and it paid dividends in maintainability.

### Technology Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Shell | Tauri v2 | Native desktop wrapper |
| Frontend | React 19 | UI framework |
| Editor | Tiptap v2 | Rich text editing |
| Components | shadcn/ui | Pre-built UI elements |
| State | Zustand | Client state management |
| Styling | Tailwind v4 | Utility-first CSS |

Reviewed by @marcus and @elena during the #architecture sprint.

---

## Editor Engine

The editor is built on **Tiptap v2**, which wraps ProseMirror with a composable extension system. This gives us access to ProseMirror's powerful decoration system while maintaining a developer-friendly API.

### Extension Model

Each Tiptap extension can define:

1. Schema nodes and marks for the document model
2. ProseMirror plugins for state and decorations
3. Commands for imperative operations
4. Input rules for auto-formatting

```typescript
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DecorationSet, Decoration } from '@tiptap/pm/view';

const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addProseMirrorPlugins() {
    const pluginKey = new PluginKey('searchHighlight');

    return [
      new Plugin({
        key: pluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, decorations) => {
            const query = tr.getMeta(pluginKey);
            if (query === undefined) return decorations.map(tr.mapping, tr.doc);
            if (!query) return DecorationSet.empty;
            return buildDecorations(tr.doc, query);
          },
        },
        props: {
          decorations(state) {
            return pluginKey.getState(state);
          },
        },
      }),
    ];
  },
});
```

### Markdown Round-Tripping

The editor must preserve markdown fidelity through parse and serialize cycles:

- Open `.md` file and parse to ProseMirror document
- Edit in rich text mode with full formatting support
- Serialize back to clean, valid markdown on save
- **Round-trip test**: parse, serialize, compare must be identical

> Lossless round-tripping is non-negotiable. If the markdown changes on open-and-save without edits, trust is broken.

### Supported Content Types

- [x] Headings H1 through H6
- [x] Bold, italic, underline, strikethrough
- [x] Inline `code` formatting
- [x] Bullet lists and ordered lists
- [x] Task lists with checkboxes
- [x] Blockquotes with nested content
- [x] Code blocks with syntax highlighting
- [x] Tables with headers
- [x] Links and images
- [ ] Mermaid diagrams (planned)
- [ ] Math equations (planned)

Tagged as #editor #prosemirror #markdown for tracking.

---

## State Management

All application state is managed through **Zustand stores** with the persist middleware for localStorage. Each store has a clear boundary and responsibility.

### Store Architecture

```javascript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useEditorStore = create(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabIndex: 0,
      openTab: (filePath) => {
        const existing = get().tabs.findIndex(t => t.path === filePath);
        if (existing >= 0) {
          set({ activeTabIndex: existing });
          return;
        }
        set(state => ({
          tabs: [...state.tabs, { path: filePath, dirty: false }],
          activeTabIndex: state.tabs.length,
        }));
      },
      closeTab: (index) => {
        set(state => {
          const newTabs = state.tabs.filter((_, i) => i !== index);
          const newActive = Math.min(state.activeTabIndex, newTabs.length - 1);
          return { tabs: newTabs, activeTabIndex: Math.max(0, newActive) };
        });
      },
    }),
    { name: 'editor-store' }
  )
);
```

### Critical Stores

| Store | Purpose | Persisted |
| --- | --- | --- |
| editor-store | Open tabs, active tab | Yes |
| workspace-store | Explorer folders, projects | Yes |
| ai-store | Provider configuration | Yes |
| connections-store | Multi-provider connections | Yes |
| chat-store | Conversation messages | Yes |
| comment-store | Comments and delegation | JSON sidecar |
| external-change-store | Pending file changes | No |

Discussed with @david during #state-management review.

---

## AI Integration

The application supports multiple AI providers through a unified abstraction layer. This enables users to choose their preferred provider without changing their workflow.

### Provider Abstraction

```python
# Conceptual model (shown in Python for clarity)
class AIProvider:
    def generate(self, prompt: str, options: dict) -> str:
        """Generate text from a prompt."""
        pass

    def chat(self, messages: list[dict]) -> str:
        """Multi-turn conversation."""
        pass

    def stream(self, messages: list[dict]) -> Iterator[str]:
        """Streaming chat with token-by-token output."""
        pass
```

### Supported Providers

1. **Anthropic** — Claude models via Messages API
2. **OpenAI** — GPT models via Responses API
3. **Ollama** — Local models, no API key required
4. **Local AI** — Bundled llama-server for offline use

### Comment Delegation

Any inline comment can be delegated to an AI agent:

- User creates comment on selected text
- Clicks "Delegate" to send to AI
- Agent processes the request and replies in the comment thread
- User can accept the suggestion with `Cmd+Enter`

> AI assistance should feel like a thoughtful collaborator, not a replacement. The human always has final say.

---

## Performance Considerations

Performance is critical for an editor application. Users expect instant response to keystrokes and smooth scrolling through large documents.

### Benchmarks

| Operation | Target | Measured |
| --- | --- | --- |
| Keystroke latency | < 16ms | 8ms |
| File open (1KB) | < 50ms | 32ms |
| File open (100KB) | < 200ms | 145ms |
| Save to disk | < 100ms | 67ms |
| Theme switch | < 100ms | 45ms |
| Tab switch | < 50ms | 28ms |

### Optimization Techniques

- **Debounced auto-save**: 1 second delay prevents excessive disk writes
- **Virtual scrolling**: Large documents only render visible content
- **Web Workers**: Heavy computations offloaded from the main thread
- **Lazy loading**: Components loaded on demand, not at startup

```javascript
// Debounced save implementation
function useDebouncedSave(content, path, delay = 1000) {
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(async () => {
      await invoke('mark_self_write', { path });
      await invoke('write_file', { path, content });
    }, delay);

    return () => clearTimeout(timeoutRef.current);
  }, [content, path, delay]);
}
```

Tagged as #performance #optimization for the benchmark suite.

---

## Testing Strategy

The project maintains comprehensive test coverage across unit tests, integration tests, and end-to-end tests.

### Test Commands

- `pnpm test` — Vitest unit tests with watch mode
- `pnpm test:coverage` — Coverage report with Istanbul
- `pnpm test:e2e` — Playwright browser tests
- `cd src-tauri && cargo test` — Rust backend tests

### Coverage Targets

- [x] Stores: 84% line coverage
- [x] Hooks: 86% line coverage
- [x] Markdown conversion: 89% line coverage
- [ ] Components: 60% target (currently 55%)

> Tests are not optional. Every PR must maintain or improve coverage. Regressions are caught by CI.

See the full testing guide at [docs/architecture.md](../../docs/architecture.md). Maintained by @testing-team with #quality #testing tags.

---

*Last updated by @peter on 2026-03-28.*

---

## Appendix: Deployment Workflow

The deployment pipeline runs through several stages before a release is published.

### Build Steps

1. Run the full test suite with `pnpm test:all`
2. Generate a **production build** using `pnpm tauri build`
3. Sign the macOS bundle with the Apple Developer certificate
4. Submit for notarization via `xcrun notarytool`
5. Upload the DMG to the distribution server

### Environment Configuration

| Variable | Purpose | Required |
| --- | --- | --- |
| `TAURI_SIGNING_KEY` | Update signing key | Yes |
| `APPLE_CERT_ID` | Code signing identity | Yes |
| `NOTARY_TEAM_ID` | Apple Team ID | Yes |
| `VITE_APP_VERSION` | Frontend version | Auto |

```bash
# Build and sign for production
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.keys/tauri.key)"
pnpm tauri build --target universal-apple-darwin

# Notarize
xcrun notarytool submit target/release/bundle/dmg/Notesage.dmg \
  --apple-id "$APPLE_ID" \
  --team-id "$TEAM_ID" \
  --password "$APP_PASSWORD" \
  --wait
```

### Post-Release Verification

- [x] Download and install from clean machine
- [x] Verify code signature: `codesign --verify --deep`
- [ ] Run smoke tests on Intel and Apple Silicon
- [ ] Confirm auto-update mechanism works

> Every release should feel like the first impression. If the install experience is rough, nothing else matters. Tagged as #deployment #release by @ops-team.
