# Notesage Competitive Analysis

*Last updated: 2026-03-13*

## Executive Summary

Notesage occupies a unique position in the note-taking and writing app landscape: a **lightweight desktop markdown editor with deep, multi-provider AI collaboration** built on Tauri v2. This analysis examines 13 competing products across the dimensions most relevant to Notesage's target users — writers, researchers, developers, and knowledge workers who want AI-augmented writing without cloud dependency.

**Key finding:** No single competitor combines Notesage's breadth of AI integration (multi-provider, local AI, agent delegation, voice transcription, MCP skills) with a native desktop markdown editor. Obsidian comes closest via plugins but lacks first-party AI. AppFlowy matches on local AI but targets a different (Notion-like) user. Bear matches on design polish but lacks AI entirely.

---

## Competitor Profiles

### 1. Reor

**Website:** reorproject.org | **License:** AGPL-3.0 (open source) | **Pricing:** Free | **Status: ARCHIVED (March 7, 2026)**

**Overview:** Reor (Latin: "to think") is an AI-powered desktop note-taking app that combines semantic search, RAG (retrieval-augmented generation), and local-first AI. It positions itself as a "self-organizing" note app for "high entropy people" — those who produce many notes and need help organizing them. The project was **archived on March 7, 2026** and is no longer maintained. Last release: v0.2.32 (April 2025). Despite archival, it had 8,500+ GitHub stars.

**Tech Stack:** Electron, React, TypeScript, BlockNote (migrated from Tiptap in v0.2.32), Transformers.js (local embeddings), LanceDB (local vector database), Vite

**Platform Support:** macOS, Windows, Linux

**Editor:**
- BlockNote-based editor (built on Tiptap/ProseMirror, migrated from raw Tiptap in final release)
- Block-based editing with image and video support
- Wikilinks (`[[note]]`) for internal linking (Obsidian-compatible)
- Related notes sidebar showing vector-similar notes
- Light and dark themes

**AI Capabilities:**
- Local LLM support via Ollama integration
- Cloud AI via OpenAI API or any OpenAI-compatible endpoint
- Semantic search using local vector embeddings (Transformers.js, runs in-process)
- RAG: chat with your notes — AI answers using your note content as context
- Automatic note linking based on semantic similarity (LanceDB vector store)
- AI writing assistant — highlight text + press space for inline rewriting
- AI flashcard generation — extracts key points and generates Q&A cards

**Unique Differentiators:**
- "Two generators" RAG model — both human (sidebar showing related notes) and LLM (Q&A) share the same vector retrieval infrastructure
- Zero-cloud architecture — both LLM and embeddings run locally, no API key required with Ollama
- Automatic knowledge graph — notes linked without manual effort
- Single-directory simplicity — just a folder of markdown files, no proprietary database

**Limitations:**
- **Project archived** — no further development or maintenance
- Electron-based (heavier than Tauri)
- Single directory only (no multi-project support)
- No mobile apps
- No plugin system
- No collaboration features
- Limited export options
- Frontmatter parsing issues with some imported markdown

**Comparison with Notesage:**

| Dimension | Reor | Notesage |
|---|---|---|
| AI depth | RAG + semantic search + local LLM | Multi-provider + agents + skills + MCP + voice |
| AI architecture | Embedding-centric (RAG) | Action-centric (generation, delegation, completions) |
| Local AI | Ollama only | Ollama + bundled llama-server + Whisper |
| Desktop framework | Electron | Tauri (lighter) |
| Editor | Basic markdown | Tiptap/ProseMirror (richer) |
| Knowledge graph | Semantic similarity links | None (planned) |
| Plugin system | No | Skills + MCP |

---

### 2. Logseq

**Website:** logseq.com | **License:** AGPL-3.0 (open source) | **Pricing:** Free (Sync $5/mo)

**Overview:** Logseq is an outliner-first, privacy-focused knowledge management tool. Every line is a block that can be referenced, embedded, and linked. It emphasizes networked thinking and daily journals.

**Tech Stack:** ClojureScript (legacy), Rust + SQLite (DB version), Electron

**Platform Support:** macOS, Windows, Linux, iOS, Android (mobile apps available)

**Editor:**
- Outliner-based (every line is a collapsible, referenceable block)
- Markdown and Org-mode support
- Block references and embeds (`((block-id))`)
- Page references (`[[page name]]`)
- Templates and dynamic queries

**Key Features:**
- Daily journal as default entry point
- Bi-directional linking with backlinks panel
- Knowledge graph visualization (interactive force-directed graph)
- Advanced queries (Datalog-based)
- Flashcards (spaced repetition built in)
- PDF annotation — highlight and reference PDF content
- Whiteboards (infinite canvas for visual thinking)
- Plugin marketplace with 200+ community plugins
- Git-based version history

**AI Capabilities:**
- No built-in AI features in the core app
- Community plugins add AI capabilities (e.g., Logseq Copilot, GPT-3 Logseq)
- No official AI roadmap published

