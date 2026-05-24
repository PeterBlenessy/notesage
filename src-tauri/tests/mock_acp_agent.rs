//! Integration tests for the mock ACP agent.
//!
//! These tests use the ACP crate's own `ClientSideConnection` and a
//! `MockAgent` (implementing the `Agent` trait) connected via in-memory
//! `tokio::io::duplex` channels.  No external binary spawn, no `AppHandle`,
//! and — critically — ACP crate types are used directly throughout.  An ACP
//! crate version bump that renames or reshapes `InitializeRequest`,
//! `NewSessionRequest`, `PromptRequest`, etc. will cause compile errors here,
//! giving immediate protocol-regression feedback.
//!
//! Because all `unstable_*` features are unconditionally enabled for this
//! crate in `Cargo.toml`, there is no feature-gating inside these tests:
//! all code paths are always compiled and exercised.
//!
//! ## Running
//!
//! ```bash
//! cd src-tauri
//! cargo test --test mock_acp_agent
//! ```
//!
//! These tests do **not** require `--include-ignored`; they run as part of
//! the standard `cargo test` suite.

use std::sync::{Arc, Mutex};

use agent_client_protocol::{
    Agent, AgentCapabilities, AgentSideConnection, AuthenticateRequest, AuthenticateResponse,
    CancelNotification, Client, ClientSideConnection, CloseSessionRequest, CloseSessionResponse,
    ForkSessionRequest, ForkSessionResponse, Implementation, InitializeRequest, InitializeResponse,
    ListSessionsRequest, ListSessionsResponse, LoadSessionRequest, LoadSessionResponse,
    NewSessionRequest, NewSessionResponse, PromptCapabilities, PromptRequest, PromptResponse,
    ProtocolVersion, RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    ResumeSessionRequest, ResumeSessionResponse, SessionCapabilities, SessionCloseCapabilities,
    SessionForkCapabilities, SessionId, SessionInfo, SessionNotification,
    SessionResumeCapabilities, SetSessionConfigOptionRequest, SetSessionConfigOptionResponse,
    SetSessionModeRequest, SetSessionModeResponse, StopReason,
};

// ---------------------------------------------------------------------------
// MockAgent — configurable ACP agent for in-memory testing
// ---------------------------------------------------------------------------

/// Capability profile for the mock agent.
#[derive(Clone, Debug)]
enum CapabilityProfile {
    /// Full capabilities: fork, resume, close, images.
    Full,
    /// Minimal: no fork/resume/close, no images.
    Minimal,
}

/// Recorded prompt requests for post-test inspection.
type PromptRecord = (SessionId, Vec<agent_client_protocol::ContentBlock>);

#[derive(Clone)]
struct MockAgent {
    profile: CapabilityProfile,
    sessions: Arc<Mutex<Vec<SessionId>>>,
    prompts: Arc<Mutex<Vec<PromptRecord>>>,
}

