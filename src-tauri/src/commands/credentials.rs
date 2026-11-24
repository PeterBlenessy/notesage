use keyring::Entry;
use log;

const SERVICE_PREFIX: &str = "notesage";

fn make_entry(service: &str) -> Result<Entry, String> {
    Entry::new(service, "api_key").map_err(|e| {
        log::error!(target: "notesage::credentials", "Failed to create keychain entry for service={service}: {e}");
        format!("Keychain error: {e}")
    })
}

/// Internal helper — used by AI commands to resolve a key from the keychain.
pub fn get_credential_internal(connection_id: &str) -> Result<Option<String>, String> {
    let service = format!("{SERVICE_PREFIX}:{connection_id}");
    let entry = make_entry(&service)?;
    match entry.get_password() {
        Ok(password) => {
            log::debug!(target: "notesage::credentials", "Retrieved credential from keychain for connection={connection_id}");
            Ok(Some(password))
        }
        Err(keyring::Error::NoEntry) => {
            log::debug!(target: "notesage::credentials", "No keychain entry found for connection={connection_id}");
            Ok(None)
        }
        Err(e) => {
            log::error!(target: "notesage::credentials", "Failed to read credential for connection={connection_id}: {e}");
            Err(format!("Failed to read credential: {e}"))
        }
    }
}

/// Store a credential in the OS keychain.
#[tauri::command]
pub async fn store_credential(service: String, key: String) -> Result<(), String> {
    log::info!(target: "notesage::credentials", "Storing credential in keychain: service={service}");
    let entry = make_entry(&service)?;
    entry.set_password(&key).map_err(|e| {
        log::error!(target: "notesage::credentials", "Failed to store credential: service={service}, error={e}");
        format!("Failed to store credential: {e}")
    })
}

/// Retrieve a credential from the OS keychain.
#[tauri::command]
pub async fn get_credential(service: String) -> Result<Option<String>, String> {
    let entry = make_entry(&service)?;
    match entry.get_password() {
        Ok(key) => {
            log::debug!(target: "notesage::credentials", "Retrieved credential: service={service}");
            Ok(Some(key))
        }
        Err(keyring::Error::NoEntry) => {
            log::debug!(target: "notesage::credentials", "No credential found: service={service}");
            Ok(None)
        }
        Err(e) => {
            log::error!(target: "notesage::credentials", "Failed to read credential: service={service}, error={e}");
            Err(format!("Failed to read credential: {e}"))
        }
    }
}

/// Delete a credential from the OS keychain.
#[tauri::command]
pub async fn delete_credential(service: String) -> Result<(), String> {
    log::info!(target: "notesage::credentials", "Deleting credential from keychain: service={service}");
    let entry = make_entry(&service)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => {
            log::debug!(target: "notesage::credentials", "Credential already absent: service={service}");
            Ok(())
        }
        Err(e) => {
            log::error!(target: "notesage::credentials", "Failed to delete credential: service={service}, error={e}");
            Err(format!("Failed to delete credential: {e}"))
        }
    }
}

/// Where the migration writes secrets. The OS keychain in the app; an
/// in-memory map in the unit tests, which cannot reach a keychain.
trait SecretStore {
    /// Store `secret` under `service`. The error is the underlying cause
    /// only; the caller adds which credential it was.
    fn set(&self, service: &str, secret: &str) -> Result<(), String>;
}

struct KeychainStore;

impl SecretStore for KeychainStore {
    fn set(&self, service: &str, secret: &str) -> Result<(), String> {
        make_entry(service)?
            .set_password(secret)
            .map_err(|e| e.to_string())
    }
}

/// Migrate credentials from a localStorage JSON blob to the OS keychain.
/// Expects the raw value of `localStorage.getItem('notesage-connections')`.
/// Returns the number of credentials migrated.
#[tauri::command]
pub async fn migrate_credentials(connections_json: String) -> Result<u32, String> {
    migrate_credentials_into(&KeychainStore, &connections_json)
}