**Unique Differentiators:**
- Outliner-first paradigm — everything is a nestable, referenceable block
- Daily journals as the primary workflow
- Org-mode support (rare among modern note apps)
- Flashcards with spaced repetition built in
- PDF annotation integrated into the knowledge base
- Whiteboards for spatial thinking

**Limitations:**
- Performance issues with large graphs (being addressed by DB version)
- Outliner paradigm has a learning curve
- Not a traditional document editor — poor for long-form prose
- AI support is community-driven, not first-party
- Mobile apps are limited compared to desktop

**Comparison with Notesage:**

| Dimension | Logseq | Notesage |
|---|---|---|
| Editing paradigm | Outliner (block-first) | Document (prose-first) |
| Knowledge management | Graph, backlinks, queries | File tree, tags, projects |
| AI | Community plugins only | First-party, multi-provider |
| Long-form writing | Weak (outliner friction) | Strong (Tiptap rich text) |
| Mobile apps | Yes (iOS, Android) | No |
| PDF support | Annotation + reference | View + export |
| Flashcards | Built-in | No |
| Voice/transcription | No | Whisper-powered dictation |

---

### 3. Obsidian

**Website:** obsidian.md | **License:** Proprietary (free for personal use) | **Pricing:** Free personal; $50/yr commercial

**Overview:** Obsidian is the dominant player in the local-first markdown knowledge base space. It stores notes as plain markdown files and offers an extensible plugin ecosystem with 2,000+ community plugins.

**Tech Stack:** Electron, TypeScript, CodeMirror 6

**Platform Support:** macOS, Windows, Linux, iOS, Android

**Editor:**
- CodeMirror 6-based with live preview mode
- Source mode, reading mode, and live preview mode
- Vim keybindings (optional)
- Callouts, embedded content, math (MathJax/KaTeX)
- Tables, task lists, footnotes, mermaid diagrams
- Canvas (infinite spatial canvas for visual thinking)

**Key Features:**
- Internal links (`[[wikilinks]]`) with backlinks panel
- Knowledge graph visualization (global and local)
- Daily notes and templates
- Bookmarks, tags, aliases
- Split panes and workspaces
- Command palette
- Custom CSS themes (massive theme community)
- 2,000+ community plugins
- Obsidian Publish (web publishing, $8/mo)
- Obsidian Sync (E2E encrypted sync, $4/mo)
- Obsidian Canvas (visual spatial notes)

**AI Capabilities (via plugins):**
- No first-party AI features
- **Copilot plugin** — chat with notes, RAG-style Q&A, supports OpenAI/Anthropic/Ollama/local models
- **Smart Connections** — semantic similarity, AI-powered backlinks
- **Text Generator** — inline AI text generation
- **Omnisearch** — enhanced search with AI ranking
- Dozens of other AI plugins (summarize, translate, generate, etc.)

**Unique Differentiators:**
- Largest plugin ecosystem in the space (2,000+)
- Plain markdown files — ultimate data portability
- Canvas for visual/spatial thinking
- Massive community (Discord, forums, YouTube)
- Obsidian Publish for web publishing
- Highly customizable (CSS themes, hotkeys, workflows)
- Strong mobile apps with full feature parity

**Limitations:**
- Electron-based (resource heavy)
- No real-time collaboration
- No first-party AI (plugin quality varies)
- Sync and Publish are paid add-ons
- Plugin ecosystem can be overwhelming
- Proprietary license (not open source)

**Comparison with Notesage:**

| Dimension | Obsidian | Notesage |
|---|---|---|
| Plugin ecosystem | 2,000+ plugins | Skills + MCP (extensible but smaller) |
| AI integration | Community plugins (inconsistent) | First-party, deep, multi-provider |
| Editor engine | CodeMirror 6 | Tiptap/ProseMirror |
| Knowledge graph | Built-in | Not yet (planned) |
| EPUB reading | Plugin-based | Built-in viewer |
| PDF export | Plugin-based | Built-in Typst engine |
| Voice transcription | Plugin-based | Built-in Whisper |
| Desktop framework | Electron | Tauri (lighter) |
| Mobile apps | Excellent | No |
| Collaboration | No | No (planned) |
| Data format | Plain .md files | Plain .md files |
| Pricing | Free personal / $50 commercial | Free |

---

### 4. Bear

**Website:** bear.app | **License:** Proprietary | **Pricing:** Free (basic); $2.99/mo or $29.99/yr (Pro)

**Overview:** Bear is an elegant, Apple-exclusive note-taking app known for its beautiful design, tag-based organization, and distraction-free writing experience. It's the design benchmark for premium note apps.

**Tech Stack:** Native Swift/Objective-C (AppKit + UIKit), custom editor, CloudKit sync

**Platform Support:** macOS, iOS, iPadOS only (Apple ecosystem exclusive)

