//! Mock ACP agent binary for integration tests.
//!
//! Supports fixture-driven prompt responses and two capability profiles.
//!
//! ## Usage
//!
//! ```text
//! mock_acp_agent [--fixture <name>] [--profile <full|minimal>]
//! ```
//!
//! ### Fixtures (default: text_response)
//!
//! | Name                 | What `prompt` emits                                      |
//! |----------------------|----------------------------------------------------------|
//! | `text_response`      | `AgentMessageChunk`                                      |
//! | `thinking_segment`   | `AgentThoughtChunk` then `AgentMessageChunk`             |
//! | `tool_call_approval` | `ToolCall` then `AgentMessageChunk`                      |
//! | `plan_update`        | `Plan` then `AgentMessageChunk`                          |
//! | `usage_tracking`     | `AgentMessageChunk` then `UsageUpdate`                   |
//!
//! ### Profiles (default: minimal)
//!
//! | Profile   | Capabilities                                                        |
//! |-----------|---------------------------------------------------------------------|
//! | `full`    | image support, load_session=true, fork/resume/close session caps    |
//! | `minimal` | no optional caps; lifecycle ops return method_not_found             |

use std::cell::Cell;

use agent_client_protocol as acp;
use tokio::sync::{mpsc, oneshot};
use tokio_util::compat::{TokioAsyncReadCompatExt as _, TokioAsyncWriteCompatExt as _};

// ---------------------------------------------------------------------------
// CLI argument types
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
    let mut fixture = Fixture::TextResponse;
    let mut profile = Profile::Minimal;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--fixture" => {
                i += 1;
                fixture = Fixture::parse(&args[i]);
            }
            "--profile" => {
                i += 1;
                profile = Profile::parse(&args[i]);
            }
            other => panic!("unknown argument: {other}"),
        }
        i += 1;
    }

    (fixture, profile)
}

// ---------------------------------------------------------------------------
// Notification channel type
// ---------------------------------------------------------------------------

type NotifMsg = (acp::SessionNotification, oneshot::Sender<()>);

// ---------------------------------------------------------------------------
// MockAgent — implements acp::Agent
// ---------------------------------------------------------------------------

struct MockAgent {
    fixture: Fixture,
    profile: Profile,
    next_id: Cell<u64>,
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
            next_id: Cell::new(0),
            notif_tx,
        }
    }

    fn next_session_id(&self) -> acp::SessionId {
        let id = self.next_id.get();
        self.next_id.set(id + 1);
        acp::SessionId::new(format!("mock-session-{id}"))
    }

    fn capabilities(&self) -> acp::AgentCapabilities {
        match self.profile {
            Profile::Full => acp::AgentCapabilities::new()
                .prompt_capabilities(acp::PromptCapabilities::new().image(true))
                .load_session(true)
                .session_capabilities(
                    acp::SessionCapabilities::new()
                        .fork(acp::SessionForkCapabilities::new())
                        .resume(acp::SessionResumeCapabilities::new())
                        .close(acp::SessionCloseCapabilities::new()),
                ),
            Profile::Minimal => acp::AgentCapabilities::new(),
        }
    }
}

// ---------------------------------------------------------------------------
// Helper: enqueue a notification and await the ack
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
// Agent trait implementation
// ---------------------------------------------------------------------------

#[async_trait::async_trait(?Send)]
impl acp::Agent for MockAgent {
    async fn initialize(
        &self,
        _args: acp::InitializeRequest,
    ) -> acp::Result<acp::InitializeResponse> {
        Ok(
            acp::InitializeResponse::new(acp::ProtocolVersion::LATEST)
                .agent_info(acp::Implementation::new("mock-acp-agent", "0.1.0"))
                .agent_capabilities(self.capabilities()),
        )
    }

    async fn authenticate(
        &self,
        _args: acp::AuthenticateRequest,
    ) -> acp::Result<acp::AuthenticateResponse> {
        Ok(acp::AuthenticateResponse::new())
    }

    async fn new_session(
        &self,
        _args: acp::NewSessionRequest,
    ) -> acp::Result<acp::NewSessionResponse> {
        Ok(acp::NewSessionResponse::new(self.next_session_id()))
    }

    async fn prompt(&self, args: acp::PromptRequest) -> acp::Result<acp::PromptResponse> {
        let sid = &args.session_id;

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
                        acp::SessionUpdate::ToolCall(acp::ToolCall::new(
                            tool_call_id,
                            "read_file",
                        )),
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

    async fn fork_session(
        &self,
        _args: acp::ForkSessionRequest,
    ) -> acp::Result<acp::ForkSessionResponse> {
        match self.profile {
            Profile::Full => Ok(acp::ForkSessionResponse::new(self.next_session_id())),
            Profile::Minimal => Err(acp::Error::method_not_found()),
        }
    }

    async fn resume_session(
        &self,
        _args: acp::ResumeSessionRequest,
    ) -> acp::Result<acp::ResumeSessionResponse> {
        match self.profile {
            Profile::Full => Ok(acp::ResumeSessionResponse::new()),
            Profile::Minimal => Err(acp::Error::method_not_found()),
        }
    }

    async fn close_session(
        &self,
        _args: acp::CloseSessionRequest,
    ) -> acp::Result<acp::CloseSessionResponse> {
        match self.profile {
            Profile::Full => Ok(acp::CloseSessionResponse::new()),
            Profile::Minimal => Err(acp::Error::method_not_found()),
        }
    }
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
            let (notif_tx, mut notif_rx) = mpsc::unbounded_channel::<NotifMsg>();

            let agent = MockAgent::new(fixture, profile, notif_tx);

            let (conn, handle_io) = acp::AgentSideConnection::new(agent, outgoing, incoming, |fut| {
                tokio::task::spawn_local(fut);
            });

            // Background task: drain the notification channel, forward each
            // notification to the client, then ack back to the prompt handler.
            tokio::task::spawn_local(async move {
                while let Some((notif, ack)) = notif_rx.recv().await {
                    if let Err(e) = conn.session_notification(notif).await {
                        eprintln!("mock-acp-agent: notification error: {e}");
                        break;
                    }
                    let _ = ack.send(());
                }
            });

            handle_io.await
        })
        .await
}
