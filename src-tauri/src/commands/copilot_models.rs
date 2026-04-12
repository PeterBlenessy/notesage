//! Copilot LSP model types and parsing.
//!
//! Contains the `CopilotModel` struct, the parser for `copilot/models`
//! responses, and the hardcoded fallback model list. The
//! `copilot_lsp_conversation_models` Tauri command lives in `copilot_lsp.rs`
//! and delegates to the helpers here.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CopilotModel {
    pub id: String,
    pub name: String,
    pub provider: String,
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/// Parse the copilot/models JSON array into CopilotModel structs.
/// Extracts id (or modelFamily), modelName, and modelProviderName.
pub(super) fn parse_copilot_models(models: &[Value]) -> Vec<CopilotModel> {
    models
        .iter()
        .filter_map(|m| {
            let id = m.get("id").and_then(|v| v.as_str())
                .or_else(|| m.get("modelFamily").and_then(|v| v.as_str()))?;
            let name = m.get("modelName").and_then(|v| v.as_str())
                .or_else(|| m.get("id").and_then(|v| v.as_str()))
                .unwrap_or(id);

            Some(CopilotModel {
                id: id.to_string(),
                name: name.to_string(),
                provider: m.get("modelProviderName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("copilot")
                    .to_string(),
            })
        })
        .collect()
}

/// Fallback model list when copilot/models is unavailable.
pub(super) fn hardcoded_fallback_models() -> Vec<CopilotModel> {
    vec![
        CopilotModel { id: "gpt-4o".into(), name: "GPT-4o".into(), provider: "openai".into() },
        CopilotModel { id: "gpt-4.1".into(), name: "GPT-4.1".into(), provider: "openai".into() },
        CopilotModel { id: "claude-sonnet-4".into(), name: "Claude Sonnet 4".into(), provider: "anthropic".into() },
        CopilotModel { id: "gemini-2.5-pro".into(), name: "Gemini 2.5 Pro".into(), provider: "google".into() },
        CopilotModel { id: "o4-mini".into(), name: "o4-mini".into(), provider: "openai".into() },
    ]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_copilot_models_standard_format() {
        let models = vec![
            json!({
                "id": "gpt-4o",
                "modelFamily": "gpt-4o",
                "modelName": "GPT-4o",
                "scopes": ["chat-panel", "edit-panel", "inline"],
                "preview": false,
                "isChatDefault": true,
                "modelProviderName": "openai"
            }),
            json!({
                "id": "claude-sonnet-4",
                "modelFamily": "claude-sonnet-4",
                "modelName": "Claude Sonnet 4",
                "scopes": ["chat-panel"],
                "modelProviderName": "anthropic"
            }),
        ];

        let parsed = parse_copilot_models(&models);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].id, "gpt-4o");
        assert_eq!(parsed[0].name, "GPT-4o");
        assert_eq!(parsed[0].provider, "openai");
        assert_eq!(parsed[1].id, "claude-sonnet-4");
        assert_eq!(parsed[1].name, "Claude Sonnet 4");
        assert_eq!(parsed[1].provider, "anthropic");
    }

    #[test]
    fn parse_copilot_models_falls_back_to_model_family() {
        // Some models might only have modelFamily, not id
        let models = vec![
            json!({
                "modelFamily": "o4-mini",
                "modelName": "o4-mini",
            }),
        ];

        let parsed = parse_copilot_models(&models);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "o4-mini");
        assert_eq!(parsed[0].name, "o4-mini");
        assert_eq!(parsed[0].provider, "copilot"); // default when not specified
    }

    #[test]
    fn parse_copilot_models_skips_entries_without_id_or_family() {
        let models = vec![
            json!({ "modelName": "Mystery Model" }),  // no id, no modelFamily
            json!({ "id": "valid-model", "modelName": "Valid" }),
        ];

        let parsed = parse_copilot_models(&models);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "valid-model");
    }

    #[test]
    fn parse_copilot_models_uses_id_as_name_fallback() {
        let models = vec![
            json!({ "id": "gemini-2.5-pro" }),  // no modelName
        ];

        let parsed = parse_copilot_models(&models);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "gemini-2.5-pro");
        assert_eq!(parsed[0].name, "gemini-2.5-pro"); // falls back to id
    }

    #[test]
    fn parse_copilot_models_no_scope_filtering() {
        // After removing the scope filter, ALL models should be included
        // regardless of their scopes
        let models = vec![
            json!({ "id": "model-a", "modelName": "A", "scopes": ["chat-panel"] }),
            json!({ "id": "model-b", "modelName": "B", "scopes": ["edit-panel"] }),
            json!({ "id": "model-c", "modelName": "C", "scopes": ["inline"] }),
            json!({ "id": "model-d", "modelName": "D" }),  // no scopes at all
        ];

        let parsed = parse_copilot_models(&models);
        assert_eq!(parsed.len(), 4, "All models should be included regardless of scope");
    }

    #[test]
    fn parse_copilot_models_realistic_pro_account() {
        // Simulate a realistic copilot/models response for a Pro account
        let models = vec![
            json!({ "id": "gpt-4o", "modelFamily": "gpt-4o", "modelName": "GPT-4o", "scopes": ["chat-panel", "edit-panel", "agent-panel", "inline"], "modelProviderName": "github" }),
            json!({ "id": "gpt-4.1", "modelFamily": "gpt-4.1", "modelName": "GPT-4.1", "scopes": ["chat-panel", "edit-panel", "agent-panel"], "modelProviderName": "github" }),
            json!({ "id": "o4-mini", "modelFamily": "o4-mini", "modelName": "o4-mini", "scopes": ["chat-panel", "edit-panel", "agent-panel"], "modelProviderName": "github" }),
            json!({ "id": "claude-sonnet-4", "modelFamily": "claude-sonnet-4", "modelName": "Claude Sonnet 4", "scopes": ["chat-panel", "edit-panel", "agent-panel"], "modelProviderName": "anthropic" }),
            json!({ "id": "claude-3.5-sonnet", "modelFamily": "claude-3.5-sonnet", "modelName": "Claude 3.5 Sonnet", "scopes": ["chat-panel", "edit-panel"], "modelProviderName": "anthropic" }),
            json!({ "id": "gemini-2.5-pro", "modelFamily": "gemini-2.5-pro", "modelName": "Gemini 2.5 Pro", "scopes": ["chat-panel"], "modelProviderName": "google" }),
        ];

        let parsed = parse_copilot_models(&models);
        assert_eq!(parsed.len(), 6, "All 6 models should be parsed");

        // Verify each model has correct id and name
        let ids: Vec<&str> = parsed.iter().map(|m| m.id.as_str()).collect();
        assert!(ids.contains(&"gpt-4o"));
        assert!(ids.contains(&"claude-sonnet-4"));
        assert!(ids.contains(&"gemini-2.5-pro"));
    }

    #[test]
    fn hardcoded_fallback_has_models() {
        let fallback = hardcoded_fallback_models();
        assert!(fallback.len() >= 3, "Fallback should have at least a few models");
        // All should have non-empty id and name
        for model in &fallback {
            assert!(!model.id.is_empty());
            assert!(!model.name.is_empty());
        }
    }
}
