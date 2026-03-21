use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{watch, Mutex, oneshot};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Network sandbox configuration passed from frontend
#[derive(Clone, Debug)]
pub struct NetworkSandboxConfig {
    /// Proxy listen address (e.g., "127.0.0.1:12345")
    pub proxy_addr: String,
    /// Proxy port (for Seatbelt localhost allow rule)
    pub proxy_port: u16,
}

/// A running proxy instance for a single agent
struct ProxyInstance {
    shutdown_tx: watch::Sender<bool>,
    proxy_addr: String,
    #[allow(dead_code)]
    proxy_port: u16,
    agent_id: String,
}

/// Domain approval request sent to frontend
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DomainRequest {
    pub instance_id: String,
    pub agent_id: String,
    pub domain: String,
    pub port: u16,
    pub request_id: String,
}

/// Domain approval response from frontend
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum DomainDecision {
    AllowOnce,
    AllowSession,
    AllowAlways,
    Deny,
}

/// Event payload for always-allowed domains (frontend persists these)
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DomainAlwaysPayload {
    pub instance_id: String,
    pub agent_id: String,
    pub domain: String,
}

/// Event payload when a domain request is resolved (denied, timed out, etc.)
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DomainResolvedPayload {
    pub request_id: String,
    pub domain: String,
    pub outcome: String, // "denied", "timeout"
}

/// Proxy status info for frontend queries
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatus {
    pub instance_id: String,
    pub agent_id: String,
    pub proxy_addr: String,
    pub allowed_domain_count: usize,
    pub session_domain_count: usize,
}

// ---------------------------------------------------------------------------
// Shared proxy state (domain lists + pending approvals)
// ---------------------------------------------------------------------------

struct SharedProxyState {
    instance_id: String,
    agent_id: String,
    allowed_domains: Vec<String>,
    session_domains: Mutex<Vec<String>>,
    pending_approvals: Mutex<HashMap<String, oneshot::Sender<DomainDecision>>>,
    app: AppHandle,
}

impl SharedProxyState {
    fn is_domain_allowed(&self, domain: &str, session_domains: &[String]) -> bool {
        self.allowed_domains.iter().any(|d| domain_matches(d, domain))
            || session_domains.iter().any(|d| domain_matches(d, domain))
    }
}

// ---------------------------------------------------------------------------
// Managed state
// ---------------------------------------------------------------------------

pub struct NetworkProxyState {
    instances: Mutex<HashMap<String, ProxyInstance>>,
    shared_states: Mutex<HashMap<String, Arc<SharedProxyState>>>,
}

impl NetworkProxyState {
    pub fn new() -> Self {
        Self {
            instances: Mutex::new(HashMap::new()),
            shared_states: Mutex::new(HashMap::new()),
        }
    }

    /// Start a proxy for a given agent instance.
    /// Returns the proxy address (127.0.0.1:port) and port.
    pub async fn start_proxy(
        &self,
        instance_id: &str,
        agent_id: &str,
        allowed_domains: Vec<String>,
        app: AppHandle,
    ) -> Result<NetworkSandboxConfig, String> {
        // Bind to localhost with OS-assigned port
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind proxy: {}", e))?;
        let addr = listener
            .local_addr()
            .map_err(|e| format!("Failed to get proxy addr: {}", e))?;

        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        let shared = Arc::new(SharedProxyState {
            instance_id: instance_id.to_string(),
            agent_id: agent_id.to_string(),
            allowed_domains,
            session_domains: Mutex::new(Vec::new()),
            pending_approvals: Mutex::new(HashMap::new()),
            app,
        });

        // Store shared state for command callbacks
        self.shared_states
            .lock()
            .await
            .insert(instance_id.to_string(), Arc::clone(&shared));

        // Spawn the proxy accept loop
        let iid = instance_id.to_string();
        tokio::spawn(async move {
            run_proxy_loop(listener, shutdown_rx, shared).await;
            log::info!(target: "notesage::network_proxy", "Proxy {} shut down", iid);
        });

        let instance = ProxyInstance {
            shutdown_tx,
            proxy_addr: addr.to_string(),
            proxy_port: addr.port(),
            agent_id: agent_id.to_string(),
        };

        self.instances
            .lock()
            .await
            .insert(instance_id.to_string(), instance);

        log::info!(target: "notesage::network_proxy",
            "Started proxy for {} ({}) on {}",
            agent_id, instance_id, addr
        );

        Ok(NetworkSandboxConfig {
            proxy_addr: addr.to_string(),
            proxy_port: addr.port(),
        })
    }

