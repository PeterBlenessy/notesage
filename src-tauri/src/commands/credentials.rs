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

/// Migrate credentials from a localStorage JSON blob to the OS keychain.
/// Expects the raw value of `localStorage.getItem('notesage-connections')`.
/// Returns the number of credentials migrated.
#[tauri::command]
pub async fn migrate_credentials(connections_json: String) -> Result<u32, String> {
    log::info!(target: "notesage::credentials", "Starting credential migration from localStorage to keychain");

    // The Zustand persist format wraps state in { "state": { "connections": [...] }, "version": N }
    let parsed: serde_json::Value = serde_json::from_str(&connections_json)
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
                    let entry = make_entry(&service)?;
                    entry.set_password(key)
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
                            let entry = make_entry(&service)?;
                            entry.set_password(val)
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
