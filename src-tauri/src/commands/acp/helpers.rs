//! Pure conversion helpers shared by the command layer and the agent thread:
//! MCP-server construction, model-info extraction, and session-result assembly.

use std::path::PathBuf;

use super::types::{AcpMcpServerInput, AgentModelInfo, SessionResult};

/// Expand a leading `~` in a stdio server's command to the user's home
/// directory. The agent spawns the command itself, with no shell in between,
/// so a `~/bin/server` from `mcp.json` would otherwise be looked up literally.
/// Anything else (absolute paths, bare names resolved through `PATH`,
/// `~user/…`) is passed through unchanged.
pub(crate) fn expand_home_in_command(command: &str, home: Option<&std::path::Path>) -> PathBuf {
    let Some(home) = home else {
        return PathBuf::from(command);
    };
    if command == "~" {
        return home.to_path_buf();
    }
    match command.strip_prefix("~/") {
        Some(rest) => home.join(rest),
        None => PathBuf::from(command),
    }
}

/// Convert the renderer's MCP server inputs into ACP `McpServer` configs,
/// resolving env and header secrets and OAuth bearer tokens from the OS
/// keychain: the agent receives concrete values, never a `{ "secret": true }`
/// reference (a secret that is missing from the keychain is left out).
/// Servers that can't form a valid config (stdio without a command, http
/// without a URL) are dropped rather than failing the whole session.
///
/// The result serialises to the ACP v1 wire shape: a stdio server is
/// `{ name, command, args, env: [{ name, value }] }` (no `type`), an http
/// server `{ type: "http", name, url, headers: [{ name, value }] }`.
pub(crate) async fn build_acp_mcp_servers(
    inputs: Vec<AcpMcpServerInput>,
) -> Vec<agent_client_protocol::schema::McpServer> {
    use agent_client_protocol::schema::{
        EnvVariable, HttpHeader, McpServer, McpServerHttp, McpServerStdio,
    };
    let home = dirs::home_dir();
    let mut out = Vec::with_capacity(inputs.len());
    for input in inputs {
        match input.transport {
            crate::commands::mcp::McpTransport::Stdio => {
                let command = input.command.trim();
                if command.is_empty() {
                    log::warn!(target: "notesage::acp",
                        "Skipping stdio MCP server '{}' for session: empty command", input.name);
                    continue;
                }
                let mut env: Vec<EnvVariable> = crate::commands::mcp::resolve_env(&input.id, &input.env)
                    .into_iter()
                    .map(|(k, v)| EnvVariable::new(k, v))
                    .collect();
                // Stable order: the map iterates arbitrarily.
                env.sort_by(|a, b| a.name.cmp(&b.name));
                out.push(McpServer::Stdio(
                    McpServerStdio::new(input.name, expand_home_in_command(command, home.as_deref()))
                        // The app's own spawn expands `~` in arguments too
                        // (`mcp/launch.rs`); a filesystem server handed
                        // `~/Documents` must see the same path either way.
                        .args(
                            input
                                .args
                                .iter()
                                .map(|arg| {
                                    expand_home_in_command(arg, home.as_deref())
                                        .to_string_lossy()
                                        .into_owned()
                                })
                                .collect(),
                        )
                        .env(env),
                ));
            }
            crate::commands::mcp::McpTransport::Http => {
                let Some(url) = input.url.filter(|u| !u.trim().is_empty()) else {
                    log::warn!(target: "notesage::acp",
                        "Skipping http MCP server '{}' for session: missing URL", input.name);
                    continue;
                };
                // Static headers from the config (an API key, say), with
                // keychain references resolved the same way as env secrets.
                let mut headers: Vec<HttpHeader> =
                    crate::commands::mcp::resolve_env(&input.id, &input.headers)
                        .into_iter()
                        .map(|(k, v)| HttpHeader::new(k, v))
                        .collect();
                headers.sort_by(|a, b| a.name.cmp(&b.name));
                // Attach a Bearer token if this server has been authorized via the
                // MCP OAuth flow — the same token `HttpMcpClient` uses. Notesage
                // owns the OAuth dance; the agent just gets a valid access token.
                // It replaces a static `Authorization` header.
                if let Some(token) = crate::commands::mcp_oauth::valid_access_token(&input.id).await {
                    headers.retain(|h| !h.name.eq_ignore_ascii_case("authorization"));
                    headers.push(HttpHeader::new("Authorization", format!("Bearer {token}")));
                }
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
