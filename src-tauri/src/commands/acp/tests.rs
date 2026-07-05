//! Unit tests for the ACP command surface. Cover the wire contract (serde round
//! trips), the MCP-server builder, the model-info extractor, and PID-file
//! parsing. No agent subprocess is spawned — these are pure-function tests.

use super::helpers::{build_acp_mcp_servers, extract_model_info};
use super::state::parse_acp_pid_file;
use super::types::{AcpMcpServerInput, AuthEnvVar, AuthMethodInfo, SmokeStage, SmokeTestReport};
use crate::commands::mcp::{McpEnvValue, McpTransport};
use agent_client_protocol::schema::McpServer;
use std::collections::HashMap;

// --- orphan PID-file records (audit batch 3 fix #9) ---

#[test]
fn pid_file_round_trips_pid_and_binary() {
    let content = "12345\n/Users/x/.notesage/agents/bin/claude-agent-acp\n";
    assert_eq!(
        parse_acp_pid_file(content),
        Some((
            12345,
            "/Users/x/.notesage/agents/bin/claude-agent-acp".to_string()
        ))
    );
}

#[test]
fn pid_file_rejects_unverifiable_records() {
    // Records that can't be identity-verified must parse to None so the
    // startup cleanup never signals them.
    assert_eq!(parse_acp_pid_file(""), None);
    assert_eq!(parse_acp_pid_file("not-a-pid\n/bin/agent\n"), None);
    assert_eq!(parse_acp_pid_file("12345\n"), None); // missing binary line
    assert_eq!(parse_acp_pid_file("12345\n   \n"), None); // blank binary
    assert_eq!(parse_acp_pid_file("0\n/bin/agent\n"), None); // pid 0
}

fn stdio_input(name: &str, command: &str) -> AcpMcpServerInput {
    AcpMcpServerInput {
        id: format!("srv-{name}"),
        name: name.to_string(),
        transport: McpTransport::Stdio,
        command: command.to_string(),
        args: vec!["--flag".to_string()],
        env: HashMap::new(),
        url: None,
    }
}

/// A stdio server with a command + plain env builds an `McpServer::Stdio`
/// carrying the resolved env and args (task #11). Plain values pass through;
/// secret refs that miss the keychain are simply dropped.
#[tokio::test]
async fn build_mcp_servers_stdio_carries_env_and_args() {
    let mut input = stdio_input("fs", "/usr/bin/mcp-fs");
    input.env.insert("TOKEN".to_string(), McpEnvValue::Plain("abc".to_string()));
    input
        .env
        .insert("MISSING".to_string(), McpEnvValue::Secret(crate::commands::mcp::McpSecretRef { secret: true }));

    let built = build_acp_mcp_servers(vec![input]).await;
    assert_eq!(built.len(), 1);
    match &built[0] {
        McpServer::Stdio(s) => {
            assert_eq!(s.name, "fs");
            assert_eq!(s.command.to_string_lossy(), "/usr/bin/mcp-fs");
            assert_eq!(s.args, vec!["--flag".to_string()]);
            // Plain env present; the missing keychain secret was dropped.
            let token = s.env.iter().find(|e| e.name == "TOKEN");
            assert_eq!(token.map(|e| e.value.as_str()), Some("abc"));
            assert!(s.env.iter().all(|e| e.name != "MISSING"));
        }
        _ => panic!("expected Stdio"),
    }
}

/// A stdio server with an empty command is dropped rather than failing the
/// whole session.
#[tokio::test]
async fn build_mcp_servers_drops_stdio_without_command() {
    let built = build_acp_mcp_servers(vec![stdio_input("broken", "   ")]).await;
    assert!(built.is_empty());
}

/// An http server with a URL builds an `McpServer::Http`; one without a URL
/// is dropped.
#[tokio::test]
async fn build_mcp_servers_http_requires_url() {
    let with_url = AcpMcpServerInput {
        id: "srv-remote".to_string(),
        name: "remote".to_string(),
        transport: McpTransport::Http,
        command: String::new(),
        args: vec![],
        env: HashMap::new(),
        url: Some("https://mcp.example.com".to_string()),
    };
    let without_url = AcpMcpServerInput {
        id: "srv-bad".to_string(),
        name: "bad".to_string(),
        transport: McpTransport::Http,
        command: String::new(),
        args: vec![],
        env: HashMap::new(),
        url: None,
    };
    let built = build_acp_mcp_servers(vec![with_url, without_url]).await;
    assert_eq!(built.len(), 1);
    match &built[0] {
        McpServer::Http(h) => {
            assert_eq!(h.name, "remote");
            assert_eq!(h.url, "https://mcp.example.com");
        }
        _ => panic!("expected Http"),
    }
}

