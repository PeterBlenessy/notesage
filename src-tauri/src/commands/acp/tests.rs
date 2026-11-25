//! Unit tests for the ACP command surface. Cover the wire contract (serde round
//! trips), the MCP-server builder, the model-info extractor, and PID-file
//! parsing. No agent subprocess is spawned — these are pure-function tests.

use super::helpers::{build_acp_mcp_servers, extract_model_info};
use super::state::parse_acp_pid_file;
use super::types::{AcpMcpServerInput, AuthEnvVar, AuthMethodInfo, SmokeStage, SmokeTestReport};
use crate::commands::mcp::{McpEnvValue, McpTransport};
use agent_client_protocol::schema::McpServer;
use std::collections::HashMap;
use std::path::PathBuf;

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
        headers: HashMap::new(),
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
        headers: HashMap::new(),
    };
    let without_url = AcpMcpServerInput {
        id: "srv-bad".to_string(),
        name: "bad".to_string(),
        transport: McpTransport::Http,
        command: String::new(),
        args: vec![],
        env: HashMap::new(),
        url: None,
        headers: HashMap::new(),
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

/// What the agent receives in `session/new` / `session/load` is the ACP v1
/// wire shape: a stdio server has no `type` and carries `env` as an array of
/// `{ name, value }`; an http server is tagged `type: "http"` and carries
/// `headers` the same way. Secret references never appear: a plain value
/// passes through, a keychain reference that cannot be resolved is left out.
#[tokio::test]
async fn build_mcp_servers_serialise_to_the_acp_wire_shape() {
    let mut stdio = stdio_input("fs", "/usr/bin/mcp-fs");
    stdio.env.insert("TOKEN".to_string(), McpEnvValue::Plain("abc".to_string()));
    stdio.env.insert(
        "MISSING".to_string(),
        McpEnvValue::Secret(crate::commands::mcp::McpSecretRef { secret: true }),
    );
    let mut http = AcpMcpServerInput {
        id: "srv-remote-wire".to_string(),
        name: "remote".to_string(),
        transport: McpTransport::Http,
        command: String::new(),
        args: vec![],
        env: HashMap::new(),
        url: Some("https://mcp.example.com/mcp".to_string()),
        headers: HashMap::new(),
    };
    http.headers.insert("X-Api-Key".to_string(), McpEnvValue::Plain("k1".to_string()));
    http.headers.insert(
        "X-Missing".to_string(),
        McpEnvValue::Secret(crate::commands::mcp::McpSecretRef { secret: true }),
    );

    let built = build_acp_mcp_servers(vec![stdio, http]).await;
    let wire = serde_json::to_value(&built).unwrap();
    assert_eq!(
        wire,
        serde_json::json!([
            {
                "name": "fs",
                "command": "/usr/bin/mcp-fs",
                "args": ["--flag"],
                "env": [{ "name": "TOKEN", "value": "abc" }],
            },
            {
                "type": "http",
                "name": "remote",
                "url": "https://mcp.example.com/mcp",
                "headers": [{ "name": "X-Api-Key", "value": "k1" }],
            },
        ])
    );
    assert!(!wire.to_string().contains("secret"));
}

/// The agent spawns a stdio server without a shell, so a leading `~` in the
/// command is expanded here. Bare names (resolved through `PATH`), absolute
/// paths and `~user` forms are left alone.
#[test]
fn expand_home_in_command_only_touches_a_leading_tilde() {
    use super::helpers::expand_home_in_command;
    let home = std::path::Path::new("/Users/t");
    assert_eq!(expand_home_in_command("~/bin/srv", Some(home)), PathBuf::from("/Users/t/bin/srv"));
    assert_eq!(expand_home_in_command("~", Some(home)), PathBuf::from("/Users/t"));
    assert_eq!(expand_home_in_command("npx", Some(home)), PathBuf::from("npx"));
    assert_eq!(expand_home_in_command("/usr/bin/node", Some(home)), PathBuf::from("/usr/bin/node"));
    assert_eq!(expand_home_in_command("~other/bin/srv", Some(home)), PathBuf::from("~other/bin/srv"));
    assert_eq!(expand_home_in_command("./rel/srv", Some(home)), PathBuf::from("./rel/srv"));
    assert_eq!(expand_home_in_command("~/bin/srv", None), PathBuf::from("~/bin/srv"));
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

// --- turn stop reasons (silent-turn-end fix) ---
//
// The stop reason is the only thing distinguishing "the agent finished" from
// "the agent ran out of tokens or turn requests mid-task". These strings are a
// wire contract the frontend switches on to decide whether to tell the user the
// turn was cut short — renaming one silently restores the silent-stop bug.

#[test]
fn stop_reason_str_maps_every_known_variant_to_its_wire_string() {
    use super::agent_thread::stop_reason_str;
    use agent_client_protocol::schema::StopReason;

    assert_eq!(stop_reason_str(StopReason::EndTurn), "end_turn");
    assert_eq!(stop_reason_str(StopReason::MaxTokens), "max_tokens");
    assert_eq!(stop_reason_str(StopReason::MaxTurnRequests), "max_turn_requests");
    assert_eq!(stop_reason_str(StopReason::Refusal), "refusal");
    assert_eq!(stop_reason_str(StopReason::Cancelled), "cancelled");
}

#[test]
fn stop_reason_wire_strings_match_the_schema_serde_representation() {
    // The mapping is hand-written (so the exact strings are visible and
    // testable) but it MUST agree with the schema's own snake_case serde
    // rename — otherwise the frontend and the protocol disagree.
    use super::agent_thread::stop_reason_str;
    use agent_client_protocol::schema::StopReason;

    for reason in [
        StopReason::EndTurn,
        StopReason::MaxTokens,
        StopReason::MaxTurnRequests,
        StopReason::Refusal,
        StopReason::Cancelled,
    ] {
        let via_serde = serde_json::to_string(&reason).unwrap();
        let via_serde = via_serde.trim_matches('"');
        assert_eq!(
            stop_reason_str(reason),
            via_serde,
            "hand-written mapping drifted from the schema's serde representation",
        );
    }
}

#[test]
fn only_end_turn_means_the_agent_actually_finished() {
    // Guards the semantic the UI depends on: every other reason is an early
    // stop the user must be told about.
    use super::agent_thread::stop_reason_str;
    use agent_client_protocol::schema::StopReason;

    let early_stops = [
        StopReason::MaxTokens,
        StopReason::MaxTurnRequests,
        StopReason::Refusal,
        StopReason::Cancelled,
    ];
    for reason in early_stops {
        assert_ne!(
            stop_reason_str(reason),
            "end_turn",
            "an early stop must never be reported as a completed turn",
        );
    }
}

// ---------------------------------------------------------------------------
// Prompt content blocks — attachments must travel as resource links
// ---------------------------------------------------------------------------
//
// An attachment used to be NAMED in the system prompt ("File in context:
// /path/to/note.md") and nothing else. The agent got a string that happened to
// look like a path, with no reason to connect it to "read this" — so attaching
// a document did nothing, and pasting the path by hand worked exactly as well.
// That was the reported bug.
//
// `ContentBlock::ResourceLink` is the ACP concept for this, and the schema is
// unambiguous that it needs no capability gate: "All agents MUST support
// resource links in prompts."
mod prompt_blocks {
    use super::super::agent_thread::build_prompt_blocks;
    use agent_client_protocol::schema::ContentBlock;

    fn kinds(blocks: &[ContentBlock]) -> Vec<&'static str> {
        blocks
            .iter()
            .map(|b| match b {
                ContentBlock::Text(_) => "text",
                ContentBlock::Image(_) => "image",
                ContentBlock::ResourceLink(_) => "resource_link",
                _ => "other",
            })
            .collect()
    }

    #[test]
    fn an_attachment_becomes_a_resource_link_not_prose() {
        let blocks = build_prompt_blocks(
            "summarise this".to_string(),
            None,
            &["/Users/p/Notesage/note.md".to_string()],
        );
        assert_eq!(kinds(&blocks), vec!["resource_link", "text"]);

        let ContentBlock::ResourceLink(link) = &blocks[0] else {
            panic!("expected a resource link, got {:?}", kinds(&blocks));
        };
        // A `file://` URI is what makes it resolvable rather than descriptive.
        assert_eq!(link.uri, "file:///Users/p/Notesage/note.md");
        // The basename is what a human recognises in an agent's own transcript;
        // the full path lives in the URI.
        assert_eq!(link.name, "note.md");
    }

    #[test]
    fn the_users_text_comes_last() {
        // The question should follow the material it refers to, not precede it.
        let blocks = build_prompt_blocks(
            "what changed?".to_string(),
            None,
            &["/a/one.md".to_string(), "/b/two.md".to_string()],
        );
        assert_eq!(kinds(&blocks), vec!["resource_link", "resource_link", "text"]);
    }

    #[test]
    fn no_attachments_produces_exactly_the_text_block() {
        // The overwhelmingly common case must not gain an empty block or an
        // extra round trip.
        let blocks = build_prompt_blocks("hello".to_string(), None, &[]);
        assert_eq!(kinds(&blocks), vec!["text"]);
    }

    #[test]
    fn a_path_with_no_basename_still_yields_a_usable_name() {
        // `file_name()` returns None for a trailing-slash or root path. Falling
        // back to the whole path keeps the link valid rather than panicking or
        // sending an empty name.
        let blocks = build_prompt_blocks("x".to_string(), None, &["/".to_string()]);
        let ContentBlock::ResourceLink(link) = &blocks[0] else {
            panic!("expected a resource link");
        };
        assert_eq!(link.name, "/");
        assert_eq!(link.uri, "file:///");
    }
}

// ---------------------------------------------------------------------------
// Permission-gate probe verdict
// ---------------------------------------------------------------------------
//
// pi's permission gate is a TypeScript extension shipped into pi's config dir,
// loaded at runtime and type-checked against nothing. If a pi upgrade stops it
// registering, pi runs non-read-only tools with NO prompt. The agent keeps
// working; it just stops asking — so every other signal, telemetry included,
// reads as HEALTHIER rather than broken. That is why the gate has to be
// provoked deliberately rather than waited for.
//
// The design decision lives entirely in `permission_verdict`, so it is tested
// here rather than only exercised through a live agent.
mod permission_probe {
    use super::super::{permission_verdict, PermissionVerdict};

    #[test]
    fn a_tool_call_with_no_prompt_is_the_failure() {
        // The one unambiguous case: pi acted, nothing asked. This is the state
        // in which a local agent writes files without permission.
        assert!(matches!(
            permission_verdict(true, false),
            PermissionVerdict::GateMissing(_)
        ));
    }

    #[test]
    fn a_permission_request_means_the_gate_works() {
        assert_eq!(permission_verdict(true, true), PermissionVerdict::Gated);
    }

    #[test]
    fn no_tool_call_is_inconclusive_not_a_failure() {
        // Small local models routinely answer in prose instead of acting. If
        // that failed setup, the check would block healthy agents at random —
        // and a check that cries wolf gets ignored, which protects nobody.
        //
        // This is the load-bearing half of the design: it is what keeps the
        // stage trustworthy enough to act on when it DOES fire.
        assert_eq!(permission_verdict(false, false), PermissionVerdict::Inconclusive);
    }

    #[test]
    fn a_prompt_with_no_observed_tool_call_still_counts_as_gated() {
        // The permission request itself is proof the extension loaded, whether
        // or not a `tool_call` update was seen first — ordering between the two
        // event streams is not guaranteed.
        assert_eq!(permission_verdict(false, true), PermissionVerdict::Gated);
    }
}

// The resource-link probe's design lives entirely in `resource_link_verdict`
// (#815), so it is tested here rather than through a real agent — which is what
// the issue said made this hard: no capability bit to read, and an agent that
// ignores the block returns a perfectly normal response.
mod resource_link_probe {
    use super::super::{resource_link_verdict, ResourceLinkVerdict};

    #[test]
    fn an_answer_without_the_token_means_the_link_was_ignored() {
        // The one unambiguous failure. The file was attached, the token was in
        // it, and the instruction asked for nothing else — an agent that
        // answered at length regardless never saw the file.
        let verdict = resource_link_verdict(true, false);
        assert!(
            matches!(verdict, ResourceLinkVerdict::Ignored(_)),
            "an agent that answers without the token must be reported, or the \
             attachment silently never reaches the model: {verdict:?}"
        );
    }

    #[test]
    fn the_token_coming_back_is_proof_the_file_was_read() {
        // Unguessable by construction, so it cannot arrive by luck.
        assert_eq!(resource_link_verdict(true, true), ResourceLinkVerdict::Honoured);
    }

    #[test]
    fn silence_is_not_evidence_of_anything() {
        // Deliberately NOT a failure, mirroring `permission_verdict`: small
        // local models time out and refuse, and a check that randomly blocks
        // registration on a healthy agent gets ignored. An ignored check
        // protects nobody.
        assert_eq!(
            resource_link_verdict(false, false),
            ResourceLinkVerdict::Inconclusive
        );
    }

    #[test]
    fn a_token_with_no_recorded_answer_still_counts_as_honoured() {
        // Defensive: `answered` is derived from the same accumulated text as
        // `echoed`, so this pairing should not occur — but if the two ever
        // diverge, having read the file is the stronger fact, and treating it
        // as inconclusive would throw away a definite pass.
        assert_eq!(
            resource_link_verdict(false, true),
            ResourceLinkVerdict::Honoured
        );
    }
}

// --- Permission waiters (audit 2026-11-22, test coverage) ---
//
// These three functions decide whether an agent's tool call goes ahead. They
// are the pure half of the permission round-trip in `agent_thread.rs`: the
// inbound handler parks a oneshot in the waiter map, and the command loop
// resolves it (`PermissionRespond`) or drops it (`Cancel`, `Stop`).
mod permission_waiters {
    use super::super::agent_thread::{
        cancel_permission_waiters, handle_permission_respond, permission_outcome,
    };
    use crate::commands::acp_client::{PermissionReply, PermissionWaiters};
    use agent_client_protocol::schema::RequestPermissionOutcome;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;

    fn waiters_with(ids: &[&str]) -> (PermissionWaiters, Vec<oneshot::Receiver<PermissionReply>>) {
        let waiters: PermissionWaiters = Arc::new(Mutex::new(HashMap::new()));
        let mut receivers = Vec::new();
        for id in ids {
            let (tx, rx) = oneshot::channel();
            waiters.lock().unwrap().insert(id.to_string(), tx);
            receivers.push(rx);
        }
        (waiters, receivers)
    }

    /// The option the agent would be told the user picked, if any.
    fn selected(outcome: &RequestPermissionOutcome) -> Option<String> {
        match outcome {
            RequestPermissionOutcome::Selected(s) => Some(s.option_id.to_string()),
            _ => None,
        }
    }

    fn is_cancelled(outcome: &RequestPermissionOutcome) -> bool {
        matches!(outcome, RequestPermissionOutcome::Cancelled)
    }

    #[test]
    fn a_chosen_option_is_the_only_thing_that_becomes_selected() {
        let chosen = permission_outcome(Some(PermissionReply {
            option_id: Some("allow-once".to_string()),
        }));
        assert_eq!(selected(&chosen).as_deref(), Some("allow-once"));

        // A reply that names no option, and a waiter that was dropped.
        assert!(is_cancelled(&permission_outcome(Some(PermissionReply { option_id: None }))));
        assert!(is_cancelled(&permission_outcome(None)));
    }

    #[test]
    fn a_response_reaches_the_request_it_names() {
        let (waiters, mut rxs) = waiters_with(&["perm-0", "perm-1"]);

        assert!(handle_permission_respond(
            &waiters,
            "perm-1".to_string(),
            Some("allow".to_string())
        ));

        let reply = rxs[1].try_recv().ok().expect("perm-1 is resolved");
        assert_eq!(reply.option_id.as_deref(), Some("allow"));
        // The other request is still waiting for its own answer.
        assert!(matches!(rxs[0].try_recv(), Err(oneshot::error::TryRecvError::Empty)));
        assert_eq!(waiters.lock().unwrap().len(), 1);
    }

    #[test]
    fn an_unknown_request_id_is_a_no_op() {
        let (waiters, mut rxs) = waiters_with(&["perm-0"]);

        assert!(!handle_permission_respond(
            &waiters,
            "perm-999".to_string(),
            Some("allow".to_string())
        ));

        // In particular the approval did not land on the request that IS pending.
        assert!(matches!(rxs[0].try_recv(), Err(oneshot::error::TryRecvError::Empty)));
        assert_eq!(waiters.lock().unwrap().len(), 1);
    }

    #[test]
    fn a_request_can_only_be_answered_once() {
        let (waiters, _rxs) = waiters_with(&["perm-0"]);
        assert!(handle_permission_respond(&waiters, "perm-0".to_string(), None));
        assert!(!handle_permission_respond(
            &waiters,
            "perm-0".to_string(),
            Some("allow".to_string())
        ));
    }

    #[tokio::test]
    async fn cancel_resolves_every_waiter_as_cancelled_never_as_an_approval() {
        let (waiters, rxs) = waiters_with(&["perm-0", "perm-1", "perm-2"]);

        assert_eq!(cancel_permission_waiters(&waiters), 3);
        assert!(waiters.lock().unwrap().is_empty());

        for rx in rxs {
            // Exactly what the inbound handler does with its receiver.
            let outcome = permission_outcome(rx.await.ok());
            assert!(is_cancelled(&outcome));
            assert_eq!(selected(&outcome), None);
        }
        // A decision arriving after the cancel has nothing left to approve.
        assert!(!handle_permission_respond(
            &waiters,
            "perm-1".to_string(),
            Some("allow".to_string())
        ));
    }

    #[test]
    fn a_poisoned_lock_still_delivers_and_still_cancels() {
        let (waiters, mut rxs) = waiters_with(&["perm-0", "perm-1"]);
        let poisoner = Arc::clone(&waiters);
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.lock().unwrap();
            panic!("poison the waiter lock");
        })
        .join();
        assert!(waiters.is_poisoned());

        assert!(handle_permission_respond(
            &waiters,
            "perm-0".to_string(),
            Some("allow".to_string())
        ));
        let delivered = rxs[0].try_recv().ok().expect("delivered despite the poisoned lock");
        assert_eq!(delivered.option_id.as_deref(), Some("allow"));

        assert_eq!(cancel_permission_waiters(&waiters), 1);
        assert!(matches!(rxs[1].try_recv(), Err(oneshot::error::TryRecvError::Closed)));
    }
}

