# Notesage

A WYSIWYG markdown editor with AI collaboration capabilities, built with Tauri v2.

## Features

### Editor
- Full-featured Tiptap WYSIWYG editor with markdown round-tripping
- Multi-tab editing with file tree sidebar
- Slash commands, floating toolbar, light/dark theme

### AI Collaboration
- **Multi-Provider Support**: Anthropic Claude, OpenAI, and Ollama (local)
- **AI Chat Panel**: Right sidebar with conversation history (Cmd+Shift+A)
- **Inline AI Actions**: Improve, summarize, or expand selected text via bubble menu
- **AI Web Search**: Provider-native web search with citation display
- **AI Personas**: Configurable system prompts and per-project AI context
- **Settings UI**: Configure API keys and provider preferences (Cmd+,)

### Project Workspace
- **Git Integration**: File status indicators, commit dialog, branch switching
- **Project Goals**: YAML frontmatter-based goals with templates (OKR, SMART, etc.)
- **Project Metadata**: `.notesage/` directory with per-project settings and AI context
- **Multi-Project**: Select multiple projects as AI context in chat

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
- `Cmd+F` - Quick open (fuzzy file search)
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
├── src-tauri/               # Rust backend
│   └── src/
│       └── commands/
│           ├── file.rs      # File operations
│           ├── dialog.rs    # Native dialogs
│           ├── ai.rs        # AI API calls
│           ├── ai_streaming.rs  # SSE streaming (Anthropic, OpenAI, Ollama)
│           └── git.rs       # Git operations
└── docs/                    # Documentation
    ├── architecture.md
    ├── product-description.md
    ├── prds/                # Product requirements
    └── history/             # Release history
```

## Security Notes

⚠️ **API Keys**: Currently stored in browser localStorage (plaintext). This is convenient for development but means keys are visible in browser developer tools. For production use, consider encrypting stored credentials.

## Roadmap

- ✅ Phase 1: The Editor
- ✅ Phase 2: AI Collaboration
- ✅ Phase 3: Project Workspace
- 🔜 Phase 4: Document Generation (PDF/DOCX/PPTX export)
- 🔜 Phase 5: Comments & Change Detection
- 🔜 Phase 6: Agentic AI Collaboration
- 🔜 Phase 7: AI-Assisted Research
- 🔜 Phase 8: Workflows & Automation
- 🔜 Phase 9: Local AI

## License

See CLAUDE.md for full project specification.
