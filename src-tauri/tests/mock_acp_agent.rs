/// Integration tests for the mock ACP agent binary.
///
/// These tests spawn the mock-acp-agent binary (built as part of `cargo test`)
/// and exercise the ACP stdio protocol through `ClientSideConnection` to
/// verify that ACP-touching code in `acp.rs` / `acp_client.rs` stays
/// protocol-correct as we bump the `agent-client-protocol` crate.
///
/// The binary path is resolved at compile time via `env!("CARGO_BIN_EXE_mock-acp-agent")`.

use std::sync::{Arc, Mutex};

use agent_client_protocol::{
    Agent, AuthenticateRequest, CloseSessionRequest, ClientSideConnection, ContentBlock,
    InitializeRequest, NewSessionRequest, PromptRequest, RequestPermissionRequest,
    RequestPermissionResponse, SessionCapabilities, SessionNotification, SessionUpdate, StopReason,
    TextContent,
};
use tokio::process::Command;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

/// Path to the compiled mock-acp-agent binary, set at compile time.
const MOCK_AGENT_BIN: &str = env!("CARGO_BIN_EXE_mock-acp-agent");

// ─── Shared helpers ───────────────────────────────────────────────────────────

/// A `Client` implementation that records all `session_notification` updates
/// and auto-approves any permission requests.
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
            PermissionOptionId, RequestPermissionOutcome, SelectedPermissionOutcome,
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

/// Spawn the mock-acp-agent subprocess and return a `(ClientSideConnection, io_task, child)` tuple.
///
/// `fixture` — name of the fixture scenario (e.g. `"text_response"`).
/// `profile` — capability profile: `"full"` | `"minimal"`.
async fn spawn_client(
    fixture: &str,
    profile: &str,
) -> (
    ClientSideConnection,
    impl std::future::Future<Output = agent_client_protocol::Result<()>>,
    tokio::process::Child,
    Arc<Mutex<Vec<SessionUpdate>>>,
) {
    let mut child = Command::new(MOCK_AGENT_BIN)
        .arg("--fixture")
        .arg(fixture)
        .arg("--profile")
        .arg(profile)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .spawn()
        .expect("failed to spawn mock-acp-agent — was it built?");

    let stdin = child.stdin.take().unwrap().compat_write();
    let stdout = child.stdout.take().unwrap().compat();

    let updates: Arc<Mutex<Vec<SessionUpdate>>> = Arc::new(Mutex::new(Vec::new()));

    let (conn, io_task) = ClientSideConnection::new(
        RecordingClient {
            updates: updates.clone(),
        },
        stdin,
        stdout,
        |fut| {
            tokio::task::spawn_local(fut);
        },
    );
    (conn, io_task, child, updates)
}

// ─── Test 1: Full session lifecycle ──────────────────────────────────────────

/// Verifies the complete happy-path lifecycle with the full-capability profile:
/// initialize → session/new → session/prompt (text_response fixture) → session/close.
///
/// Red test: fails until the mock-acp-agent binary exists and responds correctly.
#[tokio::test]
async fn test_full_session_lifecycle() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async {
            let (conn, io_task, mut child, _updates) =
                spawn_client("text_response", "full").await;
            tokio::task::spawn_local(async move {
                io_task.await.ok();
            });

            // 1. Initialize — verify full-capability profile
            let init_resp = conn
                .initialize(InitializeRequest::new(
                    agent_client_protocol::Implementation::new("notesage-test", "0.0.1"),
                    agent_client_protocol::AgentCapabilities::new(),
                ))
                .await
                .expect("initialize failed");

            let caps = init_resp.agent_capabilities;
            assert!(caps.load_session, "full profile must advertise load_session");
            assert!(
                caps.session_capabilities.fork.is_some(),
                "full profile must advertise session.fork"
            );
            assert!(
                caps.session_capabilities.resume.is_some(),
                "full profile must advertise session.resume"
            );
            assert!(
                caps.session_capabilities.close.is_some(),
                "full profile must advertise session.close"
            );

            // 2. New session
            let new_sess_resp = conn
                .new_session(NewSessionRequest::new("/tmp"))
                .await
                .expect("session/new failed");
            let session_id = new_sess_resp.session_id.clone();

            // 3. Prompt
            let prompt_resp = conn
                .prompt(PromptRequest::new(
                    session_id.clone(),
                    vec![ContentBlock::Text(TextContent::new("hello"))],
                ))
                .await
                .expect("session/prompt failed");
            assert_eq!(
                prompt_resp.stop_reason,
                StopReason::EndTurn,
                "expected end_turn stop reason from text_response fixture"
            );

            // 4. Close session
            conn.close_session(CloseSessionRequest::new(session_id))
                .await
                .expect("session/close failed");

            child.kill().await.ok();
        })
        .await;
}