// --- Bounded agent requests (audit 2026-11-22: init timeout, stuck command loop) ---
mod bounded_requests {
    use super::super::agent_thread::bounded;
    use std::time::Duration;

    #[tokio::test]
    async fn a_request_the_agent_never_answers_becomes_an_error() {
        // What `initialize` against a binary that does not speak ACP looks like.
        let never = std::future::pending::<Result<(), String>>();
        let err = bounded("ACP initialize", Duration::from_millis(50), never)
            .await
            .unwrap_err();
        assert!(err.starts_with("ACP initialize timed out"), "{err}");
    }

    #[tokio::test]
    async fn answers_and_errors_pass_through_with_the_usual_wording() {
        let ok = bounded("new_session", Duration::from_secs(5), async { Ok::<_, String>(7) }).await;
        assert_eq!(ok, Ok(7));

        let failed = bounded("new_session", Duration::from_secs(5), async {
            Err::<(), _>("connection closed")
        })
        .await;
        assert_eq!(failed, Err("new_session failed: connection closed".to_string()));
    }
}

// --- Stopping an agent whose command loop is stuck (audit 2026-11-22) ---
mod stop {
    use super::super::state::{sigkill_agent_child, AgentCmd};
    use super::super::stop_agent_thread;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::{mpsc, Notify};

