# PRD: Chat Agent Improvements — History, Deletion, Project & File Awareness

## Problem Statement

Chat agents in Notesage currently lack several capabilities that limit their usefulness:

1. **No message deletion** — Users cannot remove individual messages from the chat history. If a message is irrelevant or incorrect, the only option is to clear the entire conversation.
2. **No history limit** — For Direct API connections, the full conversation history is sent with every request. Long conversations can exceed token limits or degrade response quality.
3. **No project awareness** — Agents don't know the project structure (file tree, root path). Users must manually describe their project layout.
4. **No file awareness** — Agents don't know which file the user is currently editing, requiring users to specify file context in every message.

## Solution Design

### 1. Delete Individual Messages

Add a `deleteMessage(timestamp)` action to `chat-store` and an X button on hover for each message in `ChatMessage.tsx`. The button follows the same hover pattern as the existing copy button.

- Deleting from the UI only removes the message from the frontend store
- ACP agents maintain their own server-side context, so deletion is UI-only for ACP (acceptable trade-off)
- The currently-streaming message cannot be deleted (X hidden while `isLoading`)

### 2. Chat History Limit

Add a `chatHistoryLimit` setting (default: 0 = unlimited) with a dropdown in Settings &gt; AI Providers. When set, only the last N messages are sent to Direct API providers. The system message and current user message are always included.

- ACP agents manage their own context, so this setting only affects Direct API connections
- Options: Unlimited, Last 10, Last 20, Last 50, Last 100

### 3. Project Awareness

Enhance the system message in `useAIOperations` to include:

- **Project root path** — so agents know the working directory
- **File tree** — a compact text representation of the project's file structure (depth-limited, file-count-limited) for single-project context

### 4. File Awareness

Include the currently active file in the system message:

- File path of the currently open tab
- For markdown files, a content snippet (first \~500 chars) for immediate context

## Architecture

All changes are frontend-only. No new Tauri commands required.

| File | Change |
| --- | --- |
| `src/stores/chat-store.ts` | Add `deleteMessage(timestamp)` action |
| `src/components/chat/ChatMessage.tsx` | Add X delete button on hover |
| `src/stores/settings-store.ts` | Add `chatHistoryLimit` setting |
| `src/components/settings/SettingsDialog.tsx` | Add history limit UI in AI tab |
| `src/hooks/useAIOperations.ts` | Apply history limit, add file tree + active file to system message |

## Non-Goals

- Modifying ACP agent server-side context management
- Adding history limit for ACP connections
- File content indexing or semantic search
- Multi-file context beyond the active file

### Verification

1. Delete messages: Hover over any message → X button appears → click → message removed from chat and persisted store
2. History limit: Set to "Last 10" in Settings → send message with long history → verify only last 10 + system + new message are sent (check via debug logging or network inspection)
3. Project tree context: Select a project → open chat → agent response shows awareness of project files (ask "what files are in this project?")
4. File context: Open a file → chat → agent knows which file you're editing (ask "what file am I editing?")
5. ACP agents: Verify ACP agents still work correctly — system message includes project/file context on session init
6. Regression: Existing chat, inline actions, web search all still work