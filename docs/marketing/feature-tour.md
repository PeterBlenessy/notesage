# Notesage — Feature Tour

A quick look at every major surface in the app. Each section includes an annotated screenshot (see `screenshots/`).

---

## Editor

The heart of Notesage is a full-featured rich-text editor that saves everything as clean, portable markdown files. Type naturally and use the toolbar — or type markdown syntax directly — to format your notes.

**What you can do:**
- Use `/` (slash) at the start of any line to open the command menu and insert headings, lists, code blocks, tables, callouts, drawings, charts, and more.
- Select any text to bring up the bubble menu with formatting options and one-click AI actions (Improve, Summarise, Expand).
- Add **callout blocks** — Note, Tip, Warning, Important — to highlight key information.
- Insert **tables** with sorting, filtering, column types (number, currency, date, percentage), and aggregation footers.
- Embed **drawings** (powered by Excalidraw) directly in your notes — shapes, arrows, freehand, connectors.
- Drop in **charts** (bar, line, pie, area, radar, and more) with a visual data editor.
- Paste a URL to get a rich **link preview card** with title, description, and favicon.
- See live **tag badges** for any `#hashtag` — click to search across all your notes.

📸 *Screenshot: Editor with a rich document open — callout block, table, and drawing all visible.*

---

## AI Chat & Quiet Composer

The Quiet Composer is Notesage's floating AI workspace — a compact pill at the bottom of the screen that expands into a full chat interface on demand.

**How it works:**
- Press `⌘K` (or click the pill) to open the composer and start a conversation with your AI.
- Type `/` to pick a skill, `#` to reference a tag, `@` to attach a file or mention, `!` to open a task, `?` to search your research, or `>` to run a command.
- The Agent Orb (bottom-right circle) pulses when background AI tasks are running. Click it to see what's happening.
- Pin the composer to the right side of the screen to keep the chat open while you write.

📸 *Screenshot: Quiet Composer open, showing the chat input and a recent AI response.*

---

## Sidebar & Projects

The sidebar keeps your workspace organised without getting in the way.

**Five sections, always in order:**
- **Pinned** — your most-used notes, one click away.
- **Projects** — all your open folders. Hover over a project name to peek at its contents.
- **Recent** — the last few documents you opened.
- **Tags** — a curated list of your most-used hashtags.
- **Mentions** — people and entities you've referenced with `@`.

Type any letter while the sidebar has focus to filter all sections at once.

📸 *Screenshot: Sidebar showing Pinned, Projects, Recent, Tags, and Mentions sections.*

---

## Document Index & Search

Notesage indexes your notes in the background so you can find anything instantly — no waiting, no scanning.

**What gets indexed:**
- `#tags` — every hashtag across every file.
- `@mentions` — people and entity references.
- **Tasks** — checkbox items with their completion status.
- **Goals** — documents marked as goals or OKRs.
- **Full text** — search by any word or phrase in your notes.

Use `⌘K` to open the command bar and start typing. Results appear instantly from the index.

📸 *Screenshot: Tag search results showing matches across multiple files.*

---

## Export

Turn any note into a polished document without leaving the app.

**Four export formats:**
- **PDF** — three templates (Clean, Academic, Report) with optional table of contents and page numbers.
- **Word (.docx)** — editable Word document, matching the same templates.
- **PowerPoint (.pptx)** — each heading becomes a slide, with support for tables, images, and charts.
- **HTML** — self-contained file with syntax highlighting and all formatting intact.

Press `⌘⇧E` to open the Export dialog.

📸 *Screenshot: Export dialog with PDF selected and template options visible.*

---

## Voice Transcription & Dictation

Speak your notes — Notesage transcribes on your device with no data sent to any server.

**Two modes:**
- **Dictation** — press `⌘⇧R` to start talking; words appear at the cursor in real time.
- **Meeting recording** — record a session, then transcribe the whole thing at once with timestamps.

Choose from five Whisper model sizes (Tiny to Large) to balance speed against accuracy. Everything runs locally on your Mac.

📸 *Screenshot: Transcription overlay showing live dictation in progress.*

---

## Document Viewers

Open more than just markdown files — Notesage handles a wide range of formats.

**Built-in viewers:**
- **EPUB** — read ebooks with paginated or scrollable layout, bookmarks, and chapter navigation.
- **PDF viewer** — view PDFs with full-text search.
- **Word (.docx)** — high-fidelity rendering of Word documents.
- **PowerPoint (.pptx)** — slide-by-slide viewer with chart rendering and speaker notes.
- **Code files** — editable view for 22+ languages (JavaScript, Python, Rust, Go, and more) with syntax highlighting and find-in-file.
- **Plain text** — simple reader for `.txt`, `.log`, and `.csv` files.

📸 *Screenshot: EPUB viewer with a book open in paginated mode.*

---

## Comments & Agent Delegation

Annotate any passage in your notes and — if you want — let an AI agent respond.

**How it works:**
1. Select text and press `⌘⇧M` to add a comment.
2. Click **Delegate** to send the comment to your AI — it reads the document, thinks, and replies in the thread.
3. If the reply suggests a change, click **Apply** to see an inline diff; accept or reject with one click.

Use this for editing, research questions, fact-checking, or any task where you want a second opinion without leaving your document.

📸 *Screenshot: Comment popover showing a delegated AI reply with an Apply button.*