/// `AcpMcpServerInput` deserializes from the renderer's camelCase payload,
/// defaulting transport to stdio and env to empty (absent-field back-compat).
#[test]
fn acp_mcp_server_input_deserializes_with_defaults() {
    let json = serde_json::json!({ "id": "s1", "name": "S1", "command": "x" });
    let input: AcpMcpServerInput = serde_json::from_value(json).unwrap();
    assert_eq!(input.transport, McpTransport::Stdio);
    assert!(input.env.is_empty());
    assert!(input.args.is_empty());
    assert!(input.url.is_none());
}
use agent_client_protocol::schema::{
    ContentBlock, ContentChunk, MessageId, SessionConfigOption, SessionConfigOptionCategory,
    SessionConfigSelectOption, TextContent,
};

/// `AuthMethodInfo::EnvVar` must round-trip through serde so the frontend receives
/// the full `{ vars, link }` payload. Tagged as `{ "type": "env_var", ... }`.
#[test]
fn auth_method_info_env_var_serializes_vars_and_link() {
    let info = AuthMethodInfo::EnvVar {
        id: "api-key".to_string(),
        name: "API Key".to_string(),
        description: Some("Paste your provider key".to_string()),
        vars: vec![
            AuthEnvVar {
                name: "OPENAI_API_KEY".to_string(),
                label: Some("API Key".to_string()),
                secret: true,
                optional: false,
            },
            AuthEnvVar {
                name: "OPENAI_ORG_ID".to_string(),
                label: None,
                secret: false,
                optional: true,
            },
        ],
        link: Some("https://example.com/keys".to_string()),
    };

    let json = serde_json::to_value(&info).expect("AuthMethodInfo must serialize");
    assert_eq!(json.get("type").and_then(|v| v.as_str()), Some("env_var"));
    assert_eq!(json.get("id").and_then(|v| v.as_str()), Some("api-key"));
    assert_eq!(json.get("name").and_then(|v| v.as_str()), Some("API Key"));
    assert_eq!(
        json.get("link").and_then(|v| v.as_str()),
        Some("https://example.com/keys"),
    );

    let vars = json.get("vars").and_then(|v| v.as_array()).expect("vars[]");
    assert_eq!(vars.len(), 2);
    assert_eq!(vars[0].get("name").and_then(|v| v.as_str()), Some("OPENAI_API_KEY"));
    assert_eq!(vars[0].get("secret").and_then(|v| v.as_bool()), Some(true));
    assert_eq!(vars[0].get("optional").and_then(|v| v.as_bool()), Some(false));
    assert_eq!(vars[1].get("optional").and_then(|v| v.as_bool()), Some(true));

    // Round-trip back to AuthMethodInfo and confirm the EnvVar variant is preserved.
    let round: AuthMethodInfo =
        serde_json::from_value(json).expect("AuthMethodInfo must deserialize");
    match round {
        AuthMethodInfo::EnvVar { vars, link, .. } => {
            assert_eq!(vars.len(), 2);
            assert_eq!(vars[0].name, "OPENAI_API_KEY");
            assert_eq!(link.as_deref(), Some("https://example.com/keys"));
        }
        _ => panic!("Expected EnvVar variant after round-trip"),
    }
}

/// A passing smoke test serializes with camelCase fields, a snake_case
/// stage, and omits the `error` field entirely (the frontend treats absent
/// error as success and reads `stage`/`elapsedMs`).
#[test]
fn smoke_report_ok_serializes_camel_case_and_omits_error() {
    let report = SmokeTestReport {
        ok: true,
        stage: SmokeStage::Done,
        error: None,
        elapsed_ms: 4200,
    };
    let json = serde_json::to_value(&report).expect("SmokeTestReport must serialize");
    assert_eq!(json.get("ok").and_then(|v| v.as_bool()), Some(true));
    assert_eq!(json.get("stage").and_then(|v| v.as_str()), Some("done"));
    assert_eq!(json.get("elapsedMs").and_then(|v| v.as_u64()), Some(4200));
    assert!(json.get("error").is_none(), "error must be omitted on success");
    // No snake_case leak for the multi-word field.
    assert!(json.get("elapsed_ms").is_none());
}

