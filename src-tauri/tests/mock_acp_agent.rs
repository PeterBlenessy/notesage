//! Integration tests for a mock ACP agent on agent-client-protocol 0.12.1.
//!
//! These tests stand up a **mock agent** (built with `Agent.builder()` and a
//! request handler per client→agent method) and a **mock client** (built with
//! `Client.builder()`), wire them together over the crate's own in-memory
//! [`Channel::duplex`] transport, and drive real ACP round-trips between them.
//!
//! Because the ACP crate types (`InitializeRequest`, `NewSessionRequest`,
//! `PromptRequest`, the capability structs, etc.) are used directly throughout,
//! an ACP crate version bump that renames or reshapes any of them causes a
//! compile error here — immediate protocol-regression feedback.
//!
//! ## How the harness works
//!
//! - `Channel::duplex()` returns a paired pair of in-memory endpoints. One half
//!   is handed to the agent's `connect_with`, the other to the client's. Both
//!   `connect_with` futures run concurrently via `tokio::join!`; the messages
//!   each side emits arrive on the other side's channel.
//! - The client's driving closure (`main_fn`) performs the requests and the
//!   assertions, then signals `done` so the agent's driving closure returns and
//!   its connection shuts down cleanly.
//! - The mock agent's behaviour (which capabilities it advertises, what session
//!   IDs it mints) is configured via [`CapabilityProfile`] and shared
//!   `Arc<Mutex<…>>` state that the handlers read/write.
//!
//! All `unstable_*` features are unconditionally enabled for this crate in
//! `Cargo.toml`, so there is no feature-gating inside these tests.
//!
//! ## Running
//!
//! ```bash
//! cd src-tauri
//! cargo test --test mock_acp_agent
//! ```

use std::sync::{Arc, Mutex};

use agent_client_protocol::role::acp::{Agent, Client};
use agent_client_protocol::schema::{
    AgentCapabilities, AuthenticateRequest, AuthenticateResponse, CancelNotification,
    CloseSessionRequest, CloseSessionResponse, ForkSessionRequest, ForkSessionResponse,
    Implementation, InitializeRequest, InitializeResponse, ListSessionsRequest,
    ListSessionsResponse, LoadSessionRequest, LoadSessionResponse, NewSessionRequest,
    NewSessionResponse, PermissionOption, PermissionOptionId, PermissionOptionKind,
    PromptCapabilities, PromptRequest, PromptResponse, ProtocolVersion, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, ResumeSessionRequest,
    ResumeSessionResponse, SelectedPermissionOutcome, SessionCapabilities,
    SessionCloseCapabilities, SessionForkCapabilities, SessionId, SessionInfo, SessionNotification,
    SessionConfigId, SessionConfigValueId, SessionResumeCapabilities,
    SetSessionConfigOptionRequest, SetSessionConfigOptionResponse, SetSessionModeRequest,
    SetSessionModeResponse, StopReason, ToolCallUpdate, ToolCallUpdateFields,
};
use agent_client_protocol::{Channel, ConnectionTo, Responder};

// ---------------------------------------------------------------------------
// MockAgent — configurable ACP agent state for in-memory testing
// ---------------------------------------------------------------------------

/// Capability profile for the mock agent.
#[derive(Clone, Copy, Debug)]
enum CapabilityProfile {
    /// Full capabilities: fork, resume, close, images.
    Full,
    /// Minimal: no fork/resume/close, no images.
    Minimal,
}

/// Mutable mock-agent state shared across all the request handlers.
///
/// `Arc<Mutex<…>>` (rather than the pre-0.12 `&self` trait methods) because the
/// 0.12 builder handlers are `Send` closures that may run on any task.
#[derive(Clone)]
struct MockAgentState {
    profile: CapabilityProfile,
    sessions: Arc<Mutex<Vec<SessionId>>>,
    /// When `true`, the `session/prompt` handler first sends an agent-initiated
    /// `session/request_permission` request to the client and records the
    /// returned outcome in `permission_outcome`. Default `false` so existing
    /// prompt-driven tests are unaffected.
    request_permission_on_prompt: bool,
    /// Captures the `RequestPermissionOutcome` the client returned to the
    /// agent's `session/request_permission` request (set by the prompt handler
    /// when `request_permission_on_prompt` is enabled).
    permission_outcome: Arc<Mutex<Option<RequestPermissionOutcome>>>,
}