impl MockAgent {
    fn new(profile: CapabilityProfile) -> Self {
        Self {
            profile,
            sessions: Arc::new(Mutex::new(Vec::new())),
            prompts: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

#[async_trait::async_trait(?Send)]
impl Agent for MockAgent {
    async fn initialize(
        &self,
        req: InitializeRequest,
    ) -> agent_client_protocol::Result<InitializeResponse> {
        let supports_images = matches!(self.profile, CapabilityProfile::Full);
        let prompt_caps = PromptCapabilities::new().image(supports_images);

        let session_caps = match self.profile {
            CapabilityProfile::Full => SessionCapabilities::default()
                .fork(SessionForkCapabilities::default())
                .resume(SessionResumeCapabilities::default())
                .close(SessionCloseCapabilities::default()),
            CapabilityProfile::Minimal => SessionCapabilities::default(),
        };

        let caps = AgentCapabilities::new()
            .prompt_capabilities(prompt_caps)
            .session_capabilities(session_caps);

        Ok(InitializeResponse::new(req.protocol_version)
            .agent_capabilities(caps)
            .agent_info(Implementation::new("mock-agent", "0.0.0")))
    }

    async fn authenticate(
        &self,
        _req: AuthenticateRequest,
    ) -> agent_client_protocol::Result<AuthenticateResponse> {
        Ok(AuthenticateResponse::new())
    }

    async fn new_session(
        &self,
        _req: NewSessionRequest,
    ) -> agent_client_protocol::Result<NewSessionResponse> {
        let id = SessionId::new("mock-session-1");
        self.sessions.lock().unwrap().push(id.clone());
        Ok(NewSessionResponse::new(id))
    }

    async fn load_session(
        &self,
        _req: LoadSessionRequest,
    ) -> agent_client_protocol::Result<LoadSessionResponse> {
        Ok(LoadSessionResponse::new())
    }

    async fn list_sessions(
        &self,
        _req: ListSessionsRequest,
    ) -> agent_client_protocol::Result<ListSessionsResponse> {
        let sessions: Vec<SessionInfo> = self
            .sessions
            .lock()
            .unwrap()
            .iter()
            .map(|id| SessionInfo::new(id.clone(), "/tmp"))
            .collect();
        Ok(ListSessionsResponse::new(sessions))
    }

    async fn set_session_mode(
        &self,
        _req: SetSessionModeRequest,
    ) -> agent_client_protocol::Result<SetSessionModeResponse> {
        Ok(SetSessionModeResponse::new())
    }

    async fn set_session_config_option(
        &self,
        _req: SetSessionConfigOptionRequest,
    ) -> agent_client_protocol::Result<SetSessionConfigOptionResponse> {
        Ok(SetSessionConfigOptionResponse::new(vec![]))
    }

    async fn prompt(
        &self,
        req: PromptRequest,
    ) -> agent_client_protocol::Result<PromptResponse> {
        self.prompts
            .lock()
            .unwrap()
            .push((req.session_id, req.prompt));
        Ok(PromptResponse::new(StopReason::EndTurn))
    }

    async fn cancel(
        &self,
        _req: CancelNotification,
    ) -> agent_client_protocol::Result<()> {
        Ok(())
    }

    // All unstable_* features are enabled in Cargo.toml — no cfg guards needed.

    async fn fork_session(
        &self,
        req: ForkSessionRequest,
    ) -> agent_client_protocol::Result<ForkSessionResponse> {
        let new_id = SessionId::new(format!("fork-of-{}", req.session_id.0.as_ref()));
        self.sessions.lock().unwrap().push(new_id.clone());
        Ok(ForkSessionResponse::new(new_id))
    }

    async fn resume_session(
        &self,
        req: ResumeSessionRequest,
    ) -> agent_client_protocol::Result<ResumeSessionResponse> {
        if !self.sessions.lock().unwrap().contains(&req.session_id) {
            return Err(agent_client_protocol::Error::invalid_params());
        }
        Ok(ResumeSessionResponse::new())
    }

    async fn close_session(
        &self,
        req: CloseSessionRequest,
    ) -> agent_client_protocol::Result<CloseSessionResponse> {
        self.sessions
            .lock()
            .unwrap()
            .retain(|id| id != &req.session_id);
        Ok(CloseSessionResponse::new())
    }
}

// ---------------------------------------------------------------------------
// NoopClient — minimal Client impl for the agent side
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct NoopClient {
    notifications: Arc<Mutex<Vec<SessionNotification>>>,
}

impl NoopClient {
    fn new() -> Self {
        Self {
            notifications: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

#[async_trait::async_trait(?Send)]
impl Client for NoopClient {
    async fn request_permission(
        &self,
        _req: RequestPermissionRequest,
    ) -> agent_client_protocol::Result<RequestPermissionResponse> {
        Ok(RequestPermissionResponse::new(
            RequestPermissionOutcome::Cancelled,
        ))
    }

    async fn session_notification(
        &self,
        args: SessionNotification,
    ) -> agent_client_protocol::Result<()> {
        self.notifications.lock().unwrap().push(args);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// In-memory connection factory
// ---------------------------------------------------------------------------

/// Creates a paired `ClientSideConnection` (client view) and a future that
/// drives both IO loops.  Call this inside a `tokio::task::LocalSet`.
fn make_connection(
    agent: MockAgent,
) -> (ClientSideConnection, impl std::future::Future<Output = ()>) {
    use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

    // Two duplex channels cross-wired:
    //   client_conn reads from agent_writer, writes to agent_reader
    //   agent_conn  reads from client_writer, writes to client_reader
    let (client_reader, agent_writer) = tokio::io::duplex(65536);
    let (agent_reader, client_writer) = tokio::io::duplex(65536);

    let noop_client = NoopClient::new();

    let (client_conn, client_io) = ClientSideConnection::new(
        noop_client,
        agent_writer.compat_write(),
        agent_reader.compat(),
        |fut| {
            tokio::task::spawn_local(fut);
        },
    );

    let (_agent_conn, agent_io) = AgentSideConnection::new(
        agent,
        client_writer.compat_write(),
        client_reader.compat(),
        |fut| {
            tokio::task::spawn_local(fut);
        },
    );

    let combined = async move {
        tokio::join!(
            async { client_io.await.ok(); },
            async { agent_io.await.ok(); },
        );
    };

    (client_conn, combined)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// Full lifecycle: initialize → session/new → session/prompt → session/close.
/// Verifies the happy-path sequence with strongly-typed ACP crate values.
#[tokio::test]
async fn full_lifecycle_initialize_new_prompt_close() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async {
            let agent = MockAgent::new(CapabilityProfile::Full);
            let (conn, io) = make_connection(agent);
            tokio::task::spawn_local(io);

            // initialize
            let init_resp = conn
                .initialize(
                    InitializeRequest::new(ProtocolVersion::V1)
                        .client_info(Implementation::new("notesage-test", "0.0.0")),
                )
                .await
                .expect("initialize failed");
            assert_eq!(init_resp.protocol_version, ProtocolVersion::V1);

            // session/new
            let new_resp = conn
                .new_session(NewSessionRequest::new("/tmp"))
                .await
                .expect("new_session failed");
            assert_eq!(new_resp.session_id, SessionId::new("mock-session-1"));

            // session/prompt
            let prompt_resp = conn
                .prompt(PromptRequest::new(new_resp.session_id.clone(), vec![]))
                .await
                .expect("prompt failed");
            assert_eq!(prompt_resp.stop_reason, StopReason::EndTurn);

            // session/close
            let _close_resp = conn
                .close_session(CloseSessionRequest::new(new_resp.session_id))
                .await
                .expect("close_session failed");
        })
        .await;
}

/// Full capability profile: initialize response advertises image support
/// and all session capabilities (fork, resume, close).
#[tokio::test]
async fn full_profile_advertises_all_capabilities() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async {
            let agent = MockAgent::new(CapabilityProfile::Full);
            let (conn, io) = make_connection(agent);
            tokio::task::spawn_local(io);

            let init_resp = conn
                .initialize(InitializeRequest::new(ProtocolVersion::V1))
                .await
                .expect("initialize failed");

            // Mirrors `acp.rs`: `resp.agent_capabilities.prompt_capabilities.image`
            assert!(
                init_resp.agent_capabilities.prompt_capabilities.image,
                "Full profile must advertise image support (mirrors acp.rs)"
            );

            assert!(
                init_resp
                    .agent_capabilities
                    .session_capabilities
                    .fork
                    .is_some(),
                "Full profile must advertise fork capability"
            );

            assert!(
                init_resp
                    .agent_capabilities
                    .session_capabilities
                    .resume
                    .is_some(),
                "Full profile must advertise resume capability"
            );

            assert!(
                init_resp
                    .agent_capabilities
                    .session_capabilities
                    .close
                    .is_some(),
                "Full profile must advertise close capability"
            );
        })
        .await;
}

/// Minimal capability profile: initialize response does NOT advertise image
/// support or session fork/resume/close.
#[tokio::test]
async fn minimal_profile_advertises_no_optional_capabilities() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async {
            let agent = MockAgent::new(CapabilityProfile::Minimal);
            let (conn, io) = make_connection(agent);
            tokio::task::spawn_local(io);

            let init_resp = conn
                .initialize(InitializeRequest::new(ProtocolVersion::V1))
                .await
                .expect("initialize failed");

            // No images
            assert!(
                !init_resp.agent_capabilities.prompt_capabilities.image,
                "Minimal profile must NOT advertise image support"
            );

            // No fork/resume/close
            assert!(
                init_resp
                    .agent_capabilities
                    .session_capabilities
                    .fork
                    .is_none(),
                "Minimal profile must NOT advertise fork"
            );

            assert!(
                init_resp
                    .agent_capabilities
                    .session_capabilities
                    .resume
                    .is_none(),
                "Minimal profile must NOT advertise resume"
            );

            assert!(
                init_resp
                    .agent_capabilities
                    .session_capabilities
                    .close
                    .is_none(),
                "Minimal profile must NOT advertise close"
            );
        })
        .await;
}

/// Session listing via `session/list` returns the newly created session.
#[tokio::test]
async fn list_sessions_returns_created_session() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async {
            let agent = MockAgent::new(CapabilityProfile::Minimal);
            let (conn, io) = make_connection(agent);
            tokio::task::spawn_local(io);

            conn.initialize(InitializeRequest::new(ProtocolVersion::V1))
                .await
                .expect("initialize failed");

            conn.new_session(NewSessionRequest::new("/tmp"))
                .await
                .expect("new_session failed");

            let list_resp = conn
                .list_sessions(ListSessionsRequest::new())
                .await
                .expect("list_sessions failed");

            assert_eq!(list_resp.sessions.len(), 1);
            assert_eq!(
                list_resp.sessions[0].session_id,
                SessionId::new("mock-session-1")
            );
        })
        .await;
}

/// Fork session (full profile) creates a new session ID derived from the
/// original session's ID — verifying the fork code path.
#[tokio::test]
async fn fork_session_full_profile() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async {
            let agent = MockAgent::new(CapabilityProfile::Full);
            let (conn, io) = make_connection(agent);
            tokio::task::spawn_local(io);

            conn.initialize(InitializeRequest::new(ProtocolVersion::V1))
                .await
                .expect("initialize failed");

            let new_resp = conn
                .new_session(NewSessionRequest::new("/tmp"))
                .await
                .expect("new_session failed");

            let fork_resp = conn
                .fork_session(ForkSessionRequest::new(new_resp.session_id.clone(), "/tmp"))
                .await
                .expect("fork_session failed");

            // Fork ID must differ from original
            assert_ne!(fork_resp.session_id, new_resp.session_id);
        })
        .await;
}

