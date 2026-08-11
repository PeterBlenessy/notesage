pub mod alpha_update;
pub mod file;
pub mod ios_library;
pub mod dialog;
pub mod ai;
pub mod ai_streaming;
pub mod tool_execution;
pub mod segment_builder;
pub mod export;
pub mod preview;
pub mod html_preview;
pub mod git;
pub mod watcher;
pub mod sync;
// Desktop-only: the telemetry module wraps the Sentry SDK, which is not
// linked into the iOS target (#587 — "Data Not Collected" privacy label).
#[cfg(not(target_os = "ios"))]
pub mod telemetry;
pub mod acp;
pub mod acp_binary;
pub mod acp_client;
pub mod copilot_lsp;
pub mod shell_path;
pub mod skills;
pub mod script_exec;
pub mod agents;
pub mod mcp;
pub mod mcp_oauth;
pub mod json_rpc;
pub mod logging;
pub mod store;
pub mod health;
// Desktop only: `whisper-rs` bundles whisper.cpp, whose ggml compute kernels
// reference Accelerate symbols (`_vDSP_vsub`, …) that do not link on iOS — and
// a read-only mobile reader has no business carrying a speech-recognition
// engine. The mobile build gets `transcription_stub` under the same name so
// `generate_handler!` in lib.rs stays platform-agnostic.
#[cfg(desktop)]
pub mod transcription;
#[cfg(mobile)]
#[path = "transcription_stub.rs"]
pub mod transcription;
pub mod local_inference;
pub mod model_management;
pub mod model_providers;
pub mod model_fit;
pub mod thinking_tags;
pub mod gguf_parser;
pub mod model_metadata;
pub mod actions;
pub mod automations;
pub mod agent_manager;
pub mod local_agent;
pub mod sandbox;
pub mod sandbox_monitor;
pub mod network_proxy;
pub mod constants;
pub mod credentials;
pub mod web_search;
pub mod fonts;
pub mod link_preview;
pub mod net_guard;
pub mod process_guard;
pub mod theme;

pub use alpha_update::*;
pub use file::*;
pub use ios_library::*;
pub use dialog::*;
pub use ai::*;
pub use export::*;
pub use preview::*;
pub use html_preview::*;
pub use git::*;
pub use watcher::*;
pub use sync::*;
#[cfg(not(target_os = "ios"))]
pub use telemetry::*;
pub use acp::*;
pub use acp_binary::*;
pub use copilot_lsp::*;
pub use skills::*;
pub use script_exec::*;
pub use agents::*;
pub use mcp::*;
pub use mcp_oauth::*;
pub use logging::*;
pub use store::*;
pub use health::*;
pub use transcription::*;
pub use local_inference::*;
pub use model_management::*;
pub use model_metadata::*;
pub use agent_manager::*;
pub use network_proxy::*;
pub use sandbox_monitor::*;
pub use actions::*;
pub use automations::*;
pub use credentials::*;
pub use web_search::*;
pub use fonts::*;
pub use link_preview::*;
pub use theme::*;
