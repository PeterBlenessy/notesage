//! Copilot LSP authentication helpers.
//!
//! Utilities for extracting device code and verification URI from JSON-RPC
//! sign-in responses. The Tauri commands themselves live in `copilot_lsp.rs`.

use serde_json::Value;

// ---------------------------------------------------------------------------
// Response field extraction
// ---------------------------------------------------------------------------

/// Extract userCode from a JSON-RPC result, trying multiple field name variants.
/// Also falls back to extracting from verificationUri query parameters.
pub(super) fn extract_user_code_from_result(result: &Value) -> String {
    // Try direct field names (LSP versions vary between camelCase and snake_case)
    let user_code = result
        .get("userCode")
        .and_then(|v| v.as_str())
        .or_else(|| result.get("user_code").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();

    if !user_code.is_empty() {
        return user_code;
    }

    // Try extracting from verificationUri query parameters
    let verification_uri = result
        .get("verificationUri")
        .and_then(|v| v.as_str())
        .or_else(|| result.get("verification_uri").and_then(|v| v.as_str()))
        .unwrap_or("");
    if let Some(code) = extract_code_from_uri(verification_uri) {
        log::debug!(target: "notesage::copilot", "Extracted user_code from URI: {}", code);
        return code;
    }

    String::new()
}

/// Extract verificationUri from a JSON-RPC result.
pub(super) fn extract_verification_uri(result: &Value) -> String {
    result
        .get("verificationUri")
        .and_then(|v| v.as_str())
        .or_else(|| result.get("verification_uri").and_then(|v| v.as_str()))
        .unwrap_or("https://github.com/login/device")
        .to_string()
}

/// Try to extract a user code from a verification URI's query parameters.
/// e.g. `https://github.com/login/device?user_code=ABCD-1234` → Some("ABCD-1234")
pub(super) fn extract_code_from_uri(uri: &str) -> Option<String> {
    let query = uri.split('?').nth(1)?;
    for param in query.split('&') {
        let mut kv = param.splitn(2, '=');
        let key = kv.next()?;
        let value = kv.next()?;
        if key == "user_code" || key == "userCode" || key == "code" {
            let decoded = value.replace("%20", " ").replace('+', " ");
            if !decoded.is_empty() {
                return Some(decoded);
            }
        }
    }
    None
}