**Editor:**
- Custom markdown editor with inline preview
- Rich text rendering while typing (headings, bold, etc. render inline)
- Inline images, files, and sketches
- Code blocks with syntax highlighting
- Tables, task lists, separators
- Folding (collapse headings/sections)
- Focus mode and typewriter mode
- Multiple themes (14+ built-in)

**Key Features:**
- Tag-based organization (nested tags: `#work/project-a`)
- No folders — tags are the sole organizational primitive
- Sidebar with tag tree, smart filters (untagged, todo, today, archive, trash)
- iCloud sync across Apple devices (included in Pro)
- Quick note from menu bar / widget
- Export: PDF, HTML, DOCX, Markdown, EPUB, JPG
- Web content import (Safari extension)
- Back links (Bear 2)
- Note linking (`[[note title]]`)
- Apple Pencil support (iPad)

**AI Capabilities:**
- No AI features whatsoever
- No plans for AI integration announced
- Philosophy: focused, distraction-free writing tool

**Unique Differentiators:**
- Gold standard for design polish — Notesage's design-system.md explicitly cites Bear as inspiration
- Tag-based organization (no folders) is opinionated but beloved
- Native Apple performance (not Electron/Tauri — truly native)
- Apple Pencil handwriting support
- Best-in-class iOS/iPadOS experience
- 14+ beautiful themes

**Limitations:**
- Apple-only (no Windows, Linux, Android, Web)
- No AI features
- No plugin/extension system
- No knowledge graph or backlinks visualization
- No collaboration
- No web app
- Subscription required for sync and export

**Comparison with Notesage:**

| Dimension | Bear | Notesage |
|---|---|---|
| Design polish | Gold standard (native) | Aspires to Bear's level (Tauri) |
| AI | None | Comprehensive multi-provider |
| Tags | First-class, nested, organizational | Inline badges, search |
| Platform | Apple only | macOS (Tauri cross-platform capable) |
| Mobile | Excellent iOS/iPadOS | No |
| Editor | Custom native | Tiptap/ProseMirror |
| Export | PDF, DOCX, HTML, EPUB, MD, JPG | PDF (Typst), Markdown |
| Extensibility | None | Skills, MCP, agents |
| Sync | iCloud (built-in) | iCloud (manual) |
| Voice | No | Whisper dictation |

---

### 5. Anytype

**Website:** anytype.io | **License:** Source-available (Any Source License) | **Pricing:** Free (self-hosted); paid plans for multiplayer

**Overview:** Anytype is a local-first, encrypted, peer-to-peer knowledge management platform. It uses an object-and-relation model (not files or databases) where everything is a typed object connected through relations.

**Tech Stack:** Go (backend/middleware), Electron + React (desktop), Swift (iOS), Kotlin (Android), IPFS/libp2p for P2P sync, CRDT for conflict resolution

**Platform Support:** macOS, Windows, Linux, iOS, Android

**Editor:**
- Block-based editor (Notion-style)
- Rich text with inline styling
- Embeds, bookmarks, code blocks, LaTeX math
- Relations (custom typed metadata on any object)
- Templates per object type

**Key Features:**
- Object-and-relation data model (types: Note, Task, Book, Person, etc.)
- Sets and Collections (database-like views: grid, list, gallery, Kanban)
- Graph view showing object relationships
- Spaces (separate workspaces with sharing)
- End-to-end encryption by default
- P2P sync via IPFS (no central server required)
- Local-first — works fully offline
- Type system — create custom object types with custom relations
- Widgets for dashboard-style home screens
- Import from Notion, Markdown, HTML, CSV

**AI Capabilities:**
- AI features added in recent versions
- AI-assisted writing (rewrite, summarize, expand)
- Object type suggestion based on content
- AI search across spaces
- Uses cloud AI (specific provider not prominently documented)
- Local AI not available

**Unique Differentiators:**
- P2P encrypted sync (no central server) — strongest privacy story alongside Joplin
- Object-relation model is more flexible than files or databases
- CRDT-based — built for future real-time collaboration
- Self-hostable backup nodes
- Not file-based — data stored in a local encrypted object store

**Limitations:**
- Not markdown-native (proprietary object store)
- Steeper learning curve (object/relation/type concepts)
- Smaller community than Obsidian
- AI features are basic compared to dedicated AI writing tools
- Performance can lag with large object graphs
- Data portability concerns (not plain files)

**Comparison with Notesage:**

| Dimension | Anytype | Notesage |
|---|---|---|
| Data model | Objects + relations | Markdown files |
| Sync | P2P encrypted (IPFS) | iCloud |
| AI depth | Basic (rewrite, summarize) | Deep (multi-provider, agents, MCP, voice) |
| Privacy | E2E encrypted, P2P | Local-first, optional cloud AI |
| Editor | Block-based | Rich text (Tiptap) |
| Mobile | Yes (iOS, Android) | No |
| Data portability | Export only (not plain files) | Native .md files |
| Collaboration | Spaces with sharing | No (planned) |
| Graph view | Yes | No (planned) |

