//! Mock ACP agent binary for integration testing.
//!
//! Implements a minimal ACP server over stdio that responds to protocol
//! messages with fixture-driven, deterministic payloads. Used by the
//! integration tests in `tests/mock_acp_agent.rs` to verify that the
//! ACP wire protocol shape stays correct as the `agent-client-protocol`
//! crate version is bumped.
//!
//! ## Usage
//!
//! ```bash
//! mock-acp-agent --fixture <name> --profile <full|minimal>
//! ```
//!
//! ### Fixtures
//!
//! | Name               | What `prompt` emits                            |
//! |--------------------|------------------------------------------------|
//! | `text_response`    | `AgentMessageChunk`                            |
//! | `thinking_segment` | `AgentThoughtChunk` then `AgentMessageChunk`   |
//! | `tool_call_approval` | `ToolCall` (with permission round-trip) + `AgentMessageChunk` |
//! | `plan_update`      | `Plan` then `AgentMessageChunk`                |
//! | `usage_tracking`   | `AgentMessageChunk` then `UsageUpdate`         |
//!
//! ### Profiles
//!
//! | Profile  | Capabilities advertised in `initialize`                           |
//! |----------|-------------------------------------------------------------------|
//! | `full`   | `load_session=true`, `fork`, `resume`, `close`                    |
//! | `minimal`| `load_session=false`, no `fork`/`resume`/`close`                  |

use std::cell::Cell;

use agent_client_protocol::{self as acp, Client as _};
use tokio::sync::{mpsc, oneshot};
use tokio_util::compat::{TokioAsyncReadCompatExt as _, TokioAsyncWriteCompatExt as _};

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
enum Fixture {
    TextResponse,
    ThinkingSegment,
    ToolCallApproval,
    PlanUpdate,
    UsageTracking,
}

impl Fixture {
    fn parse(s: &str) -> Self {
        match s {
            "text_response" => Self::TextResponse,
            "thinking_segment" => Self::ThinkingSegment,
            "tool_call_approval" => Self::ToolCallApproval,
            "plan_update" => Self::PlanUpdate,
            "usage_tracking" => Self::UsageTracking,
            other => panic!("unknown fixture: {other}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Profile {
    Full,
    Minimal,
}

impl Profile {
    fn parse(s: &str) -> Self {
        match s {
            "full" => Self::Full,
            "minimal" => Self::Minimal,
            other => panic!("unknown profile: {other}"),
        }
    }
}

fn parse_args() -> (Fixture, Profile) {
    let args: Vec<String> = std::env::args().collect();
    let mut fixture = None;
    let mut profile = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--fixture" => {
                i += 1;
                fixture = Some(Fixture::parse(&args[i]));
            }
            "--profile" => {
                i += 1;
                profile = Some(Profile::parse(&args[i]));
            }
            other => panic!("unknown argument: {other}"),
        }
        i += 1;
    }

    (
        fixture.expect("--fixture is required"),
        profile.expect("--profile is required"),
    )
}

// ---------------------------------------------------------------------------
// Notification channel message
// ---------------------------------------------------------------------------

/// A session notification to send, plus a one-shot channel to signal
/// once the notification has been sent (so the `prompt` handler can
/// wait for each notification before returning).
type NotifMsg = (acp::SessionNotification, oneshot::Sender<()>);

// ---------------------------------------------------------------------------
// MockAgent — implements the Agent trait
// ---------------------------------------------------------------------------

struct MockAgent {
    fixture: Fixture,
    profile: Profile,
    next_session_id: Cell<u64>,
    /// Channel for handing notifications to the background sender task.
    notif_tx: mpsc::UnboundedSender<NotifMsg>,
}

impl MockAgent {
    fn new(
        fixture: Fixture,
        profile: Profile,
        notif_tx: mpsc::UnboundedSender<NotifMsg>,
    ) -> Self {
        Self {
            fixture,
            profile,
            next_session_id: Cell::new(1),
            notif_tx,
        }
    }