// ─── Test 2: Minimal capability profile ──────────────────────────────────────

/// Verifies that the minimal profile does NOT advertise fork / resume / close
/// and does NOT advertise load_session.
///
/// Red test: fails until mock binary exists.
#[tokio::test]
async fn test_minimal_capability_profile() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async {
            let (conn, io_task, mut child, _updates) =
                spawn_client("text_response", "minimal").await;
            tokio::task::spawn_local(async move {
                io_task.await.ok();
            });

            let init_resp = conn
                .initialize(InitializeRequest::new(
                    agent_client_protocol::Implementation::new("notesage-test", "0.0.1"),
                    agent_client_protocol::AgentCapabilities::new(),
                ))
                .await
                .expect("initialize failed on minimal profile");

            let caps = init_resp.agent_capabilities;
            assert!(
                !caps.load_session,
                "minimal profile must NOT advertise load_session"
            );
            assert!(
                caps.session_capabilities.fork.is_none(),
                "minimal profile must NOT advertise session.fork"
            );
            assert!(
                caps.session_capabilities.resume.is_none(),
                "minimal profile must NOT advertise session.resume"
            );
            assert!(
                caps.session_capabilities.close.is_none(),
                "minimal profile must NOT advertise session.close"
            );

            child.kill().await.ok();
        })
        .await;
}

// ─── Test 3: Thinking segment fixture ────────────────────────────────────────

/// Verifies that the `thinking_segment` fixture emits at least one
/// `AgentThoughtChunk` session update.
///
/// Red test: fails until mock binary exists.
#[tokio::test]
async fn test_thinking_segment_fixture() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async {
            let (conn, io_task, mut child, updates) =
                spawn_client("thinking_segment", "full").await;
            tokio::task::spawn_local(async move {
                io_task.await.ok();
            });

            conn.initialize(InitializeRequest::new(
                agent_client_protocol::Implementation::new("notesage-test", "0.0.1"),
                agent_client_protocol::AgentCapabilities::new(),
            ))
            .await
            .expect("initialize failed");

            let new_sess = conn
                .new_session(NewSessionRequest::new("/tmp"))
                .await
                .expect("session/new failed");

            conn.prompt(PromptRequest::new(
                new_sess.session_id,
                vec![ContentBlock::Text(TextContent::new("think"))],
            ))
            .await
            .expect("prompt failed");

            let got_updates = updates.lock().unwrap().clone();
            let has_thought = got_updates
                .iter()
                .any(|u| matches!(u, SessionUpdate::AgentThoughtChunk(_)));
            assert!(
                has_thought,
                "thinking_segment fixture must emit at least one AgentThoughtChunk; got updates: {:?}",
                got_updates
                    .iter()
                    .map(|u| discriminant_name(u))
                    .collect::<Vec<_>>()
            );

            child.kill().await.ok();
        })
        .await;
}

// ─── Test 4: Tool call with approval fixture ──────────────────────────────────