---

### 6. Craft

**Website:** craft.do | **License:** Proprietary | **Pricing:** Free tier; ~$5/user/mo (Plus); team plans available

**Overview:** Craft is a premium, Apple-native document editor focused on beautiful documents, team collaboration, and integrated AI. It's Notesage's closest design inspiration.

**Tech Stack:** Native Swift (macOS, iOS, iPadOS), Web editor available

**Platform Support:** macOS, iOS, iPadOS, Web (no Windows, Linux, Android)

**Editor:**
- Block-based rich text editor (proprietary, not markdown-native)
- Nested pages and cards
- Inline styling, toggles, callouts
- Full-width and card layouts
- Markdown export/import (but not native markdown storage)

**Key Features:**
- Real-time collaboration
- Cross-platform sync (native Apple apps)
- Version history with labeled milestones
- Offline access with auto-sync
- API and MCP support for external AI tool integration
- Spaces for team organization
- Web publishing (share documents as websites)
- Deep links and backlinks

**AI Capabilities:**
- **Craft Assistant** with tiered AI models:
  - On-device: Llama 3.2 1B (free, no credits)
  - Core: ChatGPT Nano 5.1
  - Fast: Claude Haiku 4.5
  - Max: Claude Sonnet 4.5
- Credit-based system for cloud AI usage
- AI writing assistance: summarize, rewrite, expand, translate
- MCP support — connect Craft content to external AI tools
- Privacy-first: chat history stays on device

**Unique Differentiators:**
- Truly native Apple apps (not Electron/Tauri) — exceptional performance
- On-device AI at no extra cost
- MCP support for AI tool interop
- Best-in-class document sharing and publishing
- Real-time collaboration

**Comparison with Notesage:**

| Dimension | Craft | Notesage |
|---|---|---|
| Native feel | Native Swift (superior) | Tauri (good, not native) |
| AI models | Tiered (on-device to Sonnet) | Multi-provider (broader choice) |
| AI agents | No | Yes (ACP, skills, delegation) |
| Collaboration | Real-time | No (planned) |
| Data format | Proprietary blocks | Plain .md files |
| MCP | Yes | Yes |
| Voice | No | Whisper transcription |
| Pricing | Subscription | Free |
| Platform | Apple + Web | macOS (cross-platform capable) |

---

### 7. Notion

**Website:** notion.so | **License:** Proprietary | **Pricing:** Free (limited); Plus $10/mo; Business $20/mo; Enterprise custom

**Overview:** Notion is the market leader in all-in-one workspace tools, combining documents, databases, wikis, and project management. It's cloud-first with powerful AI features.

**Tech Stack:** Electron (desktop), React, proprietary block storage

**Platform Support:** macOS, Windows, iOS, Android, Web (no native Linux app)

**Editor:**
- Block-based with 50+ block types
- Databases with 6 view types (table, board, timeline, calendar, list, gallery)
- Templates, synced blocks, embeds
- Real-time collaboration with comments and mentions

**Key Features:**
- Databases as first-class citizens
- Wikis and team knowledge bases
- Project management (timelines, sprints, Kanban)
- 100+ integrations (Slack, GitHub, Jira, etc.)
- Web clipper
- API for programmatic access
- Templates marketplace

**AI Capabilities:**
- **Notion AI** (bundled in Business/Enterprise, add-on for others)
- Multi-model: GPT-5, Claude Opus 4.1, o3
- Autonomous AI Agents (Notion 3.0) — multi-step workflows running up to 20 minutes
- Custom Agents on schedules/triggers
- Enterprise Search across connected apps
- AI Meeting Notes with auto-transcription
- AI writing assistance (summarize, translate, improve, brainstorm)

**Unique Differentiators:**
- Most feature-rich workspace overall
- Database-centric approach enables project management
- Autonomous AI agents that work across pages and integrations
- Massive template ecosystem
- Market dominance and brand recognition

**Comparison with Notesage:**

| Dimension | Notion | Notesage |
|---|---|---|
| Scope | All-in-one workspace | Focused writing + AI |
| Data storage | Cloud-first | Local-first |
| AI agents | Autonomous workflows | Interactive delegation |
| Databases | First-class | None |
| Offline | Limited | Full |
| Data format | Proprietary | Plain .md files |
| Privacy | Cloud-dependent | Local-first, optional cloud |
| Pricing | $10-20/mo for full features | Free |
| Performance | Heavy (Electron + cloud) | Light (Tauri + local) |

---

### 8. Joplin

**Website:** joplinapp.org | **License:** AGPL-3.0 (open source) | **Pricing:** Free; Joplin Cloud ~EUR 2-8/mo