    /// Build the capabilities response for `initialize` based on the profile.
    fn capabilities(&self) -> acp::AgentCapabilities {
        match self.profile {
            Profile::Full => {
                let session_caps = acp::SessionCapabilities::new()
                    .fork(Some(acp::SessionForkCapabilities::new()))
                    .resume(Some(acp::SessionResumeCapabilities::new()))
                    .close(Some(acp::SessionCloseCapabilities::new()));
                acp::AgentCapabilities::new()
                    .load_session(true)
                    .session_capabilities(session_caps)
            }
            Profile::Minimal => acp::AgentCapabilities::new().load_session(false),
        }
    }
}

// ---------------------------------------------------------------------------
// Agent trait implementation
// ---------------------------------------------------------------------------

#[async_trait::async_trait(?Send)]
impl acp::Agent for MockAgent {
    async fn initialize(
        &self,
        _args: acp::InitializeRequest,
    ) -> acp::Result<acp::InitializeResponse> {
        Ok(
            acp::InitializeResponse::new(acp::ProtocolVersion::V1)
                .agent_info(
                    acp::Implementation::new("mock-acp-agent", "0.0.1")
                        .title("Mock ACP Agent"),
                )
                .agent_capabilities(self.capabilities()),
        )
    }

    async fn authenticate(
        &self,
        _args: acp::AuthenticateRequest,
    ) -> acp::Result<acp::AuthenticateResponse> {
        Ok(acp::AuthenticateResponse::default())
    }

    async fn new_session(
        &self,
        _args: acp::NewSessionRequest,
    ) -> acp::Result<acp::NewSessionResponse> {
        let id = self.next_session_id.get();
        self.next_session_id.set(id + 1);
        Ok(acp::NewSessionResponse::new(format!("session-{id}")))
    }

    async fn load_session(
        &self,
        _args: acp::LoadSessionRequest,
    ) -> acp::Result<acp::LoadSessionResponse> {
        Ok(acp::LoadSessionResponse::new())
    }

    async fn prompt(
        &self,
        args: acp::PromptRequest,
    ) -> acp::Result<acp::PromptResponse> {
        let sid = &args.session_id;

        // Enqueue updates and await each ack channel.
        match &self.fixture {
            Fixture::TextResponse => {
                send_and_wait(
                    &self.notif_tx,
                    acp::SessionNotification::new(
                        sid.clone(),
                        acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new(
                            acp::ContentBlock::Text(acp::TextContent::new("Hello!")),
                        )),
                    ),
                )
                .await?;
            }

            Fixture::ThinkingSegment => {
                send_and_wait(
                    &self.notif_tx,
                    acp::SessionNotification::new(
                        sid.clone(),
                        acp::SessionUpdate::AgentThoughtChunk(acp::ContentChunk::new(
                            acp::ContentBlock::Text(acp::TextContent::new(
                                "Let me think about this…",
                            )),
                        )),
                    ),
                )
                .await?;

                send_and_wait(
                    &self.notif_tx,
                    acp::SessionNotification::new(
                        sid.clone(),
                        acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new(
                            acp::ContentBlock::Text(acp::TextContent::new("Done thinking.")),
                        )),
                    ),
                )
                .await?;
            }

