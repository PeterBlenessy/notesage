# AI Provider Configuration — Implementation Tasks

**PRD:** `docs/prds/2026-03-02-ai-provider-configuration.md`**Total: 9 tasks — 2S, 3M, 4LSuggested order:** Data model → Rust backend → Frontend providers → Tauri wrapper → Hook layer → Routing store migration → Config dialog → Routing UI model selector → Add connection flow

---

## #1 — Extend data model with ConnectionConfig and UseCaseSlot

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | none |
| **Files** | `src/lib/ai/connections.ts`, `src/lib/ai/types.ts` |

Add `ConnectionConfig` interface, per-use-case model slots, and OpenAI-compatible provider type.

**Implement:**

- Add `ConnectionConfig` interface: `model?: string`, `temperature?: number`, `maxTokens?: number`, `baseUrl?: string`
- Add `config?: ConnectionConfig` to the `Connection` interface
- Add `UseCaseSlot` interface: `{ connectionId: string | null; model?: string }`
- Change `UseCaseRouting` from `string | null` per slot to `UseCaseSlot` per slot
- Update `EMPTY_ROUTING` to use `{ connectionId: null }` objects
- Add `'openai_compatible'` to `ConnectionProvider` type
- Add `openai_compatible` entry to `PROVIDER_CAPABILITIES`: `{ api_key: ['interactive', 'agent_tasks'] }`
- Add `openai_compatible` entry to `PROVIDER_OPTIONS`
- Add `DEFAULT_MODELS` constant mapping each provider to its default model string
- Add `'openai_compatible'` to `AIProviderType` in `types.ts`

**Acceptance:**

- [ ] TypeScript compiles with new types

- [ ] Existing connection creation still works (config is optional)

---

## #2 — Add model/temperature/baseUrl params to Rust AI commands

|  |  |
| --- | --- |
| **Complexity** | L |
| **Category** | backend |
| **Dependencies** | none |
| **Files** | `src-tauri/src/commands/ai.rs`, `src-tauri/src/commands/ai_streaming.rs` |

Parameterize all hardcoded models, URLs, and generation options in the Rust backend.

**Implement:**

- Add `model: Option<String>`, `temperature: Option<f64>`, `max_tokens: Option<u32>`, `base_url: Option<String>` to `AIRequest` struct
- Add same params to `ai_chat` and `ai_chat_stream` command signatures
- Pass through to each provider function
- Replace hardcoded model strings: `model.unwrap_or("claude-sonnet-4-5-20250929")` etc.
- Replace hardcoded API URLs: `base_url.unwrap_or("https://api.anthropic.com")` etc.
- Add temperature to JSON body when `Some`
- Use max_tokens with fallback: `max_tokens.unwrap_or(4096)`
- Same changes in `ai_streaming.rs` for all three streaming functions

**Acceptance:**

- [ ] `cargo build` succeeds

- [ ] Existing frontend calls (no new params) still work

- [ ] Passing a custom model via invoke changes the model used

---

## #3 — Add openai_compatible provider to Rust backend

|  |  |
| --- | --- |
| **Complexity** | L |
| **Category** | backend |
| **Dependencies** | #2 |
| **Files** | `src-tauri/src/commands/ai.rs`, `src-tauri/src/commands/ai_streaming.rs` |

Add provider functions for OpenAI-compatible APIs using the standard Chat Completions format.

**Implement:**

- Add `openai_compatible_generate(request)` — `POST {base_url}/v1/chat/completions` non-streaming
- Add `openai_compatible_chat(messages, api_key, model, temperature, max_tokens, base_url)` — non-streaming
- Add `openai_compatible_chat_stream(window, messages, api_key, model, temperature, max_tokens, base_url)` — SSE streaming with `data: [DONE]` terminator
- Request format: `{ model, messages: [{role, content}], temperature?, max_tokens?, stream }`
- Response format: `{ choices: [{ message: { content } }] }` (non-streaming), SSE `data: { choices: [{ delta: { content } }] }` (streaming)
- Dispatch in `ai_generate_text`, `ai_chat`, `ai_chat_stream`: `"openai_compatible" => ...`
- `base_url` is required for this provider (error if None)