**Overview:** Joplin is an open-source note-taking app focused on privacy and sync flexibility. It supports end-to-end encryption and can sync via multiple backends.

**Tech Stack:** Electron (desktop), React Native (mobile), TypeScript

**Platform Support:** macOS, Windows, Linux, iOS, Android, CLI

**Editor:**
- Dual-mode: rich text and raw markdown (side-by-side or toggle)
- Basic formatting, code blocks, math (KaTeX)
- Multimedia attachments (images, video, PDF, audio)

**Key Features:**
- End-to-end encryption (E2EE)
- Flexible sync: Joplin Cloud, Nextcloud, Dropbox, OneDrive, S3, WebDAV
- Web clipper browser extension
- Plugin ecosystem (Extension API)
- Notebook + tag organization
- Terminal CLI app

**AI Capabilities:**
- No built-in AI features
- Limited community plugin options for AI

**Comparison with Notesage:**

| Dimension | Joplin | Notesage |
|---|---|---|
| Privacy | E2EE | Local-first |
| AI | None | Comprehensive |
| Sync flexibility | 7+ backends | iCloud |
| Editor quality | Basic | Rich (Tiptap) |
| Design polish | Functional | Premium aspiration |
| Mobile | Yes | No |
| CLI | Yes | No |

---

### 9. Typora

**Website:** typora.io | **License:** Proprietary | **Pricing:** $14.99 one-time (3 devices)

**Overview:** Typora is the gold standard for seamless WYSIWYG markdown editing — markdown syntax renders inline as you type with no mode switching or split panes.

**Tech Stack:** Electron, custom rendering engine

**Platform Support:** macOS, Windows, Linux (x86 and ARM)

**Editor:**
- True live WYSIWYG — markdown renders inline instantly
- Focus mode (dim non-active paragraphs)
- Typewriter mode (center active line)
- Mermaid diagrams, math (LaTeX), flowcharts rendered inline
- Custom CSS themes
- Outline panel

**Key Features:**
- Seamless markdown editing experience
- Export: PDF, DOCX, HTML, LaTeX, EPUB, MediaWiki, and more
- File tree and file list panels
- Custom themes
- Image auto-upload (iPic, PicGo)

**AI Capabilities:** None.

**Comparison with Notesage:**

| Dimension | Typora | Notesage |
|---|---|---|
| Markdown rendering | Best-in-class inline | Rich text with toolbar |
| AI | None | Comprehensive |
| Export formats | 8+ formats | PDF |
| Pricing | $14.99 one-time | Free |
| Extensibility | Themes only | Skills, MCP, agents |
| Voice | No | Whisper dictation |

---

### 10. iA Writer

**Website:** ia.net/writer | **License:** Proprietary | **Pricing:** $49.99 Mac, $29.99 Windows, $19.99 iOS (one-time)

**Overview:** iA Writer is a focused writing app with unique authorship tracking that distinguishes human-written text from AI-generated and pasted content.

**Tech Stack:** Native Swift (macOS/iOS), native Windows app

**Platform Support:** macOS, Windows, iOS, iPadOS, Android

**Editor:**
- Plain text markdown with preview mode
- Focus mode (sentence/paragraph dimming)
- Syntax highlighting for parts of speech
- Style Check (clichés, filler words, redundancies)
- Content blocks (embed files inline)

**Key Features:**
- **Authorship tracking** — visually distinguishes human, AI, and pasted text
- Writing craft tools (syntax analysis, style checking)
- Library with favorites, hashtags, smart folders
- Export: PDF, DOCX, HTML, WordPress
- iCloud and Dropbox sync

**AI Capabilities:**
- OpenAI and Anthropic integration via user API keys
- Focus on authorship transparency rather than AI generation
- AI text visually marked differently from human text

**Unique Differentiators:**
- Authorship tracking is unique in the market
- Anti-AI-generation philosophy — uses AI to enhance transparency
- One-time purchase (anti-subscription)
- Writing craft tools (parts of speech, style analysis)

**Comparison with Notesage:**

| Dimension | iA Writer | Notesage |
|---|---|---|
| AI philosophy | Transparency-first | Generation-first |
| Writing tools | Parts of speech, style check | AI improve/expand/summarize |
| Authorship tracking | Yes (unique) | No |
| Pricing | $50-$100 one-time | Free |
| Agent delegation | No | Yes |
| Voice | No | Whisper dictation |

---

### 11. Zettlr

**Website:** zettlr.com | **License:** GPL-3.0 (open source) | **Pricing:** Free

**Overview:** Zettlr is an academic-focused markdown editor with first-class citation management and Zettelkasten support.

**Tech Stack:** Electron, TypeScript, CodeMirror 6, Pandoc

**Platform Support:** macOS, Windows, Linux

**Editor:**
- CodeMirror 6-based source editor with preview
- Split view (two notes side-by-side)
- Code syntax highlighting
- LaTeX math support