            Fixture::ToolCallApproval => {
                let tool_call_id = acp::ToolCallId::new("tc-1");
                send_and_wait(
                    &self.notif_tx,
                    acp::SessionNotification::new(
                        sid.clone(),
                        acp::SessionUpdate::ToolCall(
                            acp::ToolCall::new(tool_call_id.clone(), "read_file"),
                        ),
                    ),
                )
                .await?;

                send_and_wait(
                    &self.notif_tx,
                    acp::SessionNotification::new(
                        sid.clone(),
                        acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new(
                            acp::ContentBlock::Text(acp::TextContent::new("Tool called.")),
                        )),
                    ),
                )
                .await?;
            }

            Fixture::PlanUpdate => {
                let plan = acp::Plan::new(vec![acp::PlanEntry::new(
                    "Analyse the codebase",
                    acp::PlanEntryPriority::High,
                    acp::PlanEntryStatus::Pending,
                )]);

                send_and_wait(
                    &self.notif_tx,
                    acp::SessionNotification::new(
                        sid.clone(),
                        acp::SessionUpdate::Plan(plan),
                    ),
                )
                .await?;

                send_and_wait(
                    &self.notif_tx,
                    acp::SessionNotification::new(
                        sid.clone(),
                        acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new(
                            acp::ContentBlock::Text(acp::TextContent::new("Plan sent.")),
                        )),
                    ),
                )
                .await?;
            }

            Fixture::UsageTracking => {
                send_and_wait(
                    &self.notif_tx,
                    acp::SessionNotification::new(
                        sid.clone(),
                        acp::SessionUpdate::AgentMessageChunk(acp::ContentChunk::new(
                            acp::ContentBlock::Text(acp::TextContent::new("Response.")),
                        )),
                    ),
                )
                .await?;

                send_and_wait(
                    &self.notif_tx,
                    acp::SessionNotification::new(
                        sid.clone(),
                        acp::SessionUpdate::UsageUpdate(acp::UsageUpdate::new(1024, 200_000)),
                    ),
                )
                .await?;
            }
        }

        Ok(acp::PromptResponse::new(acp::StopReason::EndTurn))
    }

    async fn cancel(&self, _args: acp::CancelNotification) -> acp::Result<()> {
        Ok(())
    }

    async fn set_session_mode(
        &self,
        _args: acp::SetSessionModeRequest,
    ) -> acp::Result<acp::SetSessionModeResponse> {
        Ok(acp::SetSessionModeResponse::default())
    }

    async fn set_session_config_option(
        &self,
        _args: acp::SetSessionConfigOptionRequest,
    ) -> acp::Result<acp::SetSessionConfigOptionResponse> {
        Ok(acp::SetSessionConfigOptionResponse::new(vec![]))
    }

    async fn list_sessions(
        &self,
        _args: acp::ListSessionsRequest,
    ) -> acp::Result<acp::ListSessionsResponse> {
        Ok(acp::ListSessionsResponse::new(vec![]))
    }

    #[cfg(feature = "unstable_session_fork")]
    async fn fork_session(
        &self,
        args: acp::ForkSessionRequest,
    ) -> acp::Result<acp::ForkSessionResponse> {
        let id = self.next_session_id.get();
        self.next_session_id.set(id + 1);
        let _ = args;
        Ok(acp::ForkSessionResponse::new(format!("fork-{id}")))
    }

    #[cfg(feature = "unstable_session_resume")]
    async fn resume_session(
        &self,
        _args: acp::ResumeSessionRequest,
    ) -> acp::Result<acp::ResumeSessionResponse> {
        Ok(acp::ResumeSessionResponse::new())
    }

    #[cfg(feature = "unstable_session_close")]
    async fn close_session(
        &self,
        _args: acp::CloseSessionRequest,
    ) -> acp::Result<acp::CloseSessionResponse> {
        Ok(acp::CloseSessionResponse::default())
    }

    async fn ext_method(&self, _args: acp::ExtRequest) -> acp::Result<acp::ExtResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn ext_notification(&self, _args: acp::ExtNotification) -> acp::Result<()> {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helper: send a notification via the channel and await the ack
// ---------------------------------------------------------------------------

async fn send_and_wait(
    tx: &mpsc::UnboundedSender<NotifMsg>,
    notif: acp::SessionNotification,
) -> acp::Result<()> {
    let (done_tx, done_rx) = oneshot::channel();
    tx.send((notif, done_tx))
        .map_err(|_| acp::Error::internal_error())?;
    done_rx.await.map_err(|_| acp::Error::internal_error())
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[tokio::main(flavor = "current_thread")]
async fn main() -> acp::Result<()> {
    let (fixture, profile) = parse_args();

    let outgoing = tokio::io::stdout().compat_write();
    let incoming = tokio::io::stdin().compat();

    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let (notif_tx, mut notif_rx) =
                tokio::sync::mpsc::unbounded_channel::<NotifMsg>();

            let agent = MockAgent::new(fixture, profile, notif_tx);

            let (conn, handle_io) =
                acp::AgentSideConnection::new(agent, outgoing, incoming, |fut| {
                    tokio::task::spawn_local(fut);
                });

            // Background task: drain the notification channel and forward
            // each notification to the client, then ack back to the agent.
            tokio::task::spawn_local(async move {
                while let Some((notif, ack)) = notif_rx.recv().await {
                    if let Err(e) = conn.session_notification(notif).await {
                        eprintln!("mock-acp-agent: send error: {e}");
                        break;
                    }
                    let _ = ack.send(());
                }
            });

            handle_io.await
        })
        .await
}