fn migrate_credentials_into(store: &dyn SecretStore, connections_json: &str) -> Result<u32, String> {
    log::info!(target: "notesage::credentials", "Starting credential migration from localStorage to keychain");

    // The Zustand persist format wraps state in { "state": { "connections": [...] }, "version": N }
    let parsed: serde_json::Value = serde_json::from_str(connections_json)
        .map_err(|e| {
            log::error!(target: "notesage::credentials", "Failed to parse connections JSON: {e}");
            format!("Failed to parse connections JSON: {e}")
        })?;

    let connections = parsed
        .get("state")
        .and_then(|s| s.get("connections"))
        .and_then(|c| c.as_array())
        .ok_or_else(|| {
            log::error!(target: "notesage::credentials", "No connections array found in migration JSON");
            "No connections array found in JSON".to_string()
        })?;

    let mut migrated = 0u32;

    for conn in connections {
        let id = conn.get("id").and_then(|v| v.as_str()).unwrap_or_default();
        let credentials = match conn.get("credentials") {
            Some(c) => c,
            None => continue,
        };

        let cred_type = credentials.get("type").and_then(|v| v.as_str()).unwrap_or_default();

        if cred_type == "api_key" {
            if let Some(key) = credentials.get("key").and_then(|v| v.as_str()) {
                if !key.is_empty() {
                    let service = format!("{SERVICE_PREFIX}:{id}");
                    store.set(&service, key)
                        .map_err(|e| {
                            log::error!(target: "notesage::credentials", "Failed to migrate api_key credential for connection={id}: {e}");
                            format!("Failed to migrate credential for {id}: {e}")
                        })?;
                    log::info!(target: "notesage::credentials", "Migrated api_key credential for connection={id}");
                    migrated += 1;
                }
            }
        }

        // Also migrate envVars API keys from agent_managed connections (e.g., Gemini CLI)
        if cred_type == "agent_managed" {
            if let Some(env_vars) = credentials.get("envVars").and_then(|v| v.as_object()) {
                for (env_key, env_val) in env_vars {
                    if let Some(val) = env_val.as_str() {
                        if !val.is_empty() && (env_key.contains("API_KEY") || env_key.contains("api_key")) {
                            let service = format!("{SERVICE_PREFIX}:{id}:env:{env_key}");
                            store.set(&service, val)
                                .map_err(|e| {
                                    log::error!(target: "notesage::credentials", "Failed to migrate env var {env_key} for connection={id}: {e}");
                                    format!("Failed to migrate env var {env_key} for {id}: {e}")
                                })?;
                            log::info!(target: "notesage::credentials", "Migrated env var {env_key} for connection={id}");
                            migrated += 1;
                        }
                    }
                }
            }
        }
    }

    log::info!(target: "notesage::credentials", "Credential migration complete: {migrated} credential(s) migrated");
    Ok(migrated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::BTreeMap;

    /// In-memory stand-in for the keychain; `fail_on` makes one service fail.
    #[derive(Default)]
    struct MemoryStore {
        saved: RefCell<BTreeMap<String, String>>,
        fail_on: Option<String>,
    }

    impl SecretStore for MemoryStore {
        fn set(&self, service: &str, secret: &str) -> Result<(), String> {
            if self.fail_on.as_deref() == Some(service) {
                return Err("keychain is locked".to_string());
            }
            self.saved
                .borrow_mut()
                .insert(service.to_string(), secret.to_string());
            Ok(())
        }
    }

    fn persisted(connections: serde_json::Value) -> String {
        serde_json::json!({ "state": { "connections": connections }, "version": 3 }).to_string()
    }

    #[test]
    fn migrates_api_keys_under_the_connection_service_name() {
        let store = MemoryStore::default();
        let json = persisted(serde_json::json!([
            { "id": "conn-a", "credentials": { "type": "api_key", "key": "sk-aaa" } },
            { "id": "conn-b", "credentials": { "type": "api_key", "key": "sk-bbb" } },
        ]));

        assert_eq!(migrate_credentials_into(&store, &json), Ok(2));
        let saved = store.saved.borrow();
        // The same name `get_credential_internal` reads back.
        assert_eq!(saved.get("notesage:conn-a").map(String::as_str), Some("sk-aaa"));
        assert_eq!(saved.get("notesage:conn-b").map(String::as_str), Some("sk-bbb"));
        assert_eq!(saved.len(), 2);
    }

    #[test]
    fn migrates_only_the_api_key_env_vars_of_agent_managed_connections() {
        let store = MemoryStore::default();
        let json = persisted(serde_json::json!([{
            "id": "gemini",
            "credentials": {
                "type": "agent_managed",
                "envVars": {
                    "GEMINI_API_KEY": "g-123",
                    "custom_api_key": "c-456",
                    "GEMINI_MODEL": "pro",
                    "EMPTY_API_KEY": "",
                    "NUMERIC_API_KEY": 7
                }
            }
        }]));

        assert_eq!(migrate_credentials_into(&store, &json), Ok(2));
        let saved = store.saved.borrow();
        assert_eq!(
            saved.get("notesage:gemini:env:GEMINI_API_KEY").map(String::as_str),
            Some("g-123")
        );
        assert_eq!(
            saved.get("notesage:gemini:env:custom_api_key").map(String::as_str),
            Some("c-456")
        );
        assert_eq!(saved.len(), 2, "non-secret, empty and non-string vars stay put");
    }

    #[test]
    fn skips_empty_keys_and_connections_with_nothing_to_migrate() {
        let store = MemoryStore::default();
        let json = persisted(serde_json::json!([
            { "id": "empty", "credentials": { "type": "api_key", "key": "" } },
            { "id": "no-key", "credentials": { "type": "api_key" } },
            { "id": "no-credentials" },
            { "id": "oauth", "credentials": { "type": "oauth", "key": "not-an-api-key" } },
            { "id": "already", "credentials": { "type": "api_key", "key": "", "credentialStored": true } },
        ]));

        assert_eq!(migrate_credentials_into(&store, &json), Ok(0));
        assert!(store.saved.borrow().is_empty());
    }

    #[test]
    fn malformed_input_is_an_error_and_stores_nothing() {
        let store = MemoryStore::default();

        let err = migrate_credentials_into(&store, "{not json").unwrap_err();
        assert!(err.starts_with("Failed to parse connections JSON"), "{err}");

        for json in ["{}", r#"{"state":{}}"#, r#"{"state":{"connections":"nope"}}"#, "[]"] {
            assert_eq!(
                migrate_credentials_into(&store, json),
                Err("No connections array found in JSON".to_string()),
                "{json}"
            );
        }
        assert!(store.saved.borrow().is_empty());
    }

    #[test]
    fn a_keychain_failure_fails_the_migration_so_the_frontend_keeps_the_keys() {
        // The store strips plaintext keys only when this command succeeds.
        let store = MemoryStore {
            fail_on: Some("notesage:conn-b".to_string()),
            ..MemoryStore::default()
        };
        let json = persisted(serde_json::json!([
            { "id": "conn-a", "credentials": { "type": "api_key", "key": "sk-aaa" } },
            { "id": "conn-b", "credentials": { "type": "api_key", "key": "sk-bbb" } },
        ]));

        let err = migrate_credentials_into(&store, &json).unwrap_err();
        assert_eq!(err, "Failed to migrate credential for conn-b: keychain is locked");
    }
}
