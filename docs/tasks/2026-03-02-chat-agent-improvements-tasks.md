# Tasks: Chat Agent Improvements

PRD: `docs/prds/2026-03-02-chat-agent-improvements.md`

## Tasks

### Task 1: Delete individual messages

**Status:** Not started **Files:** `src/stores/chat-store.ts`, `src/components/chat/ChatMessage.tsx`

- [x]Add `deleteMessage: (timestamp: number) => void` to chat-store interface

- [x]Implement as filter on messages array

- [x]Add X button to ChatMessage with hover visibility (opacity-0 → group-hover:opacity-100)

- [x]Position at top-right (-top-3 right-2), hide while isLoading

### Task 2: Chat history limit setting

**Status:** Not started **Files:** `src/stores/settings-store.ts`, `src/components/settings/SettingsDialog.tsx`

- [x]Add `chatHistoryLimit: number` (default 0) and setter to settings-store

- [x]Add "Chat History" section in AI Providers tab after UseCaseRoutingSettings

- [x]Select dropdown: Unlimited (0), Last 10, Last 20, Last 50, Last 100

- [x]Help text noting this is for Direct API only

### Task 3: Apply history limit in useAIOperations

**Status:** Not started **Files:** `src/hooks/useAIOperations.ts`

- [x]Read `chatHistoryLimit` from settings store

- [x]Slice messages to last N before sending to Direct API

- [x]System message and new user message always included

### Task 4: Project & file awareness

**Status:** Not started **Files:** `src/hooks/useAIOperations.ts`

- [x]Add `buildFileTreeContext()` helper for compact file tree representation

- [x]Include project root path in `buildProjectHeader()`

- [x]Include file tree in single-project system message

- [x]Add active file path and content snippet to system message