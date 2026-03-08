# PRD: AI Provider Configuration

**Date:** 2026-03-02 **Updated:** 2026-03-05 **Status:** Complete **Parent:** AI Provider Architecture

## Problem

All AI models are hardcoded in the Rust backend: Anthropic uses `claude-sonnet-4-5-20250929`, OpenAI uses `gpt-4o`, and Ollama uses `llama2`. Users cannot:

1. **Select a model** — Ollama's hardcoded `llama2` is unusable for most users who have different models installed
2. **Choose models per use case** — different models excel at different tasks (e.g., fast model for chat, powerful model for agent tasks)
3. **Configure generation parameters** — no temperature, max tokens, or other options
4. **Use custom API endpoints** — no way to connect to OpenAI-compatible APIs (vLLM, LiteLLM, Together AI, Groq)
5. **Edit an existing connection** — the ConnectionCard settings gear icon exists but does nothing

## Goals

1. Dynamic model fetching from all providers (Anthropic `/v1/models`, OpenAI `/v1/models`, Ollama `/api/tags`) — no hardcoded model lists
2. Per-use-case model selection — different model for interactive chat, agent tasks, and inline completion
3. Manual model name entry as fallback when API listing isn't available
4. Configurable generation parameters: temperature, max tokens
5. Custom base URL support for OpenAI-compatible API endpoints
6. A new "OpenAI-Compatible" provider type for third-party API servers
7. Edit dialog for existing connections (wired to the existing gear icon)

## Non-Goals

- Model selection for ACP agent-managed connections (they handle their own models)
- Streaming parameter configuration (top_p, frequency_penalty, etc.)

## Solution

### Data Model

Add `ConnectionConfig` to the Connection interface for connection-level defaults:

```typescript
export interface ConnectionConfig {
  model?: string;        // Default model for this connection
  temperature?: number;  // 0.0 - 2.0
  maxTokens?: number;    // Provider-specific max
  baseUrl?: string;      // Custom API endpoint override
}

// On Connection:
config?: ConnectionConfig;
```

### Per-Use-Case Model Override

Extend routing from simple connection IDs to objects with optional model:

```typescript
export interface UseCaseSlot {
  connectionId: string | null;
  model?: string;  // Overrides connection's default model for this use case
}

export interface UseCaseRouting {
  interactive: UseCaseSlot;
  agent_tasks: UseCaseSlot;
  inline_completion: UseCaseSlot;
}
```

Model resolution priority: **use-case model override &gt; connection config model &gt; provider default**.

This lets users configure, e.g., Claude Haiku for interactive chat (fast responses) but Claude Opus for agent tasks (complex reasoning), both on the same Anthropic connection.

### Dynamic Model Fetching

A single `list_models` Tauri command that works for all providers:

```rust
#[tauri::command]
pub async fn list_models(
    provider: String,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<String>, String>
```

- **Anthropic**: `GET {base_url}/v1/models` with `x-api-key` header → parse `data[].id`
- **OpenAI**: `GET {base_url}/v1/models` with `Authorization: Bearer` header → parse `data[].id`
- **Ollama**: `GET {base_url}/api/tags` → parse `models[].name`
- **OpenAI-Compatible**: Same as OpenAI format using custom `base_url`

Falls back gracefully — if the API call fails (network, auth, unsupported), the user can still type a model name manually.

### Rust Backend Parameter Changes

Add optional `model`, `temperature`, `max_tokens`, `base_url` parameters to all AI commands (`ai_generate_text`, `ai_chat`, `ai_chat_stream`). All `Option<_>` so existing callers continue working.

Replace hardcoded model strings with `model.unwrap_or("default")`. Replace hardcoded API URLs with `base_url.unwrap_or("https://api.provider.com")`.

Add `openai_compatible` provider functions using the standard Chat Completions API format (`/v1/chat/completions`) instead of OpenAI's Responses API (`/v1/responses`).

### Connection Config Dialog

A new shadcn `Dialog` opened from the existing ConnectionCard settings gear icon:

- **Model**: Combobox that fetches available models from the provider API on open (with loading spinner + refresh button). Free-text input for manually typing model names when API is unavailable.
- **Temperature**: Number input, range 0.0–2.0
- **Max Tokens**: Number input
- **Base URL**: Text input, shown for `api_key` and `openai_compatible` connections. Required for `openai_compatible`.
- **API Key**: Masked input with show/hide toggle (only for `api_key` auth)

### Use Case Routing: Model Selector

Extend the Advanced Routing section in settings. Below each use-case connection dropdown, add a model selector:

- Fetches models from the selected connection's provider
- Shows "Default" option (uses connection's configured default model)
- Free-text input for custom model names

### Add Connection: OpenAI-Compatible

New entry in the "Add Connection" provider list:

- Label: "OpenAI-Compatible"
- Description: "vLLM, LiteLLM, Together AI, or any compatible API"
- Auth method: `api_key`
- Required fields: base URL, model, API key

## Architecture

### Layers Affected

1. **Data model** (`connections.ts`) — `ConnectionConfig`, `UseCaseSlot`, provider type expansion
2. **Rust backend** (`ai.rs`, `ai_streaming.rs`) — parameterized models/URLs, `list_models` command
3. **Frontend providers** (`providers/*.ts`, `index.ts`) — pass config to Tauri
4. **Routing store** (`routing-store.ts`) — `UseCaseSlot` objects instead of plain IDs
5. **Hook layer** (`useAIOperations.ts`) — merge use-case model with connection config
6. **Settings UI** — `ConnectionConfigDialog.tsx`, `UseCaseRoutingSettings.tsx`, `ConnectionsSettings.tsx`, `ConnectionCard.tsx`

### Backward Compatibility

- `config` is optional on `Connection` — existing persisted connections work unchanged
- Routing store migration: existing `string | null` values migrated to `UseCaseSlot` objects on rehydration
- All Rust parameters are `Option<_>` — existing frontend code that doesn't pass them works unchanged

## Acceptance Criteria

- [x] Can change model on Anthropic connection — model dropdown fetches from Anthropic API

- [x] Can change model on OpenAI connection — model dropdown fetches from OpenAI API

- [x] Ollama config dialog fetches and lists available models from running instance

- [x] Can type a custom model name manually in any provider

- [x]Per-use-case model override works (e.g., Haiku for chat, Opus for agent tasks)

- [x] Can add "OpenAI-Compatible" connection with custom base URL, model, and API key

- [x] Temperature setting affects response style

- [x] Existing connections with no config continue working with hardcoded defaults

- [x] ConnectionCard shows configured model as a badge

- [x] Settings gear icon opens the config dialog