**Key Features:**
- **Citation management** — Zotero/JabRef integration (CSL-JSON, BibTeX)
- Zettelkasten support (internal links, backlinks, IDs)
- Pandoc export (virtually any format)
- Workspace management with virtual directories
- Global search
- Writing statistics with heatmap
- 12+ language translations

**AI Capabilities:** None.

**Comparison with Notesage:**

| Dimension | Zettlr | Notesage |
|---|---|---|
| Academic focus | Best-in-class (citations, Zettelkasten) | Limited |
| AI | None | Comprehensive |
| Export | Pandoc (any format) | PDF (Typst) |
| Citations | First-class | Research skills |
| Editor | CodeMirror 6 | Tiptap/ProseMirror |

---

### 12. AppFlowy

**Website:** appflowy.io | **License:** AGPL-3.0 (open source) | **Pricing:** Free

**Overview:** AppFlowy is the strongest open-source Notion alternative with real local-first AI and self-hosting support. It's built with Flutter and Rust.

**Tech Stack:** Flutter (frontend/mobile), Rust (backend), open source

**Platform Support:** macOS, Windows, Linux, iOS, Android, Web

**Editor:**
- Block-based (Notion-style) with 20+ content types
- To-dos, images, code blocks, math equations
- Database views (table, Kanban, calendar)

**Key Features:**
- Self-hosting option
- Offline-first with sync
- Customizable themes
- Community plugins and templates
- Database views

**AI Capabilities:**
- **Local AI via Ollama** — fully on-device (Llama 3, Mistral 7B)
- Cloud AI: GPT-5, Gemini 2.5, Claude 3.7
- AI writing: brainstorm, improve, summarize, extract actions
- AI Workspace Search with summaries
- **Vault Workspace** — completely private offline workspace with local AI and Chat with Files
- Chat with uploaded PDFs (all local processing)

**Unique Differentiators:**
- Strongest open-source Notion alternative
- Vault Workspace for fully offline private AI
- Flutter+Rust for true cross-platform native performance
- Self-hostable for data sovereignty
- Used by enterprises (Oracle, Telefonica) and universities (UCLA, MIT)

**Comparison with Notesage:**

| Dimension | AppFlowy | Notesage |
|---|---|---|
| App type | Notion-like workspace | Writing-focused editor |
| Local AI | Ollama integration | Ollama + bundled llama-server |
| Databases | Yes (table, Kanban, calendar) | No |
| AI agents | No | Yes (ACP, skills, delegation) |
| Voice | No | Whisper dictation |
| Data format | Proprietary blocks | Plain .md files |
| Self-hosting | Yes | No |
| Mobile | Yes | No |
| MCP | No | Yes |

---

## Feature Comparison Matrix

### Core Editing

| Feature | Notesage | Reor | Logseq | Obsidian | Bear | Anytype | Craft | Notion | Joplin | Typora | iA Writer | Zettlr | AppFlowy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Rich text editing | Tiptap | Basic MD | Outliner | CodeMirror | Custom | Block | Block | Block | Dual-mode | Live WYSIWYG | Plain MD | CodeMirror | Block |
| Markdown native | Yes | Yes | Yes | Yes | Yes | No | No | No | Yes | Yes | Yes | Yes | No |
| WYSIWYG | Yes | Partial | No | Live preview | Inline | Yes | Yes | Yes | Toggle | Yes | Preview | Preview | Yes |
| Slash commands | Yes | No | Yes | Yes | No | Yes | Yes | Yes | No | No | No | No | Yes |
| Tables | Yes | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | No | Yes |
| Code blocks + syntax | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes |
| Math/LaTeX | No | No | Yes | Yes | No | Yes | No | Yes | Yes | Yes | No | Yes | Yes |
| Mermaid diagrams | No | No | Yes | Yes | No | No | No | No | No | Yes | No | No | No |
| Find & replace | Yes | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Focus/typewriter mode | Yes | No | No | No | Yes | No | No | No | No | Yes | Yes | No | No |
| Vim keybindings | No | No | No | Yes | No | No | No | No | No | No | No | No | No |

### AI & Intelligence