    const GRACE: Duration = Duration::from_millis(100);

    #[tokio::test]
    async fn a_loop_that_answers_is_stopped_without_a_kill() {
        let (tx, mut rx) = mpsc::channel::<AgentCmd>(32);
        tokio::spawn(async move {
            if let Some(AgentCmd::Stop { reply }) = rx.recv().await {
                let _ = reply.send(Ok(()));
            }
        });

        let result = stop_agent_thread(&tx, GRACE, || panic!("no kill for a responsive loop")).await;

        assert_eq!(result, Ok(()));
    }

    #[tokio::test]
    async fn a_loop_stuck_behind_a_request_is_killed_and_then_answers() {
        // The loop is "awaiting an agent request" until the child is killed;
        // only then does it get to the queued Stop.
        let (tx, mut rx) = mpsc::channel::<AgentCmd>(32);
        let child_killed = Arc::new(Notify::new());
        let loop_side = Arc::clone(&child_killed);
        tokio::spawn(async move {
            loop_side.notified().await;
            if let Some(AgentCmd::Stop { reply }) = rx.recv().await {
                let _ = reply.send(Ok(()));
            }
        });
        let killed = Arc::new(AtomicBool::new(false));
        let killed_flag = Arc::clone(&killed);

        let result = tokio::time::timeout(
            Duration::from_secs(10),
            stop_agent_thread(&tx, GRACE, move || {
                killed_flag.store(true, Ordering::SeqCst);
                child_killed.notify_one();
            }),
        )
        .await
        .expect("stop must return even though the loop was stuck");

        assert_eq!(result, Ok(()));
        assert!(killed.load(Ordering::SeqCst), "the child is killed to unblock the loop");
    }