impl MockAgentState {
    fn new(profile: CapabilityProfile) -> Self {
        Self {
            profile,
            sessions: Arc::new(Mutex::new(Vec::new())),
            request_permission_on_prompt: false,
            permission_outcome: Arc::new(Mutex::new(None)),
        }
    }

    /// Build the `InitializeResponse` for this profile. Mirrors the production
    /// agent's capability advertisement (read by `acp.rs`).
    fn initialize_response(&self, protocol_version: ProtocolVersion) -> InitializeResponse {
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

        InitializeResponse::new(protocol_version)
            .agent_capabilities(caps)
            .agent_info(Implementation::new("mock-agent", "0.0.0"))
    }
}

/// Build a mock-agent connection builder with handlers registered for every
/// request type the client may send (plus the cancel notification), then run
/// `driver` as the agent's `main_fn`.
///
/// `driver` receives the agent-side [`ConnectionTo<Client>`], which it can use
/// to push `session/update` notifications. Here the driver simply awaits the
/// `done` signal so the connection stays alive for the client's whole run.
async fn run_mock_agent(
    state: MockAgentState,
    transport: Channel,
    done_rx: tokio::sync::oneshot::Receiver<()>,
) -> Result<(), agent_client_protocol::Error> {
    // Each handler clones the bits of state it needs.
    let init_state = state.clone();
    let new_state = state.clone();
    let list_state = state.clone();
    let fork_state = state.clone();
    let resume_state = state.clone();
    let close_state = state.clone();
    let prompt_state = state.clone();

    Agent
        .builder()
        .name("mock-agent")
        // session/initialize
        .on_receive_request(
            move |req: InitializeRequest,
                  responder: Responder<InitializeResponse>,
                  _cx: ConnectionTo<Client>| {
                let state = init_state.clone();
                async move { responder.respond(state.initialize_response(req.protocol_version)) }
            },
            agent_client_protocol::on_receive_request!(),
        )
        // session/authenticate
        .on_receive_request(
            move |_req: AuthenticateRequest,
                  responder: Responder<AuthenticateResponse>,
                  _cx: ConnectionTo<Client>| async move {
                responder.respond(AuthenticateResponse::new())
            },
            agent_client_protocol::on_receive_request!(),
        )
        // session/new
        .on_receive_request(
            move |_req: NewSessionRequest,
                  responder: Responder<NewSessionResponse>,
                  _cx: ConnectionTo<Client>| {
                let state = new_state.clone();
                async move {
                    let id = SessionId::new("mock-session-1");
                    state.sessions.lock().unwrap().push(id.clone());
                    responder.respond(NewSessionResponse::new(id))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        // session/load
        .on_receive_request(
            move |_req: LoadSessionRequest,
                  responder: Responder<LoadSessionResponse>,
                  _cx: ConnectionTo<Client>| async move {
                responder.respond(LoadSessionResponse::new())
            },
            agent_client_protocol::on_receive_request!(),
        )
        // session/list
        .on_receive_request(
            move |_req: ListSessionsRequest,
                  responder: Responder<ListSessionsResponse>,
                  _cx: ConnectionTo<Client>| {
                let state = list_state.clone();
                async move {
                    let sessions: Vec<SessionInfo> = state
                        .sessions
                        .lock()
                        .unwrap()
                        .iter()
                        .map(|id| SessionInfo::new(id.clone(), "/tmp"))
                        .collect();
                    responder.respond(ListSessionsResponse::new(sessions))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        // session/set_mode
        .on_receive_request(
            move |_req: SetSessionModeRequest,
                  responder: Responder<SetSessionModeResponse>,
                  _cx: ConnectionTo<Client>| async move {
                responder.respond(SetSessionModeResponse::new())
            },
            agent_client_protocol::on_receive_request!(),
        )
        // session/set_config_option
        .on_receive_request(
            move |_req: SetSessionConfigOptionRequest,
                  responder: Responder<SetSessionConfigOptionResponse>,
                  _cx: ConnectionTo<Client>| async move {
                responder.respond(SetSessionConfigOptionResponse::new(vec![]))
            },
            agent_client_protocol::on_receive_request!(),
        )
        // session/prompt
        .on_receive_request(
            move |req: PromptRequest,
                  responder: Responder<PromptResponse>,
                  cx: ConnectionTo<Client>| {
                let state = prompt_state.clone();
                async move {
                    if !state.request_permission_on_prompt {
                        return responder.respond(PromptResponse::new(StopReason::EndTurn));
                    }

                    // Exercise the agent-initiated permission round-trip: send a
                    // `session/request_permission` request *to the client* and
                    // record the outcome it returns. This is the inbound-request
                    // path the production client handles via a waiter + Tauri
                    // event + async `responder.respond`.
                    //
                    // The nested request MUST run on a spawned task, not inline
                    // in the handler: the event loop cannot process the client's
                    // response while a handler is awaiting, so blocking here would
                    // deadlock. `cx.spawn` mirrors production's `cx.spawn` +
                    // async `responder.respond`. The prompt response is only sent
                    // once the outcome is captured, so the client's `prompt`
                    // await resolves *after* `permission_outcome` is populated —
                    // fully deterministic, no sleeps.
                    let session_id = req.session_id.clone();
                    cx.spawn({
                        let cx = cx.clone();
                        let state = state.clone();
                        async move {
                            let perm_req = RequestPermissionRequest::new(
                                session_id,
                                ToolCallUpdate::new("tool-call-1", ToolCallUpdateFields::new()),
                                vec![
                                    PermissionOption::new(
                                        "allow-once",
                                        "Allow once",
                                        PermissionOptionKind::AllowOnce,
                                    ),
                                    PermissionOption::new(
                                        "reject-once",
                                        "Reject once",
                                        PermissionOptionKind::RejectOnce,
                                    ),
                                ],
                            );
                            let perm_resp = cx.send_request(perm_req).block_task().await?;
                            *state.permission_outcome.lock().unwrap() = Some(perm_resp.outcome);
                            responder.respond(PromptResponse::new(StopReason::EndTurn))
                        }
                    })?;
                    Ok(())
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        // session/fork
        .on_receive_request(
            move |req: ForkSessionRequest,
                  responder: Responder<ForkSessionResponse>,
                  _cx: ConnectionTo<Client>| {
                let state = fork_state.clone();
                async move {
                    let new_id =
                        SessionId::new(format!("fork-of-{}", req.session_id.0.as_ref()));
                    state.sessions.lock().unwrap().push(new_id.clone());
                    responder.respond(ForkSessionResponse::new(new_id))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        // session/resume
        .on_receive_request(
            move |req: ResumeSessionRequest,
                  responder: Responder<ResumeSessionResponse>,
                  _cx: ConnectionTo<Client>| {
                let state = resume_state.clone();
                async move {
                    let known = state.sessions.lock().unwrap().contains(&req.session_id);
                    if known {
                        responder.respond(ResumeSessionResponse::new())
                    } else {
                        responder
                            .respond_with_error(agent_client_protocol::Error::invalid_params())
                    }
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        // session/close
        .on_receive_request(
            move |req: CloseSessionRequest,
                  responder: Responder<CloseSessionResponse>,
                  _cx: ConnectionTo<Client>| {
                let state = close_state.clone();
                async move {
                    state
                        .sessions
                        .lock()
                        .unwrap()
                        .retain(|id| id != &req.session_id);
                    responder.respond(CloseSessionResponse::new())
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        // session/cancel (notification — fire-and-forget)
        .on_receive_notification(
            move |_n: CancelNotification, _cx: ConnectionTo<Client>| async move { Ok(()) },
            agent_client_protocol::on_receive_notification!(),
        )
        .connect_with(transport, async move |_conn: ConnectionTo<Client>| {
            // Keep the agent connection alive until the client is done.
            let _ = done_rx.await;
            Ok(())
        })
        .await
}

// ---------------------------------------------------------------------------
// NoopClient handlers — minimal Client-side responders
// ---------------------------------------------------------------------------

/// Captured session notifications, for tests that want to inspect them.
type Notifications = Arc<Mutex<Vec<SessionNotification>>>;

/// Run the mock client: register the permission + session-notification handlers,
/// then execute `scenario` (the per-test round-trips/assertions) as the client's
/// `main_fn`. Signals `done` when `scenario` returns so the agent shuts down.
async fn run_client<F>(
    transport: Channel,
    notifications: Notifications,
    done_tx: tokio::sync::oneshot::Sender<()>,
    scenario: F,
) -> Result<(), agent_client_protocol::Error>
where
    F: AsyncFnOnce(ConnectionTo<Agent>) -> Result<(), agent_client_protocol::Error>,
{
    let notif_for_handler = notifications.clone();
    let done_cell = Arc::new(Mutex::new(Some(done_tx)));

    Client
        .builder()
        .name("mock-client")
        // session/request_permission — the production client registers a waiter,
        // emits a Tauri event, and responds asynchronously. Here the mock client
        // selects the first offered option, exercising the inbound-request →
        // response round-trip end-to-end.
        .on_receive_request(
            move |req: RequestPermissionRequest,
                  responder: Responder<RequestPermissionResponse>,
                  _cx: ConnectionTo<Agent>| async move {
                // Pick the first offered option if any; otherwise cancel.
                let outcome = match req.options.first() {
                    Some(opt) => RequestPermissionOutcome::Selected(
                        SelectedPermissionOutcome::new(opt.option_id.clone()),
                    ),
                    None => RequestPermissionOutcome::Cancelled,
                };
                responder.respond(RequestPermissionResponse::new(outcome))
            },
            agent_client_protocol::on_receive_request!(),
        )
        // session/update — record notifications
        .on_receive_notification(
            move |n: SessionNotification, _cx: ConnectionTo<Agent>| {
                let notifs = notif_for_handler.clone();
                async move {
                    notifs.lock().unwrap().push(n);
                    Ok(())
                }
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .connect_with(transport, async move |conn: ConnectionTo<Agent>| {
            let result = scenario(conn).await;
            // Tell the agent it can shut down now that the scenario is done.
            if let Some(tx) = done_cell.lock().unwrap().take() {
                let _ = tx.send(());
            }
            result
        })
        .await
}

/// Spin up a paired mock agent + mock client over an in-memory `Channel::duplex`
/// transport, run `scenario` against the live `ConnectionTo<Agent>`, and join
/// both ends. Panics with the scenario's error if it failed.
async fn with_agent_and_client<F>(profile: CapabilityProfile, scenario: F)
where
    F: AsyncFnOnce(ConnectionTo<Agent>) -> Result<(), agent_client_protocol::Error>,
{
    let state = MockAgentState::new(profile);
    let notifications: Notifications = Arc::new(Mutex::new(Vec::new()));

    // Paired in-memory endpoints: messages sent on one arrive on the other.
    let (agent_channel, client_channel) = Channel::duplex();
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();

    let agent_fut = run_mock_agent(state, agent_channel, done_rx);
    let client_fut = run_client(client_channel, notifications, done_tx, scenario);

    let (agent_res, client_res) = tokio::join!(agent_fut, client_fut);
    agent_res.expect("mock agent connection failed");
    client_res.expect("mock client scenario failed");
}

/// Like [`with_agent_and_client`] but enables the agent's
/// `request_permission_on_prompt` behaviour and returns the
/// `RequestPermissionOutcome` the client returned to the agent's
/// agent-initiated `session/request_permission` request.
async fn with_agent_and_client_capturing_permission<F>(
    profile: CapabilityProfile,
    scenario: F,
) -> Option<RequestPermissionOutcome>
where
    F: AsyncFnOnce(ConnectionTo<Agent>) -> Result<(), agent_client_protocol::Error>,
{
    let mut state = MockAgentState::new(profile);
    state.request_permission_on_prompt = true;
    let outcome_cell = state.permission_outcome.clone();

    let notifications: Notifications = Arc::new(Mutex::new(Vec::new()));

    let (agent_channel, client_channel) = Channel::duplex();
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();

    let agent_fut = run_mock_agent(state, agent_channel, done_rx);
    let client_fut = run_client(client_channel, notifications, done_tx, scenario);

    let (agent_res, client_res) = tokio::join!(agent_fut, client_fut);
    agent_res.expect("mock agent connection failed");
    client_res.expect("mock client scenario failed");

    let outcome = outcome_cell.lock().unwrap().clone();
    outcome
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// Full lifecycle: initialize → session/new → session/prompt → session/close.
/// Verifies the happy-path sequence with strongly-typed ACP crate values.
#[tokio::test]
async fn full_lifecycle_initialize_new_prompt_close() {
    with_agent_and_client(CapabilityProfile::Full, async |conn: ConnectionTo<Agent>| {
        // initialize
        let init_resp = conn
            .send_request(
                InitializeRequest::new(ProtocolVersion::V1)
                    .client_info(Implementation::new("notesage-test", "0.0.0")),
            )
            .block_task()
            .await?;
        assert_eq!(init_resp.protocol_version, ProtocolVersion::V1);

        // session/new
        let new_resp = conn
            .send_request(NewSessionRequest::new("/tmp"))
            .block_task()
            .await?;
        assert_eq!(new_resp.session_id, SessionId::new("mock-session-1"));

        // session/prompt
        let prompt_resp = conn
            .send_request(PromptRequest::new(new_resp.session_id.clone(), vec![]))
            .block_task()
            .await?;
        assert_eq!(prompt_resp.stop_reason, StopReason::EndTurn);

        // session/close
        let _close_resp = conn
            .send_request(CloseSessionRequest::new(new_resp.session_id))
            .block_task()
            .await?;
        Ok(())
    })
    .await;
}

/// Full capability profile: initialize response advertises image support
/// and all session capabilities (fork, resume, close).
#[tokio::test]
async fn full_profile_advertises_all_capabilities() {
    with_agent_and_client(CapabilityProfile::Full, async |conn: ConnectionTo<Agent>| {
        let init_resp = conn
            .send_request(InitializeRequest::new(ProtocolVersion::V1))
            .block_task()
            .await?;

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
        Ok(())
    })
    .await;
}

/// Minimal capability profile: initialize response does NOT advertise image
/// support or session fork/resume/close.
#[tokio::test]
async fn minimal_profile_advertises_no_optional_capabilities() {
    with_agent_and_client(
        CapabilityProfile::Minimal,
        async |conn: ConnectionTo<Agent>| {
            let init_resp = conn
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;

            assert!(
                !init_resp.agent_capabilities.prompt_capabilities.image,
                "Minimal profile must NOT advertise image support"
            );
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
            Ok(())
        },
    )
    .await;
}

/// Session listing via `session/list` returns the newly created session.
#[tokio::test]
async fn list_sessions_returns_created_session() {
    with_agent_and_client(
        CapabilityProfile::Minimal,
        async |conn: ConnectionTo<Agent>| {
            conn.send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;

            conn.send_request(NewSessionRequest::new("/tmp"))
                .block_task()
                .await?;

            let list_resp = conn
                .send_request(ListSessionsRequest::new())
                .block_task()
                .await?;

            assert_eq!(list_resp.sessions.len(), 1);
            assert_eq!(
                list_resp.sessions[0].session_id,
                SessionId::new("mock-session-1")
            );
            Ok(())
        },
    )
    .await;
}

/// Fork session (full profile) creates a new session ID derived from the
/// original session's ID — verifying the fork code path.
#[tokio::test]
async fn fork_session_full_profile() {
    with_agent_and_client(CapabilityProfile::Full, async |conn: ConnectionTo<Agent>| {
        conn.send_request(InitializeRequest::new(ProtocolVersion::V1))
            .block_task()
            .await?;

        let new_resp = conn
            .send_request(NewSessionRequest::new("/tmp"))
            .block_task()
            .await?;

        let fork_resp = conn
            .send_request(ForkSessionRequest::new(new_resp.session_id.clone(), "/tmp"))
            .block_task()
            .await?;

        // Fork ID must differ from original
        assert_ne!(fork_resp.session_id, new_resp.session_id);
        Ok(())
    })
    .await;
}

/// Resume session (full profile) succeeds for an existing session.
#[tokio::test]
async fn resume_session_full_profile_existing_session() {
    with_agent_and_client(CapabilityProfile::Full, async |conn: ConnectionTo<Agent>| {
        conn.send_request(InitializeRequest::new(ProtocolVersion::V1))
            .block_task()
            .await?;

        let new_resp = conn
            .send_request(NewSessionRequest::new("/tmp"))
            .block_task()
            .await?;

        // Resume the same session — should succeed
        conn.send_request(ResumeSessionRequest::new(new_resp.session_id, "/tmp"))
            .block_task()
            .await?;
        Ok(())
    })
    .await;
}

/// `supports_images` extracted from `initialize` response matches the profile.
/// This is the exact field read by `acp.rs`:
/// `resp.agent_capabilities.prompt_capabilities.image`.
#[tokio::test]
async fn supports_images_extracted_from_initialize_response() {
    // --- Full profile: supports_images = true ---
    with_agent_and_client(CapabilityProfile::Full, async |conn: ConnectionTo<Agent>| {
        let resp = conn
            .send_request(InitializeRequest::new(ProtocolVersion::V1))
            .block_task()
            .await?;
        let supports_images: bool = resp.agent_capabilities.prompt_capabilities.image;
        assert!(supports_images, "Full profile: supports_images must be true");
        Ok(())
    })
    .await;

    // --- Minimal profile: supports_images = false ---
    with_agent_and_client(
        CapabilityProfile::Minimal,
        async |conn: ConnectionTo<Agent>| {
            let resp = conn
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            let supports_images: bool = resp.agent_capabilities.prompt_capabilities.image;
            assert!(
                !supports_images,
                "Minimal profile: supports_images must be false"
            );
            Ok(())
        },
    )
    .await;
}

/// `session/set_config_option` round-trips through the mock handler. This is
/// the operation production now uses to apply the connection's default model
/// (ACP 0.14 removed the dedicated `session/set_model` request — model
/// selection is a config option with category "model").
#[tokio::test]
async fn set_session_config_option_round_trips() {
    with_agent_and_client(CapabilityProfile::Full, async |conn: ConnectionTo<Agent>| {
        conn.send_request(InitializeRequest::new(ProtocolVersion::V1))
            .block_task()
            .await?;

        let new_resp = conn
            .send_request(NewSessionRequest::new("/tmp"))
            .block_task()
            .await?;

        // set_config_option: returns a SetSessionConfigOptionResponse without
        // error — the same call applyConnectionModelOption issues for the
        // model-category option.
        let _resp = conn
            .send_request(SetSessionConfigOptionRequest::new(
                new_resp.session_id,
                SessionConfigId::new("model"),
                SessionConfigValueId::new("mock-model-1"),
            ))
            .block_task()
            .await?;
        Ok(())
    })
    .await;
}

/// Agent-initiated permission round-trip (#4): during `session/prompt` the
/// mock agent sends a `session/request_permission` request *to the client*.
/// The client's permission handler selects the first offered option; the
/// agent captures the returned outcome. This exercises the inbound-request →
/// response path end-to-end across the 0.12 builder/handler model — the same
/// path the production client handles via a waiter + Tauri event + async
/// `responder.respond`. Deterministic: relies entirely on request/response
/// awaiting, no sleeps.
#[tokio::test]
async fn agent_initiated_permission_request_round_trips() {
    let outcome = with_agent_and_client_capturing_permission(
        CapabilityProfile::Full,
        async |conn: ConnectionTo<Agent>| {
            conn.send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;

            let new_resp = conn
                .send_request(NewSessionRequest::new("/tmp"))
                .block_task()
                .await?;

            // Sending the prompt triggers the agent to issue a
            // `session/request_permission` request back to this client; the
            // client's handler responds before the prompt response returns.
            let prompt_resp = conn
                .send_request(PromptRequest::new(new_resp.session_id, vec![]))
                .block_task()
                .await?;
            assert_eq!(prompt_resp.stop_reason, StopReason::EndTurn);
            Ok(())
        },
    )
    .await;

    // The agent must have received the client's response to its permission
    // request, and that response must select the first offered option.
    match outcome {
        Some(RequestPermissionOutcome::Selected(selected)) => {
            assert_eq!(
                selected.option_id,
                PermissionOptionId::new("allow-once"),
                "client must have selected the first offered option"
            );
        }
        other => panic!(
            "expected Selected(allow-once) outcome from the agent-initiated \
             permission round-trip, got {other:?}"
        ),
    }
}
