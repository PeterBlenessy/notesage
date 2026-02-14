# Notesage

A WYSIWYG markdown editor with AI collaboration capabilities, built with Tauri v2.

## Features

### Phase 1: The Editor ✅
- Full-featured Tiptap WYSIWYG editor
- Markdown round-tripping (open .md files, edit in WYSIWYG, save as clean markdown)
- Multi-tab editing
- File tree sidebar with folder navigation
- Slash commands for quick formatting
- Floating toolbar on text selection
- Light/dark theme support

### Phase 2: AI Collaboration ✅
- **Multi-Provider Support**: Anthropic Claude, OpenAI, and Ollama (local)
- **AI Chat Panel**: Right sidebar with conversation history (Cmd+Shift+A)
- **Inline AI Actions**: Improve, summarize, or expand selected text via bubble menu
- **Settings UI**: Configure API keys and provider preferences (Cmd+,)
- **Persistent History**: Chat conversations saved across sessions

## Getting Started

### Prerequisites
- Rust (latest stable)
- Node.js 20+
- pnpm

### Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev

# Build for production
pnpm tauri build
```

## Keyboard Shortcuts

### General
- `Cmd+O` - Open file
- `Cmd+S` - Save file
- `Cmd+N` - New file
- `Cmd+W` - Close tab
- `Cmd+P` - Quick open (fuzzy file search)
- `Cmd+,` - Settings
- `Cmd+Shift+T` - Toggle theme
- `Cmd+Shift+A` - Toggle AI chat panel

### Editor Formatting
- `Cmd+B` - Bold
- `Cmd+I` - Italic
- `Cmd+U` - Underline
- `Cmd+Shift+X` - Strikethrough
- `Cmd+E` - Code
- `Cmd+K` - Insert link
- `Cmd+Z` - Undo
- `Cmd+Shift+Z` - Redo

### AI Features
- `Cmd+Enter` (in chat) - Send message
- Select text + click "Improve/Summarize/Expand" in bubble menu

## AI Provider Setup

### Anthropic Claude
1. Open Settings (Cmd+,)
2. Go to "AI Providers" tab
3. Select "Anthropic Claude"
4. Enter your API key (starts with `sk-ant-`)
5. Click "Save" and "Test Connection"

### OpenAI
1. Open Settings (Cmd+,)
2. Go to "AI Providers" tab
3. Select "OpenAI"
4. Enter your API key (starts with `sk-`)
5. Click "Save" and "Test Connection"

### Ollama (Local)
1. Install and run Ollama: https://ollama.ai
2. Open Settings (Cmd+,)
3. Go to "AI Providers" tab
4. Select "Ollama (Local)"
5. Verify URL is correct (default: `http://localhost:11434`)
6. Click "Test Connection"

## Tech Stack

- **Desktop**: Tauri v2
- **Frontend**: React 19 + TypeScript 5
- **Editor**: Tiptap v2 (ProseMirror)
- **UI**: shadcn/ui (Radix UI + Tailwind CSS v4)
- **State**: Zustand
- **AI**: Multi-provider abstraction (Anthropic, OpenAI, Ollama)

## Project Structure

```
note-sage/
├── src/                      # React frontend
│   ├── components/
│   │   ├── editor/          # Tiptap editor components
│   │   ├── chat/            # AI chat panel
│   │   ├── settings/        # Settings dialog
│   │   ├── sidebar/         # File tree
│   │   └── tabs/            # Tab management
│   ├── stores/              # Zustand state stores
│   ├── hooks/               # React hooks
│   └── lib/
│       └── ai/              # AI provider abstraction
└── src-tauri/               # Rust backend
    └── src/
        └── commands/
            ├── file.rs      # File operations
            ├── dialog.rs    # Native dialogs
            └── ai.rs        # AI API calls
```

## Security Notes

⚠️ **API Keys**: Currently stored in browser localStorage (plaintext). This is convenient for development but means keys are visible in browser developer tools. For production use, consider encrypting stored credentials.

## Roadmap

- ✅ Phase 1: The Editor
- ✅ Phase 2: AI Collaboration
- 🔜 Phase 3: Project Workspace (Git integration, metadata)
- 🔜 Phase 4: Document Generation (PDF/DOCX/PPTX export)
- 🔜 Phase 5: Workflows & Advanced AI

## License

See CLAUDE.md for full project specification.
