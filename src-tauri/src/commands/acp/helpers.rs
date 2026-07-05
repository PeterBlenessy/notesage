//! Pure conversion helpers shared by the command layer and the agent thread:
//! MCP-server construction, model-info extraction, and session-result assembly.

use std::path::PathBuf;

use super::types::{AcpMcpServerInput, AgentModelInfo, SessionResult};

/// Convert the renderer's MCP server inputs into ACP `McpServer` configs,
/// resolving env secrets (stdio) and OAuth bearer tokens (http) from the OS
/// keychain. Servers that can't form a valid config (stdio without a command,
/// http without a URL) are dropped rather than failing the whole session.
pub(crate) async fn build_acp_mcp_servers(
    inputs: Vec<AcpMcpServerInput>,
) -> Vec<agent_client_protocol::schema::McpServer> {
    use agent_client_protocol::schema::{
        EnvVariable, HttpHeader, McpServer, McpServerHttp, McpServerStdio,
    };
    let mut out = Vec::with_capacity(inputs.len());
    for input in inputs {
        match input.transport {
            crate::commands::mcp::McpTransport::Stdio => {
                if input.command.trim().is_empty() {
                    log::warn!(target: "notesage::acp",
                        "Skipping stdio MCP server '{}' for session: empty command", input.name);
                    continue;
                }
                let env: Vec<EnvVariable> = crate::commands::mcp::resolve_env(&input.id, &input.env)
                    .into_iter()
                    .map(|(k, v)| EnvVariable::new(k, v))
                    .collect();
                out.push(McpServer::Stdio(
                    McpServerStdio::new(input.name, PathBuf::from(input.command))
                        .args(input.args)
                        .env(env),
                ));
            }
            crate::commands::mcp::McpTransport::Http => {
                let Some(url) = input.url.filter(|u| !u.trim().is_empty()) else {
                    log::warn!(target: "notesage::acp",
                        "Skipping http MCP server '{}' for session: missing URL", input.name);
                    continue;
                };
                // Attach a Bearer token if this server has been authorized via the
                // MCP OAuth flow — the same token `HttpMcpClient` uses. Notesage
                // owns the OAuth dance; the agent just gets a valid access token.
                let headers: Vec<HttpHeader> =
                    match crate::commands::mcp_oauth::valid_access_token(&input.id).await {
                        Some(token) => vec![HttpHeader::new("Authorization", format!("Bearer {token}"))],
                        None => Vec::new(),
                    };
                out.push(McpServer::Http(
                    McpServerHttp::new(input.name, url).headers(headers),
                ));
            }
        }
    }
    out
}

/// Derive `(current_model, available_models)` from a session response's config
/// options.
///
/// ACP 0.14 removed the dedicated session-model API (`SessionModelState`,
/// `session/set_model`); the stable replacement is the config option whose
/// `category` is `Model`. Agents without such an option simply have no model
/// selector — `(None, [])` is returned rather than an error.
pub(crate) fn extract_model_info(
    config_options: Option<&Vec<agent_client_protocol::schema::SessionConfigOption>>,
) -> (Option<String>, Vec<AgentModelInfo>) {
    use agent_client_protocol::schema::{
        SessionConfigKind, SessionConfigOptionCategory, SessionConfigSelectOption,
        SessionConfigSelectOptions,
    };

    let model_option = config_options
        .into_iter()
        .flatten()
        .find(|opt| opt.category == Some(SessionConfigOptionCategory::Model));

    let Some(option) = model_option else {
        return (None, Vec::new());
    };

    let to_info = |o: &SessionConfigSelectOption| AgentModelInfo {
        model_id: o.value.to_string(),
        name: o.name.clone(),
        description: o.description.clone(),
    };

    match &option.kind {
        SessionConfigKind::Select(select) => {
            let current_model = Some(select.current_value.to_string());
            let available_models = match &select.options {
                SessionConfigSelectOptions::Ungrouped(opts) => {
                    opts.iter().map(to_info).collect()
                }
                SessionConfigSelectOptions::Grouped(groups) => groups
                    .iter()
                    .flat_map(|g| g.options.iter())
                    .map(to_info)
                    .collect(),
                // Non-exhaustive upstream enum — unknown layouts yield no list.
                _ => Vec::new(),
            };
            (current_model, available_models)
        }
        // Future / non-select option kinds carry no model list to surface.
        _ => (None, Vec::new()),
    }
}

/// Assemble a `SessionResult` from a session response's `session_id`,
/// `config_options`, and already-serialized `modes` JSON. Shared by the
/// new/load/resume/fork command handlers, which differ only in which
/// `session_id` they carry (agent-assigned vs. caller-supplied).
pub(crate) fn build_session_result(
    session_id: String,
    config_options: Option<&Vec<agent_client_protocol::schema::SessionConfigOption>>,
    modes: Option<serde_json::Value>,
) -> SessionResult {
    let (current_model, available_models) = extract_model_info(config_options);
    let config_options_json = config_options.and_then(|c| serde_json::to_value(c).ok());
    SessionResult {
        session_id,
        current_model,
        available_models,
        modes,
        config_options: config_options_json,
    }
}