**Acceptance:**

- [ ] Can invoke `ai_chat_stream` with `provider: "openai_compatible"` and a valid base URL

- [ ] Streaming works with standard Chat Completions SSE format

---

## #4 — Add list_models Tauri command

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | backend + frontend |
| **Dependencies** | none |
| **Files** | `src-tauri/src/commands/ai.rs`, `src-tauri/src/lib.rs`, `src/lib/tauri.ts` |

Fetch available models dynamically from any provider's API.

**Implement:**

- Add `list_models(provider: String, api_key: Option<String>, base_url: Option<String>) -> Result<Vec<String>, String>` Tauri command
- **Anthropic**: `GET {base_url|https://api.anthropic.com}/v1/models` with `x-api-key` header, parse `data[].id`
- **OpenAI**: `GET {base_url|https://api.openai.com}/v1/models` with `Authorization: Bearer` header, parse `data[].id`
- **Ollama**: `GET {base_url|http://localhost:11434}/api/tags`, parse `models[].name`
- **openai_compatible**: Same as OpenAI format using custom `base_url`
- Register in `generate_handler![]` in `lib.rs`
- Add `listModels(provider: string, apiKey?: string, baseUrl?: string): Promise<string[]>` to `tauriApi` in `tauri.ts`

**Acceptance:**

- [ ] With valid Anthropic API key, returns Anthropic model IDs

- [ ] With valid OpenAI API key, returns OpenAI model IDs

- [ ] With Ollama running, returns installed model names

- [ ] Returns error message when provider is unreachable or auth fails

---

## #5 — Update frontend providers to accept ConnectionConfig

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #1, #2 |
| **Files** | `src/lib/ai/providers/anthropic.ts`, `openai.ts`, `ollama.ts`, `src/lib/ai/providers/openai-compatible.ts` (new), `src/lib/ai/index.ts` |

Pass model, temperature, maxTokens, and baseUrl from ConnectionConfig through to Tauri invoke calls.

**Implement:**

- Update `AnthropicProvider`, `OpenAIProvider`, `OllamaProvider` constructors to accept optional `ConnectionConfig`
- In each `generateText()` and `chat()` method, include config fields in the invoke request object
- Create `OpenAICompatibleProvider` class — same pattern, passes `'openai_compatible'` as provider string
- Update `getAIProvider()` factory to accept optional `ConnectionConfig` parameter
- Update `getAIProviderFromConnection()` to pass `connection.config` to factory
- Handle `'openai_compatible'` provider type in factory

**Acceptance:**

- [ ] TypeScript compiles

- [ ] Provider classes pass config fields to Tauri when present

- [ ] `getAIProviderFromConnection` works for all provider types including `openai_compatible`

---

## #6 — Migrate routing store to UseCaseSlot and propagate config

|  |  |
| --- | --- |
| **Complexity** | M |
| **Category** | frontend |
| **Dependencies** | #1, #5 |
| **Files** | `src/stores/routing-store.ts`, `src/hooks/useAIOperations.ts` |

Migrate routing store from `string | null` to `UseCaseSlot` objects and propagate model through AI operations.

**Implement:**

- Update `RoutingStore` to use `UseCaseSlot` objects
- Update `setRouting` to accept `(useCase, connectionId, model?)` — sets both fields
- Add `setUseCaseModel(useCase, model)` action for changing just the model
- Add `getModelForUseCase(useCase)` helper that returns the model string
- Add Zustand persist migration: detect old format (`string | null`), convert to `UseCaseSlot` objects
- Update `resolveConnectionCredentials` in `useAIOperations.ts` to merge use-case model with connection config
- Model resolution: use-case model &gt; connection config model &gt; provider default
- Pass resolved model to `ai_chat_stream` invoke and `getAIProvider` calls