/// A failing smoke test names the stage that failed and carries the error.
#[test]
fn smoke_report_failure_names_stage_and_error() {
    let report = SmokeTestReport {
        ok: false,
        stage: SmokeStage::Prompt,
        error: Some("prompt timed out".to_string()),
        elapsed_ms: 180_000,
    };
    let json = serde_json::to_value(&report).expect("SmokeTestReport must serialize");
    assert_eq!(json.get("ok").and_then(|v| v.as_bool()), Some(false));
    assert_eq!(json.get("stage").and_then(|v| v.as_str()), Some("prompt"));
    assert_eq!(json.get("error").and_then(|v| v.as_str()), Some("prompt timed out"));

    // Round-trips back to the same value.
    let round: SmokeTestReport =
        serde_json::from_value(json).expect("SmokeTestReport must deserialize");
    assert_eq!(round, report);
}

/// Every stage maps to a distinct, stable snake_case wire name.
#[test]
fn smoke_stage_wire_names_are_stable() {
    let cases = [
        (SmokeStage::Health, "health"),
        (SmokeStage::Spawn, "spawn"),
        (SmokeStage::Session, "session"),
        (SmokeStage::Prompt, "prompt"),
        (SmokeStage::Done, "done"),
    ];
    for (stage, wire) in cases {
        assert_eq!(serde_json::to_value(&stage).unwrap().as_str(), Some(wire));
    }
}

/// `AuthMethodInfo::Agent` serializes as `{ "type": "agent", ... }`.
#[test]
fn auth_method_info_agent_serializes_without_vars() {
    let info = AuthMethodInfo::Agent {
        id: "default".to_string(),
        name: "Default".to_string(),
        description: None,
    };
    let json = serde_json::to_value(&info).expect("AuthMethodInfo must serialize");
    assert_eq!(json.get("type").and_then(|v| v.as_str()), Some("agent"));
    assert!(json.get("vars").is_none(), "Agent variant should not carry vars");
    assert!(json.get("link").is_none(), "Agent variant should not carry link");
}

/// `ContentChunk.message_id` is the stable (0.13.6) message-identity design:
/// the agent assigns the id, and all chunks of one message share it. The
/// frontend reads it from `agent_message_chunk` updates as `messageId`
/// (camelCase) — this test locks that wire shape.
#[test]
fn content_chunk_serializes_message_id_when_present() {
    let chunk = ContentChunk::new(ContentBlock::Text(TextContent::new("hello".to_string())))
        .message_id(MessageId::new("msg-1"));

    let json = serde_json::to_value(&chunk).expect("ContentChunk must serialize");
    assert_eq!(
        json.get("messageId").and_then(|v| v.as_str()),
        Some("msg-1"),
        "ContentChunk should serialize `messageId` (camelCase) when present"
    );

    let bare = ContentChunk::new(ContentBlock::Text(TextContent::new("hi".to_string())));
    let json = serde_json::to_value(&bare).expect("ContentChunk must serialize");
    assert!(
        json.get("messageId").is_none(),
        "messageId should be omitted when absent (got {json:?})",
    );
}

/// The session-model API was removed in ACP 0.14; `extract_model_info` derives
/// the model picker from the config option with category `Model`. No such
/// option → graceful empty result, never an error.
#[test]
fn extract_model_info_reads_model_category_config_option() {
    let model_option = SessionConfigOption::select(
        "model",
        "Model",
        "claude-sonnet-4",
        vec![
            SessionConfigSelectOption::new("claude-sonnet-4", "Claude Sonnet 4")
                .description("Fast and capable".to_string()),
            SessionConfigSelectOption::new("claude-opus-4", "Claude Opus 4"),
        ],
    )
    .category(SessionConfigOptionCategory::Model);
    let unrelated_option = SessionConfigOption::select(
        "effort",
        "Thinking effort",
        "medium",
        vec![SessionConfigSelectOption::new("medium", "Medium")],
    )
    .category(SessionConfigOptionCategory::ThoughtLevel);

    let options = vec![unrelated_option.clone(), model_option];
    let (current, available) = extract_model_info(Some(&options));
    assert_eq!(current.as_deref(), Some("claude-sonnet-4"));
    assert_eq!(available.len(), 2);
    assert_eq!(available[0].model_id, "claude-sonnet-4");
    assert_eq!(available[0].name, "Claude Sonnet 4");
    assert_eq!(available[0].description.as_deref(), Some("Fast and capable"));
    assert_eq!(available[1].model_id, "claude-opus-4");

    // No model-category option → empty result (graceful degradation).
    let (current, available) = extract_model_info(Some(&vec![unrelated_option]));
    assert!(current.is_none());
    assert!(available.is_empty());

    let (current, available) = extract_model_info(None);
    assert!(current.is_none());
    assert!(available.is_empty());
}