    #[tokio::test]
    async fn a_loop_that_never_answers_at_all_does_not_hang_the_stop() {
        // Nothing ever reads the channel. The old code awaited the reply forever.
        let (tx, _rx) = mpsc::channel::<AgentCmd>(32);
        let killed = Arc::new(AtomicBool::new(false));
        let killed_flag = Arc::clone(&killed);

        let result = tokio::time::timeout(
            Duration::from_secs(10),
            stop_agent_thread(&tx, GRACE, move || killed_flag.store(true, Ordering::SeqCst)),
        )
        .await
        .expect("stop must return");

        assert_eq!(result, Ok(()), "a forced stop is still a stop");
        assert!(killed.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn a_full_command_queue_does_not_hang_the_stop_either() {
        let (tx, _rx) = mpsc::channel::<AgentCmd>(1);
        tx.send(AgentCmd::PermissionRespond {
            request_id: "perm-0".to_string(),
            option_id: None,
        })
        .await
        .ok()
        .expect("the queue has room for one");
        let killed = Arc::new(AtomicBool::new(false));
        let killed_flag = Arc::clone(&killed);

        let result = tokio::time::timeout(
            Duration::from_secs(10),
            stop_agent_thread(&tx, GRACE, move || killed_flag.store(true, Ordering::SeqCst)),
        )
        .await
        .expect("stop must return");

        assert_eq!(result, Ok(()));
        assert!(killed.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn a_thread_that_is_already_gone_is_reported_not_killed() {
        let (tx, rx) = mpsc::channel::<AgentCmd>(32);
        drop(rx);

        let result = stop_agent_thread(&tx, GRACE, || panic!("nothing to kill")).await;

        assert_eq!(result, Err("Agent thread is no longer running".to_string()));
    }

    #[test]
    fn sigkill_does_nothing_before_the_child_exists() {
        // PID 0 would address our own process group.
        assert_eq!(sigkill_agent_child(&AtomicU32::new(0)), None);
    }

    #[cfg(unix)]
    #[test]
    fn sigkill_kills_the_recorded_child() {
        use std::os::unix::process::ExitStatusExt;
        let mut child = std::process::Command::new("sleep")
            .arg("60")
            .spawn()
            .expect("spawn sleep");
        let cell = AtomicU32::new(child.id());

        assert_eq!(sigkill_agent_child(&cell), Some(child.id()));

        let status = child.wait().expect("the child was killed, so wait returns");
        assert_eq!(status.signal(), Some(libc::SIGKILL));
    }
}