/// Resume session (full profile) succeeds for an existing session.
#[tokio::test]
async fn resume_session_full_profile_existing_session() {
    let local = tokio::task::LocalSet::new();
    local
        .run_until(async {
            let agent = MockAgent::new(CapabilityProfile::Full);
            let (conn, io) = make_connection(agent);
            tokio::task::spawn_local(io);

            conn.initialize(InitializeRequest::new(ProtocolVersion::V1))
                .await
                .expect("initialize failed");

            let new_resp = conn
                .new_session(NewSessionRequest::new("/tmp"))
                .await
                .expect("new_session failed");

            // Resume the same session — should succeed
            conn.resume_session(ResumeSessionRequest::new(new_resp.session_id, "/tmp"))
                .await
                .expect("resume_session failed");
        })
        .await;
}

/// `supports_images` extracted from `initialize` response matches the Full
/// profile.  This is the exact field read by `acp.rs`:
/// `resp.agent_capabilities.prompt_capabilities.image`.
#[tokio::test]
async fn supports_images_extracted_from_initialize_response() {
    // --- Full profile: supports_images = true ---
    {
        let local = tokio::task::LocalSet::new();
        local
            .run_until(async {
                let agent = MockAgent::new(CapabilityProfile::Full);
                let (conn, io) = make_connection(agent);
                tokio::task::spawn_local(io);

                let resp = conn
                    .initialize(InitializeRequest::new(ProtocolVersion::V1))
                    .await
                    .expect("initialize failed");

                // This is the exact field read by production acp.rs
                let supports_images: bool = resp.agent_capabilities.prompt_capabilities.image;
                assert!(supports_images, "Full profile: supports_images must be true");
            })
            .await;
    }

    // --- Minimal profile: supports_images = false ---
    {
        let local = tokio::task::LocalSet::new();
        local
            .run_until(async {
                let agent = MockAgent::new(CapabilityProfile::Minimal);
                let (conn, io) = make_connection(agent);
                tokio::task::spawn_local(io);

                let resp = conn
                    .initialize(InitializeRequest::new(ProtocolVersion::V1))
                    .await
                    .expect("initialize failed");

                let supports_images: bool = resp.agent_capabilities.prompt_capabilities.image;
                assert!(
                    !supports_images,
                    "Minimal profile: supports_images must be false"
                );
            })
            .await;
    }
}
