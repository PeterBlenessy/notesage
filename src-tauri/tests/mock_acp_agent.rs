/// Integration tests for the ACP client against a real mock agent subprocess.
///
/// These tests exercise the Tauri command-layer code paths (acp.rs / acp_client.rs)
/// by spawning a compiled mock ACP agent binary and communicating with it over
/// stdin/stdout using `ClientSideConnection` — the same path the live app takes.
///
/// Coverage targets (from aw-review gap list on PR #261):
///   - Gap 1: capability-gated protocol calls (close_session, fork_session,
///     resume_session, load_session) and `supports_images` extraction — previously
///     these code paths were bypassed because tests only called
///     `ClientSideConnection` with in-process fakes.
///
/// RED GATE: `env!("CARGO_BIN_EXE_mock_acp_agent")` fails to compile when no
/// [[bin]] named `mock_acp_agent` exists in Cargo.toml. Adding the binary
/// source + the [[bin]] entry turns this green.

// The env! macro expands to the binary path at compile time.
// If the [[bin]] target does not exist, cargo refuses to compile this test.
const _MOCK_AGENT_BIN: &str = env!("CARGO_BIN_EXE_mock_acp_agent");

use std::process::Stdio;
use std::time::Duration;

use agent_client_protocol::ClientSideConnection;
use tokio::process::Command;
use tokio::task::LocalSet;
use tokio::time::timeout;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

// ---------------------------------------------------------------------------
// Test helper — spawn the mock agent and return a connected ClientSideConnection.
// ---------------------------------------------------------------------------

/// Spawn the mock binary with `profile` and wire up a `ClientSideConnection`.
///
/// Returns `(conn, run_future)` where `run_future` must be driven to
/// completion (or until the test is done) on the same thread as `conn`.
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

    // ClientSideConnection uses futures_io AsyncRead/AsyncWrite.
    // tokio_util::compat bridges the tokio types.
    let outgoing = stdin.compat_write();
    let incoming = stdout.compat();

    // No-op client — we only care about what the agent side says.
    struct NoopClient;
    #[async_trait::async_trait(?Send)]
    impl agent_client_protocol::Client for NoopClient {
        async fn request_permission(
            &self,
            _args: agent_client_protocol::RequestPermissionRequest,
        ) -> agent_client_protocol::Result<agent_client_protocol::RequestPermissionResponse> {
            use agent_client_protocol::{RequestPermissionOutcome, RequestPermissionResponse};
            Ok(RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled))
        }

        async fn session_notification(
            &self,
            _args: agent_client_protocol::SessionNotification,
        ) -> agent_client_protocol::Result<()> {
            Ok(())
        }
    }

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
// Tests — full capability profile
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
                conn.initialize(agent_client_protocol::InitializeRequest::new(
                    agent_client_protocol::ProtocolVersion::LATEST,
                )),
            )
            .await
            .expect("initialize timed out")
            .expect("initialize failed");

            let caps = &result.agent_capabilities;

            // Full profile advertises image support.
            assert!(
                caps.prompt_capabilities.image,
                "full profile should support images"
            );

            // Full profile advertises session capabilities (fork, resume, close).
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

            // Full profile advertises load_session.
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
                conn.initialize(agent_client_protocol::InitializeRequest::new(
                    agent_client_protocol::ProtocolVersion::LATEST,
                )),
            )
            .await
            .expect("initialize timed out")
            .expect("initialize failed");

            let caps = &result.agent_capabilities;

            // Minimal profile does NOT advertise image support.
            assert!(
                !caps.prompt_capabilities.image,
                "minimal profile should not support images"
            );

            // Minimal profile has no session capabilities.
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

// ---------------------------------------------------------------------------
// Tests — session lifecycle calls on full profile
// ---------------------------------------------------------------------------

/// Helper — initialize + new_session in one go.
async fn bootstrap_session(
    conn: &ClientSideConnection,
    cwd: &str,
) -> agent_client_protocol::SessionId {
    timeout(
        Duration::from_secs(5),
        conn.initialize(agent_client_protocol::InitializeRequest::new(
            agent_client_protocol::ProtocolVersion::LATEST,
        )),
    )
    .await
    .expect("initialize timed out")
    .expect("initialize failed");

    let session = timeout(
        Duration::from_secs(5),
        conn.new_session(agent_client_protocol::NewSessionRequest::new(
            std::path::PathBuf::from(cwd),
        )),
    )
    .await
    .expect("new_session timed out")
    .expect("new_session failed");

    session.session_id.clone()
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
                conn.close_session(agent_client_protocol::CloseSessionRequest::new(
                    session_id,
                )),
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
                conn.resume_session(agent_client_protocol::ResumeSessionRequest::new(
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
                conn.fork_session(agent_client_protocol::ForkSessionRequest::new(
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
                conn.close_session(agent_client_protocol::CloseSessionRequest::new(session_id)),
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