/// Verifies that the `tool_call_approval` fixture emits a `ToolCall` update.
///
/// Red test: fails until mock binary exists.
#[tokio::test]
async fn test_tool_call_approval_fixture() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async {
            let (conn, io_task, mut child, updates) =
                spawn_client("tool_call_approval", "full").await;
            tokio::task::spawn_local(async move {
                io_task.await.ok();
            });

            conn.initialize(InitializeRequest::new(
                agent_client_protocol::Implementation::new("notesage-test", "0.0.1"),
                agent_client_protocol::AgentCapabilities::new(),
            ))
            .await
            .expect("initialize failed");

            let new_sess = conn
                .new_session(NewSessionRequest::new("/tmp"))
                .await
                .expect("session/new failed");

            conn.prompt(PromptRequest::new(
                new_sess.session_id,
                vec![ContentBlock::Text(TextContent::new("use tool"))],
            ))
            .await
            .expect("prompt failed");

            let got_updates = updates.lock().unwrap().clone();
            let has_tool_call = got_updates
                .iter()
                .any(|u| matches!(u, SessionUpdate::ToolCall(_)));
            assert!(
                has_tool_call,
                "tool_call_approval fixture must emit at least one ToolCall update; got: {:?}",
                got_updates
                    .iter()
                    .map(|u| discriminant_name(u))
                    .collect::<Vec<_>>()
            );

            child.kill().await.ok();
        })
        .await;
}

// ─── Test 5: Plan update fixture ─────────────────────────────────────────────

/// Verifies that the `plan_update` fixture emits a `Plan` session update.
///
/// Red test: fails until mock binary exists.
#[tokio::test]
async fn test_plan_update_fixture() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async {
            let (conn, io_task, mut child, updates) =
                spawn_client("plan_update", "full").await;
            tokio::task::spawn_local(async move {
                io_task.await.ok();
            });

            conn.initialize(InitializeRequest::new(
                agent_client_protocol::Implementation::new("notesage-test", "0.0.1"),
                agent_client_protocol::AgentCapabilities::new(),
            ))
            .await
            .expect("initialize failed");

            let new_sess = conn
                .new_session(NewSessionRequest::new("/tmp"))
                .await
                .expect("session/new failed");

            conn.prompt(PromptRequest::new(
                new_sess.session_id,
                vec![ContentBlock::Text(TextContent::new("plan"))],
            ))
            .await
            .expect("prompt failed");

            let got_updates = updates.lock().unwrap().clone();
            let has_plan = got_updates
                .iter()
                .any(|u| matches!(u, SessionUpdate::Plan(_)));
            assert!(
                has_plan,
                "plan_update fixture must emit at least one Plan update; got: {:?}",
                got_updates
                    .iter()
                    .map(|u| discriminant_name(u))
                    .collect::<Vec<_>>()
            );

            child.kill().await.ok();
        })
        .await;
}

// ─── Test 6: Usage tracking fixture ──────────────────────────────────────────

/// Verifies that the `usage_tracking` fixture emits a `UsageUpdate` notification.
///
/// Red test: fails until mock binary exists.
#[tokio::test]
async fn test_usage_tracking_fixture() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async {
            let (conn, io_task, mut child, updates) =
                spawn_client("usage_tracking", "full").await;
            tokio::task::spawn_local(async move {
                io_task.await.ok();
            });

            conn.initialize(InitializeRequest::new(
                agent_client_protocol::Implementation::new("notesage-test", "0.0.1"),
                agent_client_protocol::AgentCapabilities::new(),
            ))
            .await
            .expect("initialize failed");

            let new_sess = conn
                .new_session(NewSessionRequest::new("/tmp"))
                .await
                .expect("session/new failed");

            conn.prompt(PromptRequest::new(
                new_sess.session_id,
                vec![ContentBlock::Text(TextContent::new("usage"))],
            ))
            .await
            .expect("prompt failed");

            let got_updates = updates.lock().unwrap().clone();
            let has_usage = got_updates
                .iter()
                .any(|u| matches!(u, SessionUpdate::UsageUpdate(_)));
            assert!(
                has_usage,
                "usage_tracking fixture must emit at least one UsageUpdate; got: {:?}",
                got_updates
                    .iter()
                    .map(|u| discriminant_name(u))
                    .collect::<Vec<_>>()
            );

            child.kill().await.ok();
        })
        .await;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