| Feature | Notesage | Reor | Logseq | Obsidian | Bear | Anytype | Craft | Notion | Joplin | Typora | iA Writer | Zettlr | AppFlowy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AI writing assist | Yes | Yes | Plugin | Plugin | No | Yes | Yes | Yes | No | No | Yes | No | Yes |
| Multi-provider | Yes | Yes | No | Plugin | No | No | Tiered | Yes | No | No | Yes | No | Yes |
| Local/offline AI | Yes | Yes | No | Plugin | No | No | On-device | No | No | No | No | No | Yes |
| Bundled LLM | Yes | No | No | No | No | No | Yes | No | No | No | No | No | No |
| AI agents | Yes | No | No | No | No | No | No | Yes | No | No | No | No | No |
| RAG / chat with notes | No | Yes | No | Plugin | No | No | No | Yes | No | No | No | No | Yes |
| Semantic search | No | Yes | No | Plugin | No | No | No | Yes | No | No | No | No | Yes |
| AI inline completions | Yes | No | No | Plugin | No | No | No | No | No | No | No | No | No |
| Voice transcription | Yes | No | No | Plugin | No | No | No | Yes | No | No | No | No | No |
| Web search (AI) | Yes | No | No | No | No | No | No | Yes | No | No | No | No | No |
| MCP support | Yes | No | No | No | No | No | Yes | No | No | No | No | No | No |
| Skills/tools platform | Yes | No | No | No | No | No | No | No | No | No | No | No | No |
| Comment delegation | Yes | No | No | No | No | No | No | No | No | No | No | No | No |
| Authorship tracking | No | No | No | No | No | No | No | No | No | No | Yes | No | No |

### Organization & Knowledge Management

| Feature | Notesage | Reor | Logseq | Obsidian | Bear | Anytype | Craft | Notion | Joplin | Typora | iA Writer | Zettlr | AppFlowy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Folder/file tree | Yes | Yes | No | Yes | No | No | Nested pages | Yes | Notebooks | Yes | Library | Yes | Yes |
| Tags | Yes | No | Yes | Yes | Yes | Yes | No | Yes | Yes | No | Yes | No | No |
| Wikilinks | No | Yes | Yes | Yes | No | Yes | Yes | Yes | Yes | No | No | Yes | No |
| Backlinks | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | No | No | Yes | No |
| Knowledge graph | No | Semantic | Yes | Yes | No | Yes | No | No | No | No | No | Yes | No |
| Daily notes/journal | No | No | Yes | Yes | No | No | No | No | No | No | No | No | No |
| Databases/sets | No | No | No | No | No | Yes | No | Yes | No | No | No | No | Yes |
| Templates | No | No | Yes | Yes | No | Yes | Yes | Yes | Yes | No | No | No | Yes |
| Flashcards/SRS | No | No | Yes | Plugin | No | No | No | No | No | No | No | Yes | No |
| Projects | Yes | No | No | Vaults | No | Spaces | Spaces | Workspaces | Notebooks | No | No | Projects | Workspaces |
| Citations | Research skills | No | No | Plugin | No | No | No | No | No | No | No | First-class | No |

### Document Formats & Export

| Feature | Notesage | Reor | Logseq | Obsidian | Bear | Anytype | Craft | Notion | Joplin | Typora | iA Writer | Zettlr | AppFlowy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| PDF export | Yes (Typst) | No | Yes | Plugin | Yes | No | Yes | Yes | Yes | Yes | Yes | Pandoc | Yes |
| DOCX export | No | No | No | Plugin | Yes | No | No | No | No | Yes | Yes | Pandoc | No |
| EPUB export | No | No | No | No | Yes | No | No | No | No | Yes | No | No | No |
| HTML export | No | No | Yes | No | Yes | No | Yes | Yes | Yes | Yes | Yes | Pandoc | No |
| EPUB viewer | Yes | No | No | No | No | No | No | No | No | No | No | No | No |
| PDF viewer | Yes | No | Yes | No | No | No | No | No | No | No | No | No | No |
| DOCX viewer | Yes | No | No | No | No | No | No | No | No | No | No | No | No |

### Platform, Privacy & Pricing

| Feature | Notesage | Reor | Logseq | Obsidian | Bear | Anytype | Craft | Notion | Joplin | Typora | iA Writer | Zettlr | AppFlowy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| macOS | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Windows | Future | Yes | Yes | Yes | No | Yes | No | Yes | Yes | Yes | Yes | Yes | Yes |
| Linux | Future | Yes | Yes | Yes | No | Yes | No | No | Yes | Yes | No | Yes | Yes |
| iOS | No | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Yes | No | Yes |
| Android | No | No | Yes | Yes | No | Yes | No | Yes | Yes | No | Yes | No | Yes |
| Web | No | No | No | No | No | No | Yes | Yes | No | No | No | No | Yes |
| Offline-first | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | Yes | Yes |
| E2E encryption | No | No | No | Sync only | No | Yes | No | No | Yes | N/A | No | No | No |
| Open source | No | Yes | Yes | No | No | Source-avail | No | No | Yes | No | No | Yes | Yes |
| Desktop framework | Tauri | Electron | Electron | Electron | Native | Electron | Native | Electron | Electron | Electron | Native | Electron | Flutter |
| Collaboration | No | No | No | No | No | Spaces | Real-time | Real-time | No | No | No | No | Yes |
| Pricing model | Free | Free | Free | Free/$50 | $3/mo | Free | $5/mo | $10-20/mo | Free | $15 once | $30-50 once | Free | Free |

---

## Strategic Insights

### Where Notesage Leads