**Acceptance:**

- [ ] Existing persisted routing (string IDs) migrates cleanly to UseCaseSlot objects

- [ ] Per-use-case model override takes priority over connection default

- [ ] Chat and inline actions use the resolved model

---

## #7 — Create ConnectionConfigDialog

|  |  |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | #1, #4 |
| **Files** | `src/components/settings/ConnectionConfigDialog.tsx` (new), `src/components/settings/ConnectionsSettings.tsx`, `src/components/settings/ConnectionCard.tsx` |

Build the settings dialog for editing connection configuration and wire it to the existing gear icon.

**Implement:**

- Create `ConnectionConfigDialog` as a shadcn `Dialog` with:
  - **Model**: Combobox that fetches models from `listModels()` on open (loading spinner, refresh button, error state). Free-text input for manually typing model names. For `openai_compatible`: text input (required).
  - **Temperature**: `Input` type=number, step=0.1, min=0, max=2, placeholder "Default"
  - **Max Tokens**: `Input` type=number, placeholder "4096"
  - **Base URL**: `Input` for `api_key` and `openai_compatible`. Required for `openai_compatible`. Placeholder shows provider default URL.
  - **API Key**: `Input` with show/hide toggle (only `api_key` auth), pre-filled
  - **Save / Cancel** footer
- On save: `updateConnection(id, { config, credentials })` from connections-store
- In `ConnectionsSettings.tsx`: add state, pass `onConfigure` to `ConnectionCard`, render dialog
- In `ConnectionCard.tsx`: show model badge when `connection.config?.model` is set

**Acceptance:**

- [ ] Clicking gear icon opens config dialog

- [ ] Model dropdown fetches models from Anthropic/OpenAI/Ollama APIs

- [ ] Can manually type a model name

- [ ] Saving updates connection config

- [ ] ConnectionCard shows model badge

---

## #8 — Add model selector to Advanced Routing UI

|  |  |
| --- | --- |
| **Complexity** | L |
| **Category** | frontend |
| **Dependencies** | #4, #6 |
| **Files** | `src/components/settings/UseCaseRoutingSettings.tsx` |

Add per-use-case model selection below each connection dropdown in Advanced Routing.

**Implement:**

- Below each use-case connection `Select`, add a model selector row (only visible when a connection is assigned)
- Model selector: Combobox that fetches models from `listModels()` using the selected connection's provider and credentials
- "Default" option uses the connection's configured default model
- Free-text input for custom model names
- On change: call `setUseCaseModel(useCase, model)`
- Show current model or "Default" as selected value

**Acceptance:**

- [ ] Model selector appears below each use-case connection dropdown

- [ ] Fetches models from the assigned connection's provider

- [ ] Setting a model override uses it for that use case

- [ ] "Default" clears the override, falling back to connection config

---

## #9 — Add OpenAI-Compatible to add-connection flow + provider logo

|  |  |
| --- | --- |
| **Complexity** | S |
| **Category** | frontend |
| **Dependencies** | #1, #7 |
| **Files** | `src/components/settings/ConnectionsSettings.tsx`, provider logo component |

Add the OpenAI-Compatible provider option to the add-connection popover.

**Implement:**

- Add `openai_compatible` to the provider picker list in `ConnectionsSettings.tsx`
- Configure form: base URL (required), API key (required), model (required) — same pattern as existing providers
- On create: connection saved with `config: { baseUrl, model }` + `credentials: { type: 'api_key', key }`
- Add `openai_compatible` case in provider logo rendering — use `Server` icon from lucide-react
- Ensure routing auto-assignment works for `openai_compatible` connections

**Acceptance:**

- [ ] "OpenAI-Compatible" appears in the add connection provider list

- [ ] Can create connection with base URL + API key + model

- [ ] Connection shows Server icon and correct capabilities

- [ ] Chat works through the new OpenAI-Compatible connection