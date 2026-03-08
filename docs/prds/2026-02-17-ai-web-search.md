# PRD: AI Web Search

**Date:** 2026-02-17 **Phase:** 3 (Project Workspace) **Status:** Complete (v0.7.0)

---

## Problem

Notesage's AI chat cannot access current information from the internet. Users researching topics, fact-checking claims, or writing about recent events must leave the app, search manually, and paste findings back in. The existing DuckDuckGo Instant Answer tool is severely limited — it only returns brief abstracts and related topics, often returning empty results for specific queries.

Both Anthropic and OpenAI now offer built-in, server-side web search tools in their APIs. These are the same capabilities that power search in claude.ai and ChatGPT — no third-party search provider needed. Notesage should leverage these native tools instead of maintaining a broken custom implementation.

## Goals

1. **Enable AI-powered web search** — Claude and OpenAI models can search the internet and return cited answers directly in chat
2. **User-controlled toggle** — search is off by default; users enable it per-message or per-session via a toggle in the chat input footer
3. **Source citations** — search results include clickable source URLs so users can verify information
4. **Replace DuckDuckGo** — remove the broken custom tool implementation in favor of provider-native search
5. **Migrate OpenAI to Responses API** — adopt OpenAI's current recommended API for chat with tool support

## Non-Goals

- Full web page fetching/reading (Anthropic has a `web_fetch` tool — defer to future work)
- Search history persistence or bookmarking
- Embedding search results directly into the editor (copy/paste is sufficient for now)
- Building a custom search provider UI (results appear inline in chat, not a separate panel)
- Ollama web search (low priority — documented as future work with a pluggable search provider)

## User Stories

- **As a researcher**, I want to ask the AI about recent events and get answers with sources, so that I can write about current topics without leaving the app
- **As a writer**, I want the AI to fact-check claims by searching the web, so that my writing is accurate
- **As a user**, I want to toggle search on/off, so that I control when the AI accesses the internet (and the associated cost)
- **As a user**, I want to see where information came from (source URLs), so that I can verify and cite sources in my work

## Technical Approach

### Anthropic — Server-side Web Search Tool

Use Anthropic's built-in `web_search_20260209` tool (latest version with dynamic filtering). This is a **server-side tool** — Anthropic's servers execute the search and return results to Claude. Our backend does not need to perform any HTTP requests for search.

**How it works:**

1. Frontend tells backend that web search is enabled for this request
2. Backend includes the `web_search_20260209` tool definition in the `tools` array
3. Anthropic's API handles search execution, result retrieval, and citation generation
4. Response includes `server_tool_use`, `web_search_tool_result`, and `text` blocks with `citations`
5. Backend streams text chunks to frontend; frontend renders citations

**Key change from current architecture:** The existing tool execution loop in `ai_streaming.rs` intercepts `tool_use` blocks and executes tools locally. With server-side search, the search results come back as `web_search_tool_result` blocks — we do NOT execute them ourselves. The backend must be updated to:

- Pass the Anthropic server tool definition (not our custom tool format)
- Handle `server_tool_use` and `web_search_tool_result` content block types in the response
- Use streaming (SSE) instead of the current non-streaming request + character-by-character emit pattern
- Emit citation data to the frontend alongside text chunks

**Tool configuration:**

```json
{
  "type": "web_search_20260209",
  "name": "web_search",
  "max_uses": 5
}
```

**Required headers for dynamic filtering:**

- `anthropic-beta: code-execution-web-tools-2026-02-09`

**Pricing:** $10 per 1,000 searches + standard token costs.

### OpenAI — Migration to Responses API

The current OpenAI implementation uses the Chat Completions API (`/v1/chat/completions`) with `gpt-4-turbo-preview`. OpenAI's web search is available through their newer Responses API (`/v1/responses`), which is the recommended API going forward.

**Migration scope:**

1. Replace `/v1/chat/completions` with `/v1/responses` endpoint
2. Update request format (messages → `input`, tools use `type: "web_search"`)
3. Update response parsing (different SSE event format)
4. Update model to `gpt-4o` or later (supports web search)
5. Handle web search results and citations in the response stream

**OpenAI web search tool:**

```json
{
  "type": "web_search",
  "search_context_size": "medium"
}
```

**Note:** OpenAI Responses API has a different streaming format than Chat Completions. The SSE events use types like `response.output_text.delta` instead of `choices[0].delta.content`.

### Ollama — Future Search Provider (Low Priority)

Ollama models run locally and have no built-in web search capability. Supporting web search for Ollama would require a pluggable search provider (e.g., SearXNG, Brave Search API, or a self-hosted search service).

**Requirements to document (not implement now):**

- Define a `SearchProvider` interface in the backend that Ollama could use
- The existing DuckDuckGo tool code can serve as a starting point but needs a real search API
- Configuration: search provider URL and optional API key in settings
- When Ollama is selected and search is enabled, fall back to the pluggable provider

**This is explicitly deferred.** When a user enables search with Ollama selected, show a toast: "Web search is not yet available for Ollama. Please use Anthropic or OpenAI for search."

### Removing DuckDuckGo Implementation

The existing `tools.rs` with its DuckDuckGo Instant Answer API, `ToolDefinition`, `ToolCall`, `ToolResult` structs, `execute_tool()`, and the format conversion functions (`tools_to_anthropic_format`, `tools_to_openai_format`) will be removed. The provider-native tools replace all of this.

