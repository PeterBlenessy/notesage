//! Mock ACP agent binary for integration tests.
//!
//! Supports two capability profiles selected via `--profile <full|minimal>`:
//!   - full:    advertises image support, fork/resume/close session capabilities,
//!              and load_session; handles all session lifecycle requests successfully.
//!   - minimal: advertises no optional capabilities; session lifecycle requests
//!              return method_not_found.
//!
//! Communicates over stdin/stdout using the ACP JSON-RPC protocol.

use std::cell::Cell;

use agent_client_protocol as acp;
use tokio_util::compat::{TokioAsyncReadCompatExt as _, TokioAsyncWriteCompatExt as _};

enum Profile {
    Full,
    Minimal,
}

struct MockAgent {
    profile: Profile,
    next_id: Cell<u64>,
}

impl MockAgent {
    fn next_session_id(&self) -> acp::SessionId {
        let id = self.next_id.get();
        self.next_id.set(id + 1);
        acp::SessionId::new(format!("mock-session-{}", id))
    }
}

#[async_trait::async_trait(?Send)]
impl acp::Agent for MockAgent {
    async fn initialize(
        &self,
        _args: acp::InitializeRequest,
    ) -> acp::Result<acp::InitializeResponse> {
        let caps = match self.profile {
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
        };
        Ok(acp::InitializeResponse::new(acp::ProtocolVersion::LATEST)
            .agent_capabilities(caps)
            .agent_info(acp::Implementation::new("mock-acp-agent", "0.1.0")))
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

    async fn prompt(&self, _args: acp::PromptRequest) -> acp::Result<acp::PromptResponse> {
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

#[tokio::main(flavor = "current_thread")]
async fn main() -> acp::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let profile_str = args
        .windows(2)
        .find(|w| w[0] == "--profile")
        .map(|w| w[1].as_str())
        .unwrap_or("minimal");
    let profile = if profile_str == "full" {
        Profile::Full
    } else {
        Profile::Minimal
    };

    let outgoing = tokio::io::stdout().compat_write();
    let incoming = tokio::io::stdin().compat();

    let local = tokio::task::LocalSet::new();
    local
        .run_until(async move {
            let (_conn, handle_io) = acp::AgentSideConnection::new(
                MockAgent {
                    profile,
                    next_id: Cell::new(0),
                },
                outgoing,
                incoming,
                |fut| {
                    tokio::task::spawn_local(fut);
                },
            );
            handle_io.await
        })
        .await
}