1. **AI integration breadth** — No competitor offers the combination of multi-provider support, agent delegation, MCP skills, inline completions, voice transcription, and local bundled inference in a single app. Notion comes closest but is cloud-dependent.

2. **AI agent delegation via comments** — Unique feature. No competitor allows delegating inline comments to AI agents for resolution within the document context.

3. **Bundled local inference** — Only Notesage and Craft offer truly bundled LLM inference (no Ollama installation required). AppFlowy requires Ollama.

4. **EPUB reading in an editor** — No other markdown editor includes an EPUB viewer. This makes Notesage useful as a reading + writing tool.

5. **Desktop lightness** — Tauri v2 gives Notesage a significant memory/resource advantage over the 8 Electron-based competitors.

6. **Skills + MCP platform** — The extensible AI tool platform (skills, MCP servers, agent instructions) is more structured than Obsidian's plugin approach for AI-specific use cases.

### Where Notesage Trails

1. **Mobile apps** — Bear, Obsidian, Logseq, Notion, Anytype, Craft, Joplin, iA Writer, and AppFlowy all have mobile apps. This is Notesage's largest gap.

2. **Knowledge graph / backlinks** — 7 competitors offer some form of graph visualization or backlinks. Notesage has tags but no graph or wikilinks.

3. **Plugin ecosystem** — Obsidian's 2,000+ plugins dwarf Notesage's skills system. Community-driven extensibility is a proven moat.

4. **Collaboration** — Notion, Craft, and AppFlowy offer real-time collaboration. Notesage has none.

5. **Databases / structured data** — Notion, Anytype, and AppFlowy support database views. Notesage is document-only.

6. **RAG / semantic search** — Reor and Obsidian (via plugins) offer chat-with-your-notes using embeddings. Notesage has research skills but no vector-based retrieval.

7. **Math/LaTeX and diagrams** — 7 competitors support math rendering and/or Mermaid diagrams. Notesage does not.

8. **Export format breadth** — Typora exports to 8+ formats, Bear to 6, Zettlr to any format via Pandoc. Notesage only exports PDF.

### Strategic Opportunities

1. **RAG / semantic search** — Add local vector embeddings to enable "chat with your notes." This would combine Reor's killer feature with Notesage's superior AI infrastructure.

2. **Mobile companion** — Even a read-only iOS app with sync would close the biggest gap vs. Bear, Obsidian, and Craft.

3. **Knowledge graph** — Backlinks and graph visualization are table stakes for PKM users. Implementing wikilinks + a graph view would unlock the Obsidian/Logseq audience.

4. **Export formats** — Adding DOCX and HTML export (potentially via Pandoc integration) would match Bear and Typora.

5. **Math and diagrams** — LaTeX math and Mermaid support would capture academic and technical users currently using Logseq, Obsidian, or Zettlr.

6. **Authorship tracking** — iA Writer's unique feature of distinguishing human vs. AI text could be adapted for Notesage given its deep AI integration.

### Competitive Positioning

Notesage's sweet spot is users who want:
- **Local-first markdown** (rules out Notion, Craft, Anytype)
- **First-party AI integration** (rules out Obsidian, Bear, Typora, Zettlr, Joplin)
- **Writing-focused** (rules out Logseq's outliner, AppFlowy's databases)
- **Lightweight desktop** (rules out Electron-based apps)
- **Free** (rules out Bear, Typora, iA Writer, Craft, Notion)

The closest competitors for this specific user are **Reor** (AI + local + markdown, but less polished and narrower AI) and **Obsidian + AI plugins** (powerful but fragmented AI experience).

---

## Appendix: Competitor Summary Table

| App | Category | Best For | Biggest Weakness vs. Notesage |
|---|---|---|---|
| Reor | AI-first notes (ARCHIVED) | RAG / chat with notes | Archived, narrower AI, less polished editor |
| Logseq | Outliner PKM | Networked thinking, daily journals | Not a prose editor, no first-party AI |
| Obsidian | Extensible PKM | Plugin power users | Fragmented AI via plugins, Electron |
| Bear | Beautiful notes | Apple ecosystem writers | No AI, Apple-only, no extensibility |
| Anytype | Encrypted PKM | Privacy-first object modeling | Basic AI, data portability concerns |
| Craft | Premium docs | Design-focused Apple teams | Apple-only, subscription, not markdown-native |
| Notion | All-in-one workspace | Teams needing databases + docs | Cloud-dependent, heavy, expensive |
| Joplin | Private notes | Privacy (E2EE) + sync flexibility | No AI, basic editor, dated design |
| Typora | Markdown editing | Seamless markdown WYSIWYG | No AI, no extensibility |
| iA Writer | Focused writing | Prose craft, authorship tracking | Minimal AI, no extensibility |
| Zettlr | Academic writing | Citations + Zettelkasten | No AI, niche audience |
| AppFlowy | Open-source Notion | Self-hosted teams, local AI | Not markdown-native, no agents |