## UI/UX

### Search Toggle in Chat Input Footer

Add a search toggle button to the chat input footer bar, alongside the existing persona selector and project selector.

**Design:**

- Icon: `Globe` from lucide-react (consistent with web/search metaphor)
- Label: "Search" (shown next to icon)
- Behavior: click to toggle on/off
- Active state: text becomes `foreground` color (matching active persona selector style)
- Inactive state: `muted-foreground` color (matching inactive footer items)
- Position: after the project selector, before the goals indicator
- Persisted: search preference saved in chat-store (persists across sessions)

**Layout of chat input footer:**

```
[🤖 General Assistant ▴] [📁 Project ▴] [🌐 Search] [🎯 2 goals]  [↑]
```

### Search Status Indicator

When search is active and the AI is searching:

- Show existing `activeTool` indicator: "Searching the web..." with spinner
- This already exists in `ChatPanel.tsx` for `activeTool === 'web_search'`

### Citation Display in Chat Messages

Search responses include citations. Display them inline:

- Cited text segments are visually distinct (e.g., slightly different background or left border)
- Each citation has a small superscript link number
- At the bottom of the message, list sources with title + URL
- URLs are clickable (open in system browser via Tauri's `opener` plugin)

**Citation format in message:**

```
Claude Shannon was born on April 30, 1916¹ in Petoskey, Michigan².

---
Sources:
1. Claude Shannon - Wikipedia (https://en.wikipedia.org/wiki/Claude_Shannon)
2. Shannon biography (https://example.com/shannon)
```

### Error States

- **No API key configured:** Search toggle disabled, tooltip: "Configure an AI provider to use search"
- **Ollama selected:** Search toggle disabled, tooltip: "Web search is not available for Ollama"
- **Search rate limited:** Toast notification with error from provider
- **Search fails mid-conversation:** Error displayed inline, conversation continues without search results

## Data Model

### Chat Store Changes (`chat-store.ts`)

```typescript
interface ChatStore {
  // Existing fields...
  webSearchEnabled: boolean;       // User's search toggle state
  setWebSearchEnabled: (enabled: boolean) => void;
}
```

### Streaming Command Changes

Update the `ai_chat_stream` Tauri command signature to accept a search flag:

```rust
#[tauri::command]
pub async fn ai_chat_stream(
    window: tauri::Window,
    messages: Vec<ChatMessage>,
    provider: String,
    api_key: Option<String>,
    ollama_url: Option<String>,
    web_search_enabled: bool,     // NEW
) -> Result<(), String>
```

### New Event Types

Add a new Tauri event for citations:

```typescript
// Emitted alongside ai-stream-chunk when citations are present
interface CitationEvent {
  url: string;
  title: string;
  cited_text: string;
}
// Event name: 'ai-citation'
```

### ChatMessage Type Extension

```typescript
interface Citation {
  url: string;
  title: string;
  citedText: string;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  citations?: Citation[];  // NEW — populated for search-enabled responses
}
```

## Dependencies

### Existing (no new packages needed)

- `reqwest` (Rust) — already used for API calls
- `serde_json` (Rust) — already used for JSON handling
- `lucide-react` — already installed, provides `Globe` icon

### Removed

- DuckDuckGo Instant Answer API dependency (no API key, but also no useful results)
- `urlencoding` crate usage in `tools.rs` (if no longer needed elsewhere)

## Quality Gates

### Functional

- [x]Search toggle appears in chat input footer and persists state

- [x]Toggling search on with Anthropic provider causes AI to search when appropriate

- [x]Search results include citations with clickable source URLs

- [x]"Searching the web..." indicator appears during search

- [x]Search toggle disabled when no provider configured

- [x]Search toggle disabled with tooltip when Ollama is selected

- [x]Toast notification shown when Ollama user tries to enable search

- [x]Multiple searches in one conversation work correctly

- [x]Search works in multi-turn conversations (context preserved)

- [x]Existing chat functionality (no search) continues to work unchanged

- [x]DuckDuckGo tool code fully removed

- [x]OpenAI migrated to Responses API

- [x]OpenAI web search works with search toggle enabled

- [x]OpenAI chat works without search (basic conversation)

- [x]Streaming works correctly for both providers with and without search

### Design

- [x]Search toggle matches existing footer button style (persona/project selectors)

- [x]Active/inactive states use correct palette colors (no chromatic accents)

- [x]Citations are readable and visually distinct without being distracting

- [x]Source URLs are styled as links (underline on hover, `--color-primary`)

- [x]Works correctly in both light and dark mode

- [x]Transitions on toggle state (150ms)

- [x]Search status indicator consistent with existing loading states

## Out of Scope

- **Web fetch tool** — Anthropic also offers `web_fetch` for reading full page contents; defer to future
- **Domain filtering UI** — Anthropic supports `allowed_domains` / `blocked_domains`; could be added later as an advanced setting
- **User location for search** — Anthropic supports `user_location` for localized results; defer
- **Ollama search provider** — documented requirements above, implementation deferred
- **Search result caching** — provider handles this server-side
- **Search cost tracking/limits** — could show estimated cost per search later
- **Inserting search results into editor** — users can copy/paste from chat for now