/// Integration tests for the ACP client against a real mock agent subprocess.
///
/// These tests exercise the ACP protocol by spawning a compiled mock ACP agent
/// binary and communicating with it over stdin/stdout using `ClientSideConnection`
/// — the same path the live app takes.
///
/// Coverage (from aw-review gap lists on PRs #261 and #266):
///   - Capability-gated protocol calls (close_session, fork_session,
///     resume_session) and `supports_images` / session capability fields.
///   - Fixture-driven prompt calls: session notifications (AgentThoughtChunk,
///     ToolCall, Plan, UsageUpdate) are emitted from the mock agent and
///     received by a RecordingClient, verifying the full notification path.
///   - Full session lifecycle: init → new_session → prompt → close_session.
///
/// RED GATE: `env!("CARGO_BIN_EXE_mock_acp_agent")` fails to compile when no
/// [[bin]] named `mock_acp_agent` exists in Cargo.toml. Adding the binary
/// source + the [[bin]] entry turns this green.

const _MOCK_AGENT_BIN: &str = env!("CARGO_BIN_EXE_mock_acp_agent");

use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent_client_protocol::{
    ClientSideConnection, CloseSessionRequest, ContentBlock, ForkSessionRequest, InitializeRequest,
    NewSessionRequest, PromptRequest, ProtocolVersion, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, ResumeSessionRequest, SessionNotification,
    SessionUpdate, TextContent,
};
use tokio::process::Command;
use tokio::task::LocalSet;
use tokio::time::timeout;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

// ---------------------------------------------------------------------------
// NoopClient — for capability / lifecycle tests that don't need notifications
// ---------------------------------------------------------------------------

struct NoopClient;

#[async_trait::async_trait(?Send)]
impl agent_client_protocol::Client for NoopClient {
    async fn request_permission(
        &self,
        _args: RequestPermissionRequest,
    ) -> agent_client_protocol::Result<RequestPermissionResponse> {
        Ok(RequestPermissionResponse::new(
            RequestPermissionOutcome::Cancelled,
        ))
    }

    async fn session_notification(
        &self,
        _args: SessionNotification,
    ) -> agent_client_protocol::Result<()> {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// RecordingClient — for fixture tests that assert on received notifications
// ---------------------------------------------------------------------------

struct RecordingClient {
    updates: Arc<Mutex<Vec<SessionUpdate>>>,
}

#[async_trait::async_trait(?Send)]
impl agent_client_protocol::Client for RecordingClient {
    async fn request_permission(
        &self,
        _args: RequestPermissionRequest,
    ) -> agent_client_protocol::Result<RequestPermissionResponse> {
        use agent_client_protocol::{
            PermissionOptionId, SelectedPermissionOutcome,
        };
        Ok(RequestPermissionResponse::new(
            RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                PermissionOptionId::new("allow_once"),
            )),
        ))
    }

    async fn session_notification(
        &self,
        args: SessionNotification,
    ) -> agent_client_protocol::Result<()> {
        self.updates.lock().unwrap().push(args.update);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// spawn_connected — NoopClient variant (for capability / lifecycle tests)
// ---------------------------------------------------------------------------

async fn spawn_connected(
    profile: &str,
) -> (
    ClientSideConnection,
    impl std::future::Future<Output = agent_client_protocol::Result<()>>,
) {
    let mut child = Command::new(_MOCK_AGENT_BIN)
        .arg("--profile")
        .arg(profile)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("failed to spawn mock_acp_agent");

    let stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");

    let outgoing = stdin.compat_write();
    let incoming = stdout.compat();

    let (conn, run_future) = ClientSideConnection::new(
        NoopClient,
        outgoing,
        incoming,
        |fut| {
            tokio::task::spawn_local(fut);
        },
    );

    (conn, run_future)
}

// ---------------------------------------------------------------------------
// spawn_recording — RecordingClient variant (for fixture / prompt tests)
// ---------------------------------------------------------------------------

async fn spawn_recording(
    fixture: &str,
    profile: &str,
) -> (
    ClientSideConnection,
    impl std::future::Future<Output = agent_client_protocol::Result<()>>,
    Arc<Mutex<Vec<SessionUpdate>>>,
) {
    let mut child = Command::new(_MOCK_AGENT_BIN)
        .arg("--fixture")
        .arg(fixture)
        .arg("--profile")
        .arg(profile)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("failed to spawn mock_acp_agent");

    let stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");

    let outgoing = stdin.compat_write();
    let incoming = stdout.compat();

    let updates: Arc<Mutex<Vec<SessionUpdate>>> = Arc::new(Mutex::new(Vec::new()));

    let (conn, run_future) = ClientSideConnection::new(
        RecordingClient {
            updates: updates.clone(),
        },
        outgoing,
        incoming,
        |fut| {
            tokio::task::spawn_local(fut);
        },
    );

    (conn, run_future, updates)
}

// ---------------------------------------------------------------------------
// bootstrap_session — initialize + new_session in one call
// ---------------------------------------------------------------------------

async fn bootstrap_session(
    conn: &ClientSideConnection,
    cwd: &str,
) -> agent_client_protocol::SessionId {
    timeout(
        Duration::from_secs(5),
        conn.initialize(InitializeRequest::new(ProtocolVersion::LATEST)),
    )
    .await
    .expect("initialize timed out")
    .expect("initialize failed");

    let session = timeout(
        Duration::from_secs(5),
        conn.new_session(NewSessionRequest::new(std::path::PathBuf::from(cwd))),
    )
    .await
    .expect("new_session timed out")
    .expect("new_session failed");

    session.session_id.clone()
}

// ---------------------------------------------------------------------------
// Tests — capability profiles (from PR #266 — NoopClient, no prompt needed)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn full_profile_initialize_returns_expected_capabilities() {
    let local = LocalSet::new();
    local
        .run_until(async {
            let (conn, run) = spawn_connected("full").await;
            tokio::task::spawn_local(async move {
                let _ = run.await;
            });

            let result = timeout(
                Duration::from_secs(5),
                conn.initialize(InitializeRequest::new(ProtocolVersion::LATEST)),
            )
            .await
            .expect("initialize timed out")
            .expect("initialize failed");

            let caps = &result.agent_capabilities;

            assert!(
                caps.prompt_capabilities.image,
                "full profile should support images"
            );
            assert!(
                caps.session_capabilities.fork.is_some(),
                "full profile should advertise fork capability"
            );
            assert!(
                caps.session_capabilities.resume.is_some(),
                "full profile should advertise resume capability"
            );
            assert!(
                caps.session_capabilities.close.is_some(),
                "full profile should advertise close capability"
            );
            assert!(caps.load_session, "full profile should advertise load_session");
        })
        .await;
}

#[tokio::test]
async fn minimal_profile_initialize_returns_no_session_capabilities() {
    let local = LocalSet::new();
    local
        .run_until(async {
            let (conn, run) = spawn_connected("minimal").await;
            tokio::task::spawn_local(async move {
                let _ = run.await;
            });

            let result = timeout(
                Duration::from_secs(5),
                conn.initialize(InitializeRequest::new(ProtocolVersion::LATEST)),
            )
            .await
            .expect("initialize timed out")
            .expect("initialize failed");

            let caps = &result.agent_capabilities;

            assert!(
                !caps.prompt_capabilities.image,
                "minimal profile should not support images"
            );
            assert!(
                caps.session_capabilities.fork.is_none(),
                "minimal profile should not advertise fork capability"
            );
            assert!(
                caps.session_capabilities.resume.is_none(),
                "minimal profile should not advertise resume capability"
            );
            assert!(
                caps.session_capabilities.close.is_none(),
                "minimal profile should not advertise close capability"
            );
        })
        .await;
}

#[tokio::test]
async fn full_profile_close_session_succeeds() {
    let local = LocalSet::new();
    local
        .run_until(async {
            let (conn, run) = spawn_connected("full").await;
            tokio::task::spawn_local(async move {
                let _ = run.await;
            });

            let session_id = bootstrap_session(&conn, "/tmp/test").await;

            let result = timeout(
                Duration::from_secs(5),
                conn.close_session(CloseSessionRequest::new(session_id)),
            )
            .await
            .expect("close_session timed out");

            assert!(result.is_ok(), "close_session should succeed on full profile");
        })
        .await;
}

#[tokio::test]
async fn full_profile_resume_session_succeeds() {
    let local = LocalSet::new();
    local
        .run_until(async {
            let (conn, run) = spawn_connected("full").await;
            tokio::task::spawn_local(async move {
                let _ = run.await;
            });

            let session_id = bootstrap_session(&conn, "/tmp/test").await;

            let result = timeout(
                Duration::from_secs(5),
                conn.resume_session(ResumeSessionRequest::new(
                    session_id,
                    std::path::PathBuf::from("/tmp/test"),
                )),
            )
            .await
            .expect("resume_session timed out");

            assert!(result.is_ok(), "resume_session should succeed on full profile");
        })
        .await;
}

#[tokio::test]
async fn full_profile_fork_session_succeeds() {
    let local = LocalSet::new();
    local
        .run_until(async {
            let (conn, run) = spawn_connected("full").await;
            tokio::task::spawn_local(async move {
                let _ = run.await;
            });

            let session_id = bootstrap_session(&conn, "/tmp/test").await;

            let result = timeout(
                Duration::from_secs(5),
                conn.fork_session(ForkSessionRequest::new(
                    session_id.clone(),
                    std::path::PathBuf::from("/tmp/test"),
                )),
            )
            .await
            .expect("fork_session timed out");

            assert!(result.is_ok(), "fork_session should succeed on full profile");
            let forked_id = result.unwrap().session_id.clone();
            assert_ne!(forked_id, session_id, "forked session id should differ");
        })
        .await;
}

#[tokio::test]
async fn minimal_profile_close_session_returns_method_not_found() {
    let local = LocalSet::new();
    local
        .run_until(async {
            let (conn, run) = spawn_connected("minimal").await;
            tokio::task::spawn_local(async move {
                let _ = run.await;
            });

            let session_id = bootstrap_session(&conn, "/tmp/test").await;

            let result = timeout(
                Duration::from_secs(5),
                conn.close_session(CloseSessionRequest::new(session_id)),
            )
            .await
            .expect("close_session timed out");

            assert!(
                result.is_err(),
                "close_session should fail on minimal profile"
            );
        })
        .await;
}

// ---------------------------------------------------------------------------
// Tests — full session lifecycle with prompt (fixture-driven)
// ---------------------------------------------------------------------------

/// Verifies the complete happy-path lifecycle with the full-capability profile:
/// initialize → session/new → session/prompt (text_response fixture) → session/close.
#[tokio::test]
async fn full_session_lifecycle_with_prompt() {
    let local = LocalSet::new();
    local
        .run_until(async {
            let (conn, run, _updates) = spawn_recording("text_response", "full").await;
            tokio::task::spawn_local(async move {
                let _ = run.await;
            });

            // 1. Initialize — verify full-capability profile
            let init_resp = timeout(
                Duration::from_secs(5),
                conn.initialize(InitializeRequest::new(ProtocolVersion::LATEST)),
            )
            .await
            .expect("initialize timed out")
            .expect("initialize failed");

            let caps = &init_resp.agent_capabilities;
            assert!(caps.load_session, "full profile must advertise load_session");
            assert!(
                caps.session_capabilities.fork.is_some(),
                "full profile must advertise session.fork"
            );
            assert!(
                caps.session_capabilities.close.is_some(),
                "full profile must advertise session.close"
            );

            // 2. New session
            let new_sess_resp = timeout(
                Duration::from_secs(5),
                conn.new_session(NewSessionRequest::new(std::path::PathBuf::from("/tmp"))),
            )
            .await
            .expect("new_session timed out")
            .expect("new_session failed");
            let session_id = new_sess_resp.session_id.clone();

            // 3. Prompt — the mock sends notifications then returns EndTurn
            let prompt_resp = timeout(
                Duration::from_secs(5),
                conn.prompt(PromptRequest::new(
                    session_id.clone(),
                    vec![ContentBlock::Text(TextContent::new("hello"))],
                )),
            )
            .await
            .expect("prompt timed out")
            .expect("prompt failed");

            assert_eq!(
                prompt_resp.stop_reason,
                agent_client_protocol::StopReason::EndTurn,
                "expected end_turn stop reason from text_response fixture"
            );

            // 4. Close session
            timeout(
                Duration::from_secs(5),
                conn.close_session(CloseSessionRequest::new(session_id)),
            )
            .await
            .expect("close_session timed out")
            .expect("close_session failed");
        })
        .await;
}

// ---------------------------------------------------------------------------
// Tests — fixture-driven prompt notifications
// ---------------------------------------------------------------------------

#[tokio::test]
async fn thinking_segment_fixture_emits_agent_thought_chunk() {
    let local = LocalSet::new();
    local
        .run_until(async {
            let (conn, run, updates) = spawn_recording("thinking_segment", "full").await;
            tokio::task::spawn_local(async move {
                let _ = run.await;
            });

            let session_id = bootstrap_session(&conn, "/tmp").await;

            timeout(
                Duration::from_secs(5),
                conn.prompt(PromptRequest::new(
                    session_id,
                    vec![ContentBlock::Text(TextContent::new("think"))],
                )),
            )
            .await
            .expect("prompt timed out")
            .expect("prompt failed");

            let got = updates.lock().unwrap().clone();
            assert!(
                got.iter().any(|u| matches!(u, SessionUpdate::AgentThoughtChunk(_))),
                "thinking_segment fixture must emit AgentThoughtChunk; got: {:?}",
                got.iter().map(discriminant_name).collect::<Vec<_>>()
            );
        })
        .await;
}

#[tokio::test]
async fn tool_call_fixture_emits_tool_call_update() {
    let local = LocalSet::new();
    local
        .run_until(async {
            let (conn, run, updates) = spawn_recording("tool_call_approval", "full").await;
            tokio::task::spawn_local(async move {
                let _ = run.await;
            });

            let session_id = bootstrap_session(&conn, "/tmp").await;

            timeout(
                Duration::from_secs(5),
                conn.prompt(PromptRequest::new(
                    session_id,
                    vec![ContentBlock::Text(TextContent::new("use tool"))],
                )),
            )
            .await
            .expect("prompt timed out")
            .expect("prompt failed");

            let got = updates.lock().unwrap().clone();
            assert!(
                got.iter().any(|u| matches!(u, SessionUpdate::ToolCall(_))),
                "tool_call_approval fixture must emit ToolCall; got: {:?}",
                got.iter().map(discriminant_name).collect::<Vec<_>>()
            );
        })
        .await;
}

#[tokio::test]
async fn plan_update_fixture_emits_plan() {
    let local = LocalSet::new();
    local
        .run_until(async {
            let (conn, run, updates) = spawn_recording("plan_update", "full").await;
            tokio::task::spawn_local(async move {
                let _ = run.await;
            });

            let session_id = bootstrap_session(&conn, "/tmp").await;

            timeout(
                Duration::from_secs(5),
                conn.prompt(PromptRequest::new(
                    session_id,
                    vec![ContentBlock::Text(TextContent::new("plan"))],
                )),
            )
            .await
            .expect("prompt timed out")
            .expect("prompt failed");

            let got = updates.lock().unwrap().clone();
            assert!(
                got.iter().any(|u| matches!(u, SessionUpdate::Plan(_))),
                "plan_update fixture must emit Plan; got: {:?}",
                got.iter().map(discriminant_name).collect::<Vec<_>>()
            );
        })
        .await;
}

#[tokio::test]
async fn usage_tracking_fixture_emits_usage_update() {
    let local = LocalSet::new();
    local
        .run_until(async {
            let (conn, run, updates) = spawn_recording("usage_tracking", "full").await;
            tokio::task::spawn_local(async move {
                let _ = run.await;
            });

            let session_id = bootstrap_session(&conn, "/tmp").await;

            timeout(
                Duration::from_secs(5),
                conn.prompt(PromptRequest::new(
                    session_id,
                    vec![ContentBlock::Text(TextContent::new("usage"))],
                )),
            )
            .await
            .expect("prompt timed out")
            .expect("prompt failed");

            let got = updates.lock().unwrap().clone();
            assert!(
                got.iter().any(|u| matches!(u, SessionUpdate::UsageUpdate(_))),
                "usage_tracking fixture must emit UsageUpdate; got: {:?}",
                got.iter().map(discriminant_name).collect::<Vec<_>>()
            );
        })
        .await;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

fn discriminant_name(u: &SessionUpdate) -> &'static str {
    match u {
        SessionUpdate::UserMessageChunk(_) => "UserMessageChunk",
        SessionUpdate::AgentMessageChunk(_) => "AgentMessageChunk",
        SessionUpdate::AgentThoughtChunk(_) => "AgentThoughtChunk",
        SessionUpdate::ToolCall(_) => "ToolCall",
        SessionUpdate::ToolCallUpdate(_) => "ToolCallUpdate",
        SessionUpdate::Plan(_) => "Plan",
        SessionUpdate::AvailableCommandsUpdate(_) => "AvailableCommandsUpdate",
        SessionUpdate::CurrentModeUpdate(_) => "CurrentModeUpdate",
        SessionUpdate::ConfigOptionUpdate(_) => "ConfigOptionUpdate",
        SessionUpdate::SessionInfoUpdate(_) => "SessionInfoUpdate",
        SessionUpdate::UsageUpdate(_) => "UsageUpdate",
        _ => "Unknown",
    }
}
