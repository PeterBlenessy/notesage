# Secure Credential Storage — Task Breakdown

|  |  |
| --- | --- |
| **Date** | 2026-03-24 |
| **Status** | Complete |
| **PRD** | [secure-credential-storage](../prds/2026-03-14-secure-credential-storage.md) |
| **Total** | 9 tasks: 2S, 5M, 2L |
| **Suggested order** | Backend (#1-#4) → Store (#5) → Frontend (#6-#8) → Migration (#9) |

**Risks / open questions:**

- OpenAI-compatible connections store `api_key` in credentials AND `baseUrl` in config — both paths must update
- Agent-managed connections with `envVars` (e.g., Gemini CLI API key) should also migrate to keychain
- `openai_completions_fim` and `list_models` also receive `api_key` — must be updated alongside the main AI commands
- If the signing identity or bundle ID ever changes, macOS Keychain would deny access to previously stored credentials (users would need to re-enter keys)

---

## Task 1: Add `keyring` crate and credential Tauri commands

- [x] **Done**

**Description:** Add the `keyring` crate to `Cargo.toml`. Create `src-tauri/src/commands/credentials.rs` with four Tauri commands: `store_credential`, `get_credential`, `delete_credential`, and an internal `get_credential_internal()` helper (not a Tauri command) for use by other Rust modules. Use `"notesage:<connection-id>"` as the service name and `"api_key"` as the account/user. Register commands in `lib.rs`.

**Complexity:** M **Category:** backend **Dependencies:** None

**Files:**

- `src-tauri/Cargo.toml` — add `keyring` dependency
- `src-tauri/src/commands/credentials.rs` — new file with `store_credential`, `get_credential`, `delete_credential`, `get_credential_internal`
- `src-tauri/src/commands/mod.rs` — add `pub mod credentials;`
- `src-tauri/src/lib.rs` — register new commands in `generate_handler![]`

**Acceptance criteria:**

- `store_credential("notesage:conn-123", "sk-ant-...")` stores in macOS Keychain
- `get_credential("notesage:conn-123")` retrieves it
- `delete_credential("notesage:conn-123")` removes it
- Verify with `security find-generic-password -s notesage:conn-123` in Terminal
- Graceful error message if keychain is unavailable

---

## Task 2: Add `migrate_credentials` Tauri command

- [x] **Done**

**Description:** Add a `migrate_credentials` command that accepts the raw `notesage-connections` localStorage JSON string, parses it, extracts `key` from each `api_key` credential, and stores each in the keychain. Also migrates `envVars` from agent-managed credentials (e.g., Gemini CLI API keys). Returns the count of migrated credentials.

**Complexity:** M **Category:** backend **Dependencies:** Depends on #1

**Files:**

- `src-tauri/src/commands/credentials.rs` — add `migrate_credentials` command
- `src-tauri/src/lib.rs` — register in `generate_handler![]`

**Acceptance criteria:**

- Given a JSON string with 2 api_key connections, migrates both to keychain and returns `2`
- Skips connections without `key` field (already migrated or non-api_key types)
- Handles malformed JSON gracefully with error message

---

## Task 3: Refactor AI commands to resolve keys from keychain

- [x] **Done**

**Description:** Modify `ai_chat_stream`, `ai_chat`, `ai_generate_text` to accept `connection_id: Option<String>` alongside the existing `api_key: Option<String>` parameter. When `connection_id` is provided, resolve the key from keychain via `get_credential_internal`. This allows a gradual migration — both paths work during the transition. Also update `list_models` and `openai_completions_fim`.

**Complexity:** L **Category:** backend **Dependencies:** Depends on #1

**Files:**

- `src-tauri/src/commands/ai.rs` — add `connection_id: Option<String>` to `ai_chat_stream`, `ai_chat`, `ai_generate_text`, `list_models`, `openai_completions_fim`; resolve key from keychain when `connection_id` is provided and `api_key` is `None`

**Acceptance criteria:**

- `ai_chat_stream` with `connectionId` (no `apiKey`) reads key from keychain and works
- `ai_chat_stream` with `apiKey` (no `connectionId`) still works (backward compat)
- `list_models` and `openai_completions_fim` support the same dual-path
- Ollama/local_bundled connections unaffected (no api_key involved)

---

## Task 4: Update `AIRequest` struct

- [x] **Done**

**Description:** Add `connection_id: Option<String>` to the `AIRequest` struct used by `ai_generate_text`. The key resolution logic mirrors task #3.

**Complexity:** S **Category:** backend **Dependencies:** Depends on #3

**Files:**

- `src-tauri/src/commands/ai.rs` — add `connection_id` field to `AIRequest`

**Acceptance criteria:**

- `ai_generate_text` resolves key from keychain when `connectionId` is present in the request

---

## Task 5: Update `ConnectionCredentials` type and connections store

- [x] **Done**

**Description:** Change the `api_key` variant of `ConnectionCredentials` from `{ type: 'api_key'; key: string }` to `{ type: 'api_key'; key?: string; credentialStored?: boolean }`. Make `key` optional so it can be omitted after migration. Add `credentialStored` flag. Update `addConnection` in `connections-store.ts` to NOT store the key in Zustand — instead, call `invoke('store_credential')` first, then save the connection with `credentialStored: true` (no `key`). Update `removeConnection` to call `invoke('delete_credential')` to clean up the keychain entry.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #1

**Files:**

- `src/lib/ai/connections.ts` — update `ConnectionCredentials` type
- `src/stores/connections-store.ts` — update `addConnection` to store key via Tauri command, update `removeConnection` to delete keychain entry

**Acceptance criteria:**

- New connections store key in keychain, not in localStorage
- `localStorage.getItem('notesage-connections')` contains no `key` fields for new connections
- Removing a connection deletes the keychain entry
- `credentialStored: true` flag set on connections with stored credentials

---

## Task 6: Update ConnectionsSettings to use credential commands

- [x] **Done**

**Description:** Update the save flow in `ConnectionsSettings.tsx` so that when a user enters an API key, it calls `invoke('store_credential')` and then `addConnection()` without the key. The key should only exist in the input field's React state — never in Zustand. Update the OpenAI-compatible flow (which we just fixed today) similarly.

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #5

**Files:**

- `src/components/settings/ConnectionsSettings.tsx` — update `handleSave` to call `store_credential` before `addConnection`, pass `credentialStored: true` instead of `key`

**Acceptance criteria:**

- Entering an API key in Settings stores it in keychain
- The key never appears in localStorage
- OpenAI-compatible connections (including the new multi-instance support) work correctly
- Error toast shown if keychain storage fails

---

## Task 7: Update `useAIOperations` to pass `connectionId` instead of `apiKey`

- [x] **Done**

**Description:** Modify `resolveConnectionCredentials()` in `useAIOperations.ts` to return `connectionId` instead of extracting `apiKey`. Update all `invoke()` calls (`ai_chat_stream`, `ai_chat`, `ai_generate_text`) to pass `connectionId` instead of `apiKey`. Also update `useCopilotCompletion` and `useLocalCompletion` if they pass API keys. Update `list_models` and `openai_completions_fim` callers.

**Complexity:** L **Category:** frontend **Dependencies:** Depends on #3, #5

**Files:**

- `src/hooks/useAIOperations.ts` — replace `apiKey` extraction with `connectionId`, update invoke calls
- `src/hooks/useLocalCompletion.ts` — update `openai_completions_fim` invoke to pass `connectionId`
- Any other hook or component that calls AI commands with `apiKey`

**Acceptance criteria:**

- No `apiKey` parameter in any frontend `invoke()` call
- AI chat works end-to-end (key resolved in Rust from keychain)
- Ollama and Local AI paths unaffected
- Inline completions via OpenAI-compatible providers work

---

## Task 8: Update health check to work without frontend key access

- [x] **Done**

**Description:** The `ConnectionCard` health check (`testConnection`) currently reads the API key from the connection and sends it to the backend for validation. Update it to pass `connectionId` instead. The backend health check should resolve the key from keychain.

**Complexity:** S **Category:** both **Dependencies:** Depends on #3, #5

**Files:**

- `src/components/settings/ConnectionCard.tsx` — update `testConnection` to pass `connectionId`
- `src-tauri/src/commands/ai.rs` — ensure health check / validation supports `connectionId`

**Acceptance criteria:**

- Health check (heart icon) works for API key connections without passing the key through IPC
- Health check still works for Ollama, Local AI, and agent-managed connections

---

## Task 9: One-time migration from localStorage to keychain

- [x] **Done**

**Description:** On app startup, check if credentials need migration. If `connections` in localStorage contain `api_key` credentials with a `key` field, call `invoke('migrate_credentials')` with the raw JSON. After successful migration, strip `key` fields from connections and set `credentialStored: true`. Add a `credentialsMigrated` flag to `connections-store` (persisted) to prevent re-running. Handle partial failures (some keys migrated, some failed).

**Complexity:** M **Category:** frontend **Dependencies:** Depends on #2, #5

**Files:**

- `src/stores/connections-store.ts` — add `credentialsMigrated: boolean` flag, add migration logic in `onRehydrateStorage` or a dedicated `migrateToKeychain()` method
- `src/hooks/useAppLifecycle.ts` or `src/App.tsx` — trigger migration on startup

**Acceptance criteria:**

- Existing users: keys move from localStorage to keychain on first launch after update
- After migration, `localStorage.getItem('notesage-connections')` contains no `key` fields
- `credentialsMigrated: true` prevents re-running on subsequent launches
- Partial failure: successfully migrated keys are stripped; failed ones remain in localStorage with a warning toast
- New installs: migration is a no-op (no keys to migrate)