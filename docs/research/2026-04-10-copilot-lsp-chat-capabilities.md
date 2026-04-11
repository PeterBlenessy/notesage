# Research: Copilot LSP Chat & Model Access Capabilities

**Date:** 2026-04-10  **Status:** Research complete

| Stage | Link | Status |
| --- | --- | --- |
| PRD | [copilot-lsp-chat](../prds/2026-04-10-copilot-lsp-chat.md) | Draft |
| Tasks | [copilot-lsp-chat-tasks](../tasks/2026-04-10-copilot-lsp-chat-tasks.md) | Not started |

**Purpose:** Investigate how to use GitHub Copilot subscription models (GPT-4o, Claude, Gemini) for chat conversations when Copilot CLI (ACP) is unavailable. The current Copilot LSP connection is restricted to `['inline_completion']` only.

---

## 1. The Copilot LSP Already Supports Chat

The `copilot-language-server` binary (`@github/copilot-language-server` npm package) ships with **full conversation/chat methods** that are functional but undocumented in the official SDK docs.

### Confirmed conversation methods

| Method | Direction | Purpose |
| --- | --- | --- |
| `conversation/create` | Client → Server | Create a new chat session, returns a conversation reference |
| `conversation/turn` | Client → Server | Send a user message, stream an AI response |
| `conversation/destroy` | Client → Server | Close a conversation session |
| `conversation/rating` | Client → Server | Submit feedback on response quality |
| `conversation/templates` | Client → Server | Retrieve available prompt templates |
| `conversation/agents` | Client → Server | Retrieve available agent configurations |
| `conversation/registerTools` | Client → Server | Register MCP tools for agent mode |
| `conversation/invokeClientTool` | Server → Client | Server requests the client to execute a tool |
| `conversation/invokeClientToolConfirmation` | Server → Client | Server requests user confirmation before tool execution |
| `conversation/context` | Server → Client | Server requests context (e.g., current editor content) |

Streaming uses the LSP `$/progress` mechanism with a `workDoneToken`.

### Evidence

- **CopilotForXcode** (github/CopilotForXcode) — GitHub's own official Xcode integration. Implements all `conversation/*` methods through its `GitHubCopilotConversationServiceType` interface. Source: [DeepWiki: CopilotForXcode LSP](https://deepwiki.com/github/CopilotForXcode/3.1-language-server-protocol)
- **copilot.el** (Emacs) — PR #446 added `conversation/create`, `conversation/turn`, `conversation/destroy`, `$/progress` streaming, and `conversation/context` handling. Single file implementation alongside existing completion code. Source: [copilot.el PR #446](https://github.com/copilot-emacs/copilot.el/pull/446)
- **Zed editor** — Uses `copilot_chat` as a provider in the Agent Panel. Supports model selection (Claude, GPT-4o, etc.) through Copilot. Source: [Zed Copilot blog](https://zed.dev/blog/copilot)
- **copilot-language-server-release Issue #1** — "Please enable copilot chat and agent support" with 171 thumbs-up. A GitHub staff member (Tim Pope) acknowledged the request in Feb 2025. The issue author noted the methods are already in the binary but not officially exposed. Source: [github/copilot-language-server-release#1](https://github.com/github/copilot-language-server-release/issues/1)

### Additional LSP methods (non-chat)

Already used by Notesage:
- `textDocument/inlineCompletion` — ghost text completions

Available but not yet used:
- `textDocument/copilotPanelCompletion` — panel-style multi-line completions with `partialResultToken` streaming
- `textDocument/copilotInlineEdit` — "next edit suggestions" (inline edits with deletions/modifications)

---

## 2. Alternative Approaches

### Option A: Direct Copilot API (what Neovim plugins use)

**Endpoint:** `https://api.githubcopilot.com/chat/completions` (OpenAI-compatible)

**Authentication flow:**
1. OAuth device flow with GitHub → obtains `gho_xxx` token (we already do this)
2. Token exchange: `GET https://api.github.com/copilot_internal/v2/token` with the OAuth token → returns a short-lived Copilot bearer token (~25 min expiry) with an `endpoints.api` field
3. Use the bearer token with OpenAI-compatible request format

**Required headers:**
- `Authorization: Bearer <copilot_token>`
- `Content-Type: application/json`
- `Copilot-Integration-Id: vscode-chat` (or similar)

**Implementations using this approach:**
- [CopilotChat.nvim](https://github.com/CopilotC-Nvim/CopilotChat.nvim) — configurable provider system, token exchange, model discovery via `/models`
- [avante.nvim](https://github.com/yetone/avante.nvim) — dedicated `copilot.lua` provider with token expiration handling
- [copilot-api proxy](https://github.com/ericc-ch/copilot-api) — exposes OpenAI and Anthropic-compatible endpoints
- [copilot-chat.el](https://github.com/chep/copilot-chat.el) — Emacs package using the REST approach
- [aider](https://aider.chat/docs/llms/github.html) — uses `api.githubcopilot.com` as an OpenAI-compatible base URL

**Pros:** Simple HTTP, reuses existing streaming infrastructure, well-understood from Neovim ecosystem.
**Cons:** Undocumented internal API. Could break or violate ToS.

### Option B: GitHub Models API

**Endpoint:** `https://models.github.ai/inference` (OpenAI-compatible)

**Authentication:** GitHub PAT with `models:read` scope.

**Models:** GPT-4o, GPT-4o mini, GPT-4.1, Llama 3.1, Phi-3, DeepSeek-R1, Mistral. **No Claude, no Gemini.**

**Pros:** Officially supported. Standard PAT auth.
**Cons:** Limited model selection — the main appeal of Copilot (Claude, Gemini access) is missing.

Source: [GitHub Models docs](https://docs.github.com/en/github-models/quickstart)

### Option C: Copilot SDK

**Package:** `@github/copilot-sdk` (TypeScript, Python, Go, .NET)

**Architecture:** Wraps Copilot CLI in server mode on a local port. Provides `createSession()`, `send()`, `sendAndWait()`.

**Status:** Public preview (April 2, 2026). Supports multi-turn conversations, tool calling, BYOK.

**Pros:** Official, full model access, tool support.
**Cons:** Requires Copilot CLI as a dependency — essentially the same as our existing ACP approach. High implementation effort for minimal benefit over ACP.

Source: [Copilot SDK repo](https://github.com/github/copilot-sdk), [announcement](https://github.blog/news-insights/company-news/build-an-agent-into-any-app-with-the-github-copilot-sdk/)

---

## 3. Comparison Matrix

| Approach | Models | Official? | Effort | Auth reuse | Streaming |
| --- | --- | --- | --- | --- | --- |
| **LSP `conversation/*`** | All Copilot (GPT, Claude, Gemini) | Semi (used by GitHub's own CopilotForXcode) | Medium | Yes (same LSP process) | `$/progress` |
| **Direct API** (`api.githubcopilot.com`) | All Copilot | No (undocumented) | Low | Partial (token exchange needed) | SSE |
| **GitHub Models** (`models.github.ai`) | Limited (no Claude/Gemini) | Yes | Low | No (separate PAT) | SSE |
| **Copilot SDK** | All Copilot | Yes (preview) | High | No (needs CLI) | SDK methods |

---

## 4. Recommendation

**Primary: LSP `conversation/*` methods** (Option 1 in the PRD)

Rationale:
- We already spawn and manage the `copilot-language-server` process
- We already have JSON-RPC infrastructure for it (`copilot_lsp.rs`, `json_rpc.rs`)
- It's the approach used by GitHub's own CopilotForXcode project
- Full access to all Copilot subscription models including Claude and Gemini
- No additional processes, no undocumented REST endpoints
- The `conversation/context` callback lets us provide editor context for better responses

**Fallback: Direct Copilot API** (Option A above)

If the LSP conversation methods prove too limited or unstable, the direct API approach is well-proven in the Neovim ecosystem and would reuse our existing OpenAI-compatible streaming infrastructure. The OAuth token we already obtain can be exchanged for a Copilot API token.

---

## 5. Key References

- [copilot-language-server-release](https://github.com/github/copilot-language-server-release) — official LSP release repo
- [copilot-language-server-release Issue #1](https://github.com/github/copilot-language-server-release/issues/1) — chat/agent support request (171 thumbs-up)
- [CopilotForXcode](https://github.com/github/CopilotForXcode) — GitHub's official Xcode integration (reference for `conversation/*` methods)
- [copilot.el PR #446](https://github.com/copilot-emacs/copilot.el/pull/446) — Emacs chat implementation
- [CopilotChat.nvim](https://github.com/CopilotC-Nvim/CopilotChat.nvim) — Neovim chat (direct API approach)
- [avante.nvim copilot provider](https://github.com/yetone/avante.nvim/blob/main/lua/avante/providers/copilot.lua) — token exchange reference
- [copilot-api proxy](https://github.com/ericc-ch/copilot-api) — reverse-engineered OpenAI/Anthropic-compatible proxy
- [@github/copilot-language-server on npm](https://www.npmjs.com/package/@github/copilot-language-server)
- [Copilot SDK](https://github.com/github/copilot-sdk) — official SDK (public preview)
- [GitHub Models docs](https://docs.github.com/en/github-models/quickstart)
- [Reverse Engineering Github Copilot](https://bootk.id/posts/copilot/) — token exchange flow details
- [knilink/language-server-ts](https://github.com/nicolo-ribaudo/language-server-ts) — server-side TypeBox schemas for conversation methods

---

## 6. Protocol Spike Results (Task #1)

Researched from CopilotForXcode, copilot.el, and the server-side TypeScript source (`knilink/language-server-ts`).

### conversation/create (client → server)

Creates a conversation and sends the first turn. Streaming via `$/progress`.

```json
{
  "workDoneToken": "copilot-chat-{timestamp}",
  "turns": [{
    "request": "User message here"
  }],
  "capabilities": { "skills": ["current-editor"], "allSkills": true },
  "doc": {
    "uri": "file:///path/to/file",
    "position": { "line": 10, "character": 5 },
    "selection": { "start": {...}, "end": {...} }
  },
  "model": "gpt-4o",
  "workspaceFolder": "file:///path/to/project",
  "source": "panel"
}
```

**Response** (returned AFTER all `$/progress` notifications):
```json
{
  "conversationId": "conv-uuid",
  "turnId": "turn-uuid"
}
```

### conversation/turn (client → server)

Follow-up message in existing conversation.

```json
{
  "workDoneToken": "copilot-chat-{timestamp}",
  "conversationId": "conv-uuid",
  "message": "Follow-up question",
  "model": "gpt-4o",
  "doc": { "uri": "file:///..." },
  "source": "panel"
}
```

**Response:** Same as create.

### conversation/destroy (client → server)

```json
{ "conversationId": "conv-uuid" }
```

**Response:** `"OK"` (string literal)

### copilot/models (client → server)

**Note:** Method is `copilot/models`, NOT `conversation/models`.

**Params:** `{}`

**Response:**
```json
[{
  "id": "gpt-4o",
  "modelFamily": "gpt-4o",
  "modelName": "GPT-4o",
  "scopes": ["chat-panel", "edit-panel", "inline"],
  "preview": false,
  "isChatDefault": true
}]
```

Filter by `scopes` containing `"chat-panel"` for chat-eligible models.

### conversation/registerTools (client → server)

Request (not notification). Send after conversation/create.

```json
{
  "tools": [{
    "name": "readFile",
    "description": "Read a file from the workspace",
    "inputSchema": {
      "type": "object",
      "properties": { "path": { "type": "string" } },
      "required": ["path"]
    }
  }]
}
```

**Response:** Resolved `LanguageModelTool[]` array.

### $/progress (server → client notification)

Uses `workDoneToken` for correlation. Three lifecycle kinds:

**Begin:**
```json
{
  "token": "copilot-chat-{timestamp}",
  "value": {
    "kind": "begin",
    "title": "Conversation conv-uuid Turn turn-uuid",
    "conversationId": "conv-uuid",
    "turnId": "turn-uuid"
  }
}
```

**Report** (text streaming + tool call rounds):
```json
{
  "token": "copilot-chat-{timestamp}",
  "value": {
    "kind": "report",
    "conversationId": "conv-uuid",
    "turnId": "turn-uuid",
    "reply": "Text delta chunk here...",
    "steps": [{ "id": "step-id", "title": "Searching...", "status": "running" }],
    "editAgentRounds": [{
      "roundId": 1,
      "reply": "Let me read that file...",
      "toolCalls": [{
        "id": "tc-uuid",
        "name": "readFile",
        "status": "completed",
        "input": { "path": "/src/main.ts" },
        "result": [{ "type": "text", "value": "file contents..." }]
      }]
    }],
    "notifications": [{ "message": "Searching workspace...", "severity": "info" }]
  }
}
```

**End:**
```json
{
  "token": "copilot-chat-{timestamp}",
  "value": {
    "kind": "end",
    "conversationId": "conv-uuid",
    "turnId": "turn-uuid",
    "followUp": { "message": "Would you like me to explain?", "id": "fu-uuid" },
    "suggestedTitle": "Code explanation",
    "error": null
  }
}
```

**Key:** The `reply` field contains incremental text chunks (deltas). Client must concatenate.

### conversation/context (server → client request)

Server asks for editor context during turn processing.

```json
{
  "conversationId": "conv-uuid",
  "turnId": "turn-uuid",
  "skillId": "current-editor"
}
```

**Client responds with `[result, error]` tuple:**
```json
[{
  "uri": "file:///path/to/file.ts",
  "source": "file contents...",
  "position": { "line": 10, "character": 0 },
  "languageId": "typescript"
}, null]
```

Unknown skills: respond with `[null, null]`.

### conversation/invokeClientTool (server → client request)

```json
{
  "name": "readFile",
  "input": { "path": "/src/main.ts" },
  "conversationId": "conv-uuid",
  "turnId": "turn-uuid",
  "toolCallId": "toolcall-uuid"
}
```

**Client responds:**
```json
{
  "status": "success",
  "content": [{ "value": "file contents here..." }]
}
```

### conversation/invokeClientToolConfirmation (server → client request)

Same params as `invokeClientTool`.

**Client responds:**
```json
{ "result": "accept" }
```

Values: `"accept"` or `"dismiss"`.

### Key implementation notes

1. **`workDoneToken` is the correlation key** — generate as `"copilot-chat-{timestamp}"`
2. **Response arrives AFTER streaming** — the create/turn JSON-RPC response is sent after all `$/progress` notifications complete
3. **Server calls `conversation/context` mid-processing** — client must respond before turn completes
4. **`conversation/create` takes a `turns` array** — first entry has `request` (the user message), NOT a `message` field
5. **Model listing is `copilot/models`**, not under `conversation/` namespace
6. **CopilotChat.nvim uses REST API directly** — NOT the LSP conversation methods
