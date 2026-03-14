# Secure Credential Storage

Migrate API key storage from plaintext localStorage to OS-native credential managers (macOS Keychain, Windows Credential Manager, Linux Secret Service).

## Problem

API keys for AI providers (Anthropic, OpenAI, OpenAI-compatible) are stored in plaintext in the Tauri WebView's localStorage via Zustand persist middleware. This is a documented trade-off, but it creates two concrete risks:

1. **XSS amplification**: Any XSS vulnerability in the WebView (e.g., `dangerouslySetInnerHTML` with unsanitized content) can trivially exfiltrate all stored API keys via `localStorage.getItem('notesage-connections')`.
2. **Local access**: Any process or tool that can read the WebView's data directory can extract API keys without authentication.

The current architecture also passes API keys from the frontend to the Rust backend on every AI request via IPC parameters, meaning keys transit through JavaScript on every call.

## Goals

- **G1**: Store API keys in the OS credential manager instead of localStorage
- **G2**: Remove API keys from Zustand persist — keys never written to disk as plaintext
- **G3**: Backend reads keys directly from the credential store — keys no longer transit through IPC
- **G4**: Transparent migration — existing users' keys move to the credential store on first launch
- **G5**: No UX regression — adding/removing connections feels the same

## Non-Goals

- Encrypting localStorage (the goal is to remove keys from localStorage entirely)
- Supporting hardware security keys or HSMs
- End-to-end encryption of API requests (HTTPS already handles this)
- Storing non-credential connection data in the keychain (provider, model, label stay in Zustand)

## User Stories

- As a user, I want my API keys stored in the macOS Keychain so that other apps and XSS attacks cannot read them from localStorage.
- As a user, I want my existing API keys to migrate automatically so I don't have to re-enter them after an update.
- As a user, I want to add and remove API keys through the same Settings UI without noticing a difference.

## Technical Approach

### Credential Store (Rust)

Use the `keyring` crate (cross-platform: macOS Keychain, Windows Credential Manager, Linux Secret Service/kwallet) to store and retrieve API keys.

**New Rust module**: `src-tauri/src/commands/credentials.rs`

```rust
// Store a credential — called from Settings UI when user enters a key
#[tauri::command]
async fn store_credential(service: String, key: String) -> Result<(), String>

// Retrieve a credential — called internally by AI commands
#[tauri::command]
async fn get_credential(service: String) -> Result<Option<String>, String>

// Delete a credential — called when user removes a connection
#[tauri::command]
async fn delete_credential(service: String) -> Result<(), String>

// Migrate credentials from localStorage JSON — called once on startup
#[tauri::command]
async fn migrate_credentials(connections_json: String) -> Result<u32, String>
```

The `service` parameter is a stable identifier like `notesage:anthropic:<connection-id>`.

### AI Command Changes

Remove `api_key` parameter from all AI commands (`ai_chat_stream`, `ai_chat`, `ai_generate_text`, etc.). Instead, pass the `connection_id` and let the Rust backend read the key from the credential store:

```rust
#[tauri::command]
pub async fn ai_chat_stream(
    window: tauri::Window,
    messages: Vec<ChatMessage>,
    connection_id: String,        // NEW — replaces provider + api_key
    // ... other params unchanged
) -> Result<(), String> {
    let key = get_credential_internal(&format!("notesage:{}", connection_id))?;
    // ... use key for API request
}
```

### Frontend Changes

**connections-store.ts**: Remove `key` from persisted `ConnectionCredentials`. The `api_key` credential type becomes:

```typescript
{ type: 'api_key' }  // key is NOT stored here anymore
```

Add a `credentialStored: boolean` flag so the UI knows whether to show "Connected" or prompt for a key.

**ConnectionsSettings.tsx**: When user enters an API key, call `invoke('store_credential', { service, key })` instead of storing in Zustand. The key never enters React state beyond the input field.

**useAIOperations.ts**: Stop extracting `apiKey` from connections. Pass `connectionId` to Tauri commands instead. The Rust backend resolves the key internally.

### Migration

On startup, if `connections-store` in localStorage contains credentials with `type: 'api_key'` and a `key` field:

1. Frontend calls `invoke('migrate_credentials', { connectionsJson })` with the raw localStorage value
2. Rust parses the JSON, extracts each `key`, stores in keychain
3. Frontend strips `key` fields from connections and re-persists
4. Migration flag `credentialsMigrated: true` prevents re-running

## Data Model

### New Tauri Commands

| Command | Parameters | Returns | Purpose |
| --- | --- | --- | --- |
| `store_credential` | `service: String, key: String` | `Result<(), String>` | Save key to OS keychain |
| `get_credential` | `service: String` | `Result<Option<String>, String>` | Read key from OS keychain |
| `delete_credential` | `service: String` | `Result<(), String>` | Remove key from OS keychain |
| `migrate_credentials` | `connections_json: String` | `Result<u32, String>` | Migrate keys from localStorage JSON |

### Modified AI Commands

All commands that currently accept `api_key: Option<String>` change to accept `connection_id: String`:

- `ai_generate_text`
- `ai_chat`
- `ai_chat_stream`
- `list_models`
- `openai_completions_fim`

### Modified Stores

**connections-store.ts** — `ConnectionCredentials` union:

```typescript
// Before
{ type: 'api_key'; key: string }

// After
{ type: 'api_key'; credentialStored: boolean }
```

**Partialize**: No change needed — credentials without the `key` field are safe to persist.

## Dependencies

| Dependency | Purpose | Side |
| --- | --- | --- |
| `keyring` crate | Cross-platform OS credential storage | Rust |

No new frontend dependencies.

## Quality Gates

### Functional

- [ ] New API key entered in Settings is stored in macOS Keychain (verify with `security find-generic-password -s notesage`)
- [ ] AI chat works after storing key — Rust reads from keychain, no key in IPC
- [ ] Removing a connection deletes the key from keychain
- [ ] Existing users: keys migrate from localStorage to keychain on first launch
- [ ] After migration, `localStorage.getItem('notesage-connections')` contains no `key` fields
- [ ] Ollama (local) and Local AI (bundled) connections unaffected — no credentials to store
- [ ] ACP agent connections unaffected — no API keys involved

### Security

- [ ] API keys not present in localStorage after migration
- [ ] API keys not passed through Tauri IPC (no `api_key` parameter in invoke calls)
- [ ] XSS in WebView cannot access stored credentials
- [ ] Keys accessible only to the current OS user (keychain ACL)

### Design

- [ ] Settings UI unchanged — user enters key in same input field
- [ ] Connection status shows "Connected" when credential is stored
- [ ] No visible difference in AI chat, inline completions, or bubble menu actions

## Out of Scope

- **Windows/Linux support**: Initial implementation targets macOS Keychain. Windows Credential Manager and Linux Secret Service support comes from the `keyring` crate but should be tested separately.
- **Key rotation UI**: No UI for viewing or rotating stored keys (user can re-enter via Settings).
- **OAuth/SSO flows**: Authentication via browser-based OAuth is a separate feature.
- **Encrypting other persisted data**: Only API keys move to the keychain. Other settings remain in localStorage.