    /// Stop a proxy instance
    pub async fn stop_proxy(&self, instance_id: &str) {
        if let Some(instance) = self.instances.lock().await.remove(instance_id) {
            let _ = instance.shutdown_tx.send(true);
            log::info!(target: "notesage::network_proxy",
                "Stopped proxy for {} ({})",
                instance.agent_id, instance_id
            );
        }
        self.shared_states.lock().await.remove(instance_id);
    }

    /// Stop all proxy instances (called on app exit)
    pub fn stop_all_sync(&self) {
        if let Ok(mut instances) = self.instances.try_lock() {
            for (id, instance) in instances.drain() {
                let _ = instance.shutdown_tx.send(true);
                log::info!(target: "notesage::network_proxy", "Stopped proxy {} on exit", id);
            }
        }
        if let Ok(mut shared) = self.shared_states.try_lock() {
            shared.clear();
        }
    }
}

// ---------------------------------------------------------------------------
// Proxy accept loop
// ---------------------------------------------------------------------------

async fn run_proxy_loop(
    listener: TcpListener,
    mut shutdown_rx: watch::Receiver<bool>,
    shared: Arc<SharedProxyState>,
) {
    loop {
        tokio::select! {
            _ = shutdown_rx.changed() => {
                if *shutdown_rx.borrow() {
                    break;
                }
            }
            result = listener.accept() => {
                match result {
                    Ok((stream, _addr)) => {
                        let shared = Arc::clone(&shared);
                        tokio::spawn(async move {
                            if let Err(e) = handle_connection(stream, shared).await {
                                log::debug!(target: "notesage::network_proxy", "Connection error: {}", e);
                            }
                        });
                    }
                    Err(e) => {
                        log::warn!(target: "notesage::network_proxy", "Accept error: {}", e);
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Connection handler (HTTP CONNECT + plain HTTP)
// ---------------------------------------------------------------------------

async fn handle_connection(
    mut client: TcpStream,
    shared: Arc<SharedProxyState>,
) -> Result<(), String> {
    // Read the initial request line and headers
    let mut buf = vec![0u8; 8192];
    let n = client
        .read(&mut buf)
        .await
        .map_err(|e| format!("Read error: {}", e))?;
    if n == 0 {
        return Ok(());
    }

    let request = String::from_utf8_lossy(&buf[..n]);

    // Parse the first line: METHOD target HTTP/version
    let first_line = request.lines().next().unwrap_or("");
    let parts: Vec<&str> = first_line.split_whitespace().collect();
    if parts.len() < 3 {
        send_response(&mut client, 400, "Bad Request").await;
        return Err("Malformed request line".to_string());
    }

    let method = parts[0];
    let target = parts[1];

    if method.eq_ignore_ascii_case("CONNECT") {
        // HTTPS tunneling: CONNECT host:port HTTP/1.1
        handle_connect(client, target, &shared).await
    } else {
        // Plain HTTP: GET http://host/path HTTP/1.1
        handle_plain_http(client, &buf[..n], target, &shared).await
    }
}

/// Handle HTTP CONNECT (HTTPS tunneling)
async fn handle_connect(
    mut client: TcpStream,
    target: &str,
    shared: &SharedProxyState,
) -> Result<(), String> {
    let (domain, port) = parse_host_port(target)?;

    // Check domain allowlist
    if !check_domain_allowed(&domain, port, shared).await? {
        send_response(&mut client, 403, "Proxy Denied — domain not in allowlist").await;
        return Ok(());
    }

    // Connect to the target
    let upstream = TcpStream::connect(target)
        .await
        .map_err(|e| format!("Upstream connect to {} failed: {}", target, e))?;

    // Send 200 Connection Established
    client
        .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        .await
        .map_err(|e| format!("Write response: {}", e))?;

    // Bidirectional tunnel
    tunnel(client, upstream).await;
    Ok(())
}

/// Handle plain HTTP forwarding
async fn handle_plain_http(
    mut client: TcpStream,
    initial_data: &[u8],
    target_url: &str,
    shared: &SharedProxyState,
) -> Result<(), String> {
    // Extract host from Host header or URL
    let request_str = String::from_utf8_lossy(initial_data);
    let domain = extract_host_from_request(&request_str, target_url)?;
    let port = 80u16;

    if !check_domain_allowed(&domain, port, shared).await? {
        send_response(&mut client, 403, "Proxy Denied — domain not in allowlist").await;
        return Ok(());
    }

    // Parse the URL to get host:port for upstream connection
    let upstream_addr = if target_url.starts_with("http://") {
        let without_scheme = &target_url[7..];
        let host_part = without_scheme.split('/').next().unwrap_or(&domain);
        if host_part.contains(':') {
            host_part.to_string()
        } else {
            format!("{}:80", host_part)
        }
    } else {
        format!("{}:80", domain)
    };

    let mut upstream = TcpStream::connect(&upstream_addr)
        .await
        .map_err(|e| format!("Upstream connect to {} failed: {}", upstream_addr, e))?;

    // Forward the original request
    upstream
        .write_all(initial_data)
        .await
        .map_err(|e| format!("Write upstream: {}", e))?;

    // Bidirectional relay
    tunnel(client, upstream).await;
    Ok(())
}

// ---------------------------------------------------------------------------
// Domain checking with approval flow
// ---------------------------------------------------------------------------

async fn check_domain_allowed(
    domain: &str,
    port: u16,
    shared: &SharedProxyState,
) -> Result<bool, String> {
    // Fast path: check static + session allowlists
    {
        let session = shared.session_domains.lock().await;
        if shared.is_domain_allowed(domain, &session) {
            return Ok(true);
        }
    }

    // Slow path: ask the user
    let request_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();

    // Register pending approval
    shared
        .pending_approvals
        .lock()
        .await
        .insert(request_id.clone(), tx);

    // Emit event to frontend
    let _ = shared.app.emit(
        "network-domain-request",
        DomainRequest {
            instance_id: shared.instance_id.clone(),
            agent_id: shared.agent_id.clone(),
            domain: domain.to_string(),
            port,
            request_id: request_id.clone(),
        },
    );

    log::info!(target: "notesage::network_proxy",
        "Domain approval requested: {} (agent: {}, request: {})",
        domain, shared.agent_id, request_id
    );

    // Wait for user decision with 30s timeout
    let decision = match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
        Ok(Ok(decision)) => decision,
        Ok(Err(_)) => {
            // Channel closed (sender dropped)
            shared.pending_approvals.lock().await.remove(&request_id);
            log::warn!(target: "notesage::network_proxy", "Domain {} approval channel closed", domain);
            return Ok(false);
        }
        Err(_) => {
            // Timeout — deny and notify frontend to remove the card
            shared.pending_approvals.lock().await.remove(&request_id);
            log::info!(target: "notesage::network_proxy", "Domain {} approval timed out (30s) — denied", domain);
            let _ = shared.app.emit(
                "network-domain-resolved",
                DomainResolvedPayload {
                    request_id: request_id.clone(),
                    domain: domain.to_string(),
                    outcome: "timeout".to_string(),
                },
            );
            return Ok(false);
        }
    };

    // Clean up the pending approval entry
    shared.pending_approvals.lock().await.remove(&request_id);

    match decision {
        DomainDecision::AllowOnce => {
            log::info!(target: "notesage::network_proxy", "Domain {} allowed once", domain);
            Ok(true)
        }
        DomainDecision::AllowSession => {
            log::info!(target: "notesage::network_proxy", "Domain {} allowed for session", domain);
            shared
                .session_domains
                .lock()
                .await
                .push(domain.to_string());
            Ok(true)
        }
        DomainDecision::AllowAlways => {
            log::info!(target: "notesage::network_proxy", "Domain {} allowed always", domain);
            shared
                .session_domains
                .lock()
                .await
                .push(domain.to_string());
            // Notify frontend to persist
            let _ = shared.app.emit(
                "network-domain-always",
                DomainAlwaysPayload {
                    instance_id: shared.instance_id.clone(),
                    agent_id: shared.agent_id.clone(),
                    domain: domain.to_string(),
                },
            );
            Ok(true)
        }
        DomainDecision::Deny => {
            log::info!(target: "notesage::network_proxy", "Domain {} denied by user", domain);
            let _ = shared.app.emit(
                "network-domain-resolved",
                DomainResolvedPayload {
                    request_id: request_id.clone(),
                    domain: domain.to_string(),
                    outcome: "denied".to_string(),
                },
            );
            Ok(false)
        }
    }
}

// ---------------------------------------------------------------------------
// Tunneling
// ---------------------------------------------------------------------------

async fn tunnel(mut client: TcpStream, mut upstream: TcpStream) {
    let (mut cr, mut cw) = client.split();
    let (mut ur, mut uw) = upstream.split();

    let c2u = tokio::io::copy(&mut cr, &mut uw);
    let u2c = tokio::io::copy(&mut ur, &mut cw);

    // Run both directions concurrently; stop when either finishes
    tokio::select! {
        _ = c2u => {}
        _ = u2c => {}
    }
}

// ---------------------------------------------------------------------------
// Domain matching
// ---------------------------------------------------------------------------

/// Match a domain against an allowlist pattern.
/// Supports wildcard: `*.example.com` matches `foo.example.com` but not `example.com`.
/// Exact match: `example.com` matches only `example.com`.
fn domain_matches(pattern: &str, domain: &str) -> bool {
    let pattern = pattern.to_lowercase();
    let domain = domain.to_lowercase();

    if pattern.starts_with("*.") {
        let suffix = &pattern[1..]; // ".example.com"
        domain.ends_with(suffix) && domain.len() > suffix.len()
    } else {
        pattern == domain
    }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

fn parse_host_port(target: &str) -> Result<(String, u16), String> {
    if let Some(colon) = target.rfind(':') {
        let host = &target[..colon];
        let port = target[colon + 1..]
            .parse::<u16>()
            .map_err(|_| format!("Invalid port in '{}'", target))?;
        Ok((host.to_string(), port))
    } else {
        Ok((target.to_string(), 443))
    }
}

fn extract_host_from_request(request: &str, url: &str) -> Result<String, String> {
    // Try Host header first
    for line in request.lines() {
        if line.to_lowercase().starts_with("host:") {
            let host = line[5..].trim();
            // Strip port if present
            return Ok(host.split(':').next().unwrap_or(host).to_string());
        }
    }

    // Fall back to URL parsing
    if url.starts_with("http://") {
        let without_scheme = &url[7..];
        let host_part = without_scheme.split('/').next().unwrap_or("");
        Ok(host_part.split(':').next().unwrap_or(host_part).to_string())
    } else {
        Err("Cannot determine host from request".to_string())
    }
}

async fn send_response(stream: &mut TcpStream, status: u16, body: &str) {
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Length: {}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n{}",
        status,
        match status {
            200 => "OK",
            400 => "Bad Request",
            403 => "Forbidden",
            _ => "Error",
        },
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes()).await;
}

// ---------------------------------------------------------------------------
// Per-agent default domain allowlists (#4)
// ---------------------------------------------------------------------------

pub fn default_allowed_domains(agent_id: &str) -> Vec<String> {
    let mut domains = vec![
        // Common domains all agents may need
        "github.com".to_string(),
        "*.githubusercontent.com".to_string(),
    ];

    match agent_id {
        "claude-agent-acp" => {
            domains.extend([
                "api.anthropic.com".to_string(),
            ]);
        }
        "codex-acp" => {
            domains.extend([
                "api.openai.com".to_string(),
                "chatgpt.com".to_string(),
                "*.chatgpt.com".to_string(),
            ]);
        }
        "copilot" | "copilot-language-server" => {
            domains.extend([
                "api.github.com".to_string(),
                "copilot-proxy.githubusercontent.com".to_string(),
                "*.githubcopilot.com".to_string(),
            ]);
        }
        "gemini" => {
            domains.extend([
                "generativelanguage.googleapis.com".to_string(),
                "oauth2.googleapis.com".to_string(),
            ]);
        }
        _ => {}
    }

    domains
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Respond to a domain approval request from the proxy
#[tauri::command]
pub async fn network_domain_respond(
    state: State<'_, NetworkProxyState>,
    instance_id: String,
    request_id: String,
    decision: DomainDecision,
) -> Result<(), String> {
    let shared_states = state.shared_states.lock().await;
    let shared = shared_states
        .get(&instance_id)
        .ok_or_else(|| format!("No proxy instance found for {}", instance_id))?;

    let sender = shared
        .pending_approvals
        .lock()
        .await
        .remove(&request_id)
        .ok_or_else(|| format!("No pending approval for request {}", request_id))?;

    sender
        .send(decision)
        .map_err(|_| "Failed to send decision — connection may have timed out".to_string())
}

/// Get status of active proxy instances
#[tauri::command]
pub async fn network_proxy_status(
    state: State<'_, NetworkProxyState>,
) -> Result<Vec<ProxyStatus>, String> {
    let instances = state.instances.lock().await;
    let shared_states = state.shared_states.lock().await;

    let mut statuses = Vec::new();
    for (id, instance) in instances.iter() {
        let session_count = if let Some(shared) = shared_states.get(id) {
            shared.session_domains.lock().await.len()
        } else {
            0
        };

        statuses.push(ProxyStatus {
            instance_id: id.clone(),
            agent_id: instance.agent_id.clone(),
            proxy_addr: instance.proxy_addr.clone(),
            allowed_domain_count: shared_states
                .get(id)
                .map(|s| s.allowed_domains.len())
                .unwrap_or(0),
            session_domain_count: session_count,
        });
    }

    Ok(statuses)
}

/// Get default allowed domains for an agent
#[tauri::command]
pub async fn network_default_domains(agent_id: String) -> Result<Vec<String>, String> {
    Ok(default_allowed_domains(&agent_id))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_domain_matches_exact() {
        assert!(domain_matches("api.anthropic.com", "api.anthropic.com"));
        assert!(!domain_matches("api.anthropic.com", "evil.com"));
    }

    #[test]
    fn test_domain_matches_wildcard() {
        assert!(domain_matches("*.github.com", "api.github.com"));
        assert!(domain_matches("*.github.com", "foo.bar.github.com"));
        assert!(!domain_matches("*.github.com", "github.com"));
        assert!(!domain_matches("*.github.com", "notgithub.com"));
    }

    #[test]
    fn test_domain_matches_case_insensitive() {
        assert!(domain_matches("API.Anthropic.COM", "api.anthropic.com"));
        assert!(domain_matches("*.GitHub.com", "API.GitHub.COM"));
    }

    #[test]
    fn test_domain_matches_no_suffix_bypass() {
        // "example.com" in allowlist must NOT permit "evilexample.com"
        assert!(!domain_matches("example.com", "evilexample.com"));
        assert!(!domain_matches("*.example.com", "evilexample.com"));
        // Exact match only permits exact match, not subdomains
        assert!(!domain_matches("example.com", "sub.example.com"));
    }

    #[test]
    fn test_domain_matches_edge_cases() {
        // Empty pattern never matches a real domain
        assert!(!domain_matches("", "example.com"));
        // Empty domain never matches a real pattern
        assert!(!domain_matches("example.com", ""));
        // Trailing dots don't match (DNS canonical form vs display form)
        assert!(!domain_matches("example.com", "example.com."));
        // Bare wildcard prefix doesn't match
        assert!(!domain_matches("*.", "example.com"));
    }

    #[test]
    fn test_parse_host_port() {
        let (host, port) = parse_host_port("api.anthropic.com:443").unwrap();
        assert_eq!(host, "api.anthropic.com");
        assert_eq!(port, 443);

        let (host, port) = parse_host_port("example.com").unwrap();
        assert_eq!(host, "example.com");
        assert_eq!(port, 443);
    }

    #[test]
    fn test_default_allowed_domains() {
        let domains = default_allowed_domains("claude-agent-acp");
        assert!(domains.contains(&"api.anthropic.com".to_string()));
        assert!(domains.contains(&"github.com".to_string()));

        let domains = default_allowed_domains("unknown-agent");
        assert!(domains.contains(&"github.com".to_string()));
        assert_eq!(domains.len(), 2); // just common domains
    }
}
