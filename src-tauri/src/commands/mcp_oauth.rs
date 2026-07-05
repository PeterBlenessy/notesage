//! OAuth 2.1 (PKCE) support for remote (HTTP) MCP servers.
//!
//! This module is intentionally hand-rolled on `reqwest` + `url` + `sha2`
//! rather than pulling in the `oauth2` crate: the flow we need (authorization
//! code + PKCE, dynamic client registration, refresh) is small, and keeping it
//! explicit lets every step be unit-tested. The fiddly pieces — PKCE
//! generation, the loopback callback query, and the authorize-URL shape — are
//! pure functions covered by tests below.
//!
//! Tokens are persisted as a JSON blob in the OS keychain under
//! `notesage:mcp:<server_id>:oauth` (the same keyring layer connections use).
//! Secret material never touches `mcp.json` and is never returned to the
//! frontend — `mcp_oauth_status` reports only authorized/expiry.
//!
//! The async flow (discovery, dynamic client registration, loopback capture,
//! token exchange/refresh, and the `mcp_oauth_authorize` command) lands in a
//! follow-up; this file establishes the tested core + storage + status/logout.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::IpAddr;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tauri_plugin_opener::OpenerExt;

const SERVICE_PREFIX: &str = "notesage";

/// Tokens persisted (as JSON) in the keychain. Carries enough issuer context
/// (`token_endpoint`, `client_id`, optional `client_secret`) to refresh later
/// without re-running discovery.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct OAuthTokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub token_type: Option<String>,
    /// Unix seconds at which the access token expires (`None` = unknown).
    #[serde(default)]
    pub expires_at: Option<u64>,
    #[serde(default)]
    pub scope: Option<String>,
    pub token_endpoint: String,
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
}

impl OAuthTokens {
    /// True when the access token is expired, or within `skew_secs` of expiry.
    pub fn is_expired(&self, now_secs: u64, skew_secs: u64) -> bool {
        match self.expires_at {
            Some(exp) => now_secs + skew_secs >= exp,
            None => false,
        }
    }
}

/// Status surfaced to the frontend — never includes the token itself.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct OAuthStatus {
    pub authorized: bool,
    pub expires_at: Option<u64>,
}

/// Query params captured from the loopback redirect.
#[derive(Debug, Default, PartialEq)]
pub struct CallbackParams {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/// URL-safe base64 without padding (RFC 4648 §5) — used for PKCE challenges.
pub fn base64url_nopad(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[((n >> 18) & 63) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[((n >> 6) & 63) as usize] as char);
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[(n & 63) as usize] as char);
        }
    }
    out
}

/// Generate a PKCE `(code_verifier, code_challenge)` pair using the S256 method.
/// The verifier is 64 hex chars (two UUIDv4s) — well within the 43..128 range.
pub fn generate_pkce() -> (String, String) {
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = base64url_nopad(digest.as_slice());
    (verifier, challenge)
}

/// Parse the query of a loopback callback request line
/// (`GET /callback?code=...&state=... HTTP/1.1`). Percent-decoding is handled
/// by `url::form_urlencoded`.
pub fn parse_callback_request_line(line: &str) -> CallbackParams {
    let mut out = CallbackParams::default();
    let target = line.split_whitespace().nth(1).unwrap_or("");
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
    for (k, v) in url::form_urlencoded::parse(query.as_bytes()) {
        match k.as_ref() {
            "code" => out.code = Some(v.into_owned()),
            "state" => out.state = Some(v.into_owned()),
            "error" => out.error = Some(v.into_owned()),
            _ => {}
        }
    }
    out
}

/// Build the authorization-code + PKCE authorize URL.
pub fn build_authorize_url(
    authorization_endpoint: &str,
    client_id: &str,
    redirect_uri: &str,
    code_challenge: &str,
    state: &str,
    scope: Option<&str>,
) -> Result<String, String> {
    let mut url = url::Url::parse(authorization_endpoint)
        .map_err(|e| format!("Invalid authorization endpoint: {}", e))?;
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("response_type", "code");
        q.append_pair("client_id", client_id);
        q.append_pair("redirect_uri", redirect_uri);
        q.append_pair("code_challenge", code_challenge);
        q.append_pair("code_challenge_method", "S256");
        q.append_pair("state", state);
        if let Some(s) = scope {
            q.append_pair("scope", s);
        }
    }
    Ok(url.to_string())
}

/// SSRF guard for every externally-influenced URL (the MCP `server_url`, the
/// discovered authorization servers, and the authorization/token endpoints
/// drawn from attacker-controllable metadata).
///
/// Rules:
/// - must parse as a URL,
/// - scheme MUST be `https` (rejects `http` and every other scheme),
/// - if the host is an IP literal, it must NOT be loopback, private,
///   link-local, unique-local, or unspecified,
/// - the hostnames `localhost` and `*.localhost` are rejected outright.
///
/// Caveat: this does NOT defend against DNS rebinding — a hostname that
/// resolves to a private IP at request time is not caught here, because we
/// validate the literal URL, not the resolved address. That requires resolving
/// and pinning the address at connect time and is out of scope for this fix.
fn validate_external_url(raw: &str) -> Result<(), String> {
    let url = url::Url::parse(raw).map_err(|e| format!("Invalid URL {}: {}", raw, e))?;

    if url.scheme() != "https" {
        return Err(format!(
            "Refusing to use non-HTTPS URL {} (scheme {:?})",
            raw,
            url.scheme()
        ));
    }

    let host = url
        .host_str()
        .ok_or_else(|| format!("URL {} has no host", raw))?;

    // Reject `localhost` / `*.localhost` by name (it resolves to loopback).
    let lower = host.to_ascii_lowercase();
    if lower == "localhost" || lower.ends_with(".localhost") {
        return Err(format!("Refusing to use loopback hostname {}", raw));
    }

    // If the host is an IP literal, block dangerous ranges via the shared
    // SSRF blocklist (audit batch 3 fix #10 — this module's private copy had
    // drifted behind `link_preview`'s: it was missing CGNAT, broadcast,
    // documentation ranges, and 0.0.0.0/8). `host_str()` keeps the brackets
    // on an IPv6 literal (`[::1]`), so strip them first.
    let ip_candidate = lower.strip_prefix('[').and_then(|s| s.strip_suffix(']')).unwrap_or(&lower);
    if let Ok(ip) = ip_candidate.parse::<IpAddr>() {
        if super::net_guard::is_blocked_ip(ip) {
            return Err(format!("Refusing to use internal/reserved IP address {}", raw));
        }
    }

    Ok(())
}

/// Build a `<origin>/.well-known/<name>` URL for the origin of `base`.
/// Falls back to appending if `base` can't be parsed as a URL.
pub fn well_known(base: &str, name: &str) -> String {
    match url::Url::parse(base) {
        Ok(u) => {
            let port = u.port().map(|p| format!(":{}", p)).unwrap_or_default();
            format!(
                "{}://{}{}/.well-known/{}",
                u.scheme(),
                u.host_str().unwrap_or(""),
                port,
                name
            )
        }
        Err(_) => format!("{}/.well-known/{}", base.trim_end_matches('/'), name),
    }
}

/// Current Unix time in seconds.
pub fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Keychain token storage
// ---------------------------------------------------------------------------

/// Keychain service id for a server's OAuth token blob.
pub fn oauth_service(server_id: &str) -> String {
    format!("{SERVICE_PREFIX}:mcp:{server_id}:oauth")
}

/// Load the persisted tokens for a server, if any.
pub fn load_tokens(server_id: &str) -> Option<OAuthTokens> {
    super::credentials::get_credential_internal(&format!("mcp:{server_id}:oauth"))
        .ok()
        .flatten()
        .and_then(|json| serde_json::from_str(&json).ok())
}

/// Persist tokens for a server.
pub async fn store_tokens(server_id: &str, tokens: &OAuthTokens) -> Result<(), String> {
    let json = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
    super::credentials::store_credential(oauth_service(server_id), json).await
}

/// Remove any persisted tokens for a server.
pub async fn clear_tokens(server_id: &str) -> Result<(), String> {
    super::credentials::delete_credential(oauth_service(server_id)).await
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Report whether a server is authorized and (if known) when its token expires.
#[tauri::command]
pub fn mcp_oauth_status(server_id: String) -> Result<OAuthStatus, String> {
    let tokens = load_tokens(&server_id);
    Ok(OAuthStatus {
        authorized: tokens.is_some(),
        expires_at: tokens.and_then(|t| t.expires_at),
    })
}

/// Forget a server's OAuth tokens (sign out).
#[tauri::command]
pub async fn mcp_oauth_logout(server_id: String) -> Result<(), String> {
    clear_tokens(&server_id).await
}

// ---------------------------------------------------------------------------
// Async OAuth flow (discovery → DCR → PKCE → loopback → token exchange)
// ---------------------------------------------------------------------------

/// RFC 9728 protected-resource metadata (subset).
#[derive(Deserialize)]
struct ProtectedResourceMetadata {
    #[serde(default)]
    authorization_servers: Vec<String>,
}

/// RFC 8414 authorization-server metadata (subset).
#[derive(Deserialize)]
struct AuthServerMetadata {
    authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default)]
    registration_endpoint: Option<String>,
}

/// RFC 7591 dynamic client registration request.
#[derive(Serialize)]
struct ClientRegistrationRequest {
    client_name: &'static str,
    redirect_uris: Vec<String>,
    grant_types: Vec<&'static str>,
    response_types: Vec<&'static str>,
    token_endpoint_auth_method: &'static str,
}

#[derive(Deserialize)]
struct ClientRegistrationResponse {
    client_id: String,
    #[serde(default)]
    client_secret: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    token_type: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    scope: Option<String>,
}

fn oauth_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default()
}

async fn fetch_json<T: DeserializeOwned>(client: &reqwest::Client, url: &str) -> Result<T, String> {
    let resp = client
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("GET {} failed: {}", url, e))?;
    if !resp.status().is_success() {
        return Err(format!("GET {} returned HTTP {}", url, resp.status()));
    }
    resp.json::<T>()
        .await
        .map_err(|e| format!("Invalid JSON from {}: {}", url, e))
}

/// Discover the authorization-server metadata for a remote MCP `server_url`:
/// RFC 9728 protected-resource doc → issuer → RFC 8414 AS metadata, with a
/// fallback to AS metadata served directly at the resource origin.
async fn discover_metadata(
    client: &reqwest::Client,
    server_url: &str,
) -> Result<AuthServerMetadata, String> {
    // The MCP server_url itself is user/attacker-supplied — validate before any fetch.
    validate_external_url(server_url)?;

    let prm_url = well_known(server_url, "oauth-protected-resource");
    if let Ok(prm) = fetch_json::<ProtectedResourceMetadata>(client, &prm_url).await {
        if let Some(issuer) = prm.authorization_servers.into_iter().next() {
            // `issuer` comes from the (attacker-controlled) protected-resource
            // metadata — must be validated before we fetch its AS metadata.
            validate_external_url(&issuer)?;
            let asm_url = well_known(&issuer, "oauth-authorization-server");
            let metadata: AuthServerMetadata = fetch_json(client, &asm_url).await?;
            validate_endpoints(&metadata)?;
            return Ok(metadata);
        }
    }
    let asm_url = well_known(server_url, "oauth-authorization-server");
    let metadata: AuthServerMetadata = fetch_json(client, &asm_url).await?;
    validate_endpoints(&metadata)?;
    Ok(metadata)
}

/// Validate the authorization/token/registration endpoints carried in
/// attacker-controllable authorization-server metadata before any of them is
/// opened in a browser or POSTed to.
fn validate_endpoints(metadata: &AuthServerMetadata) -> Result<(), String> {
    validate_external_url(&metadata.authorization_endpoint)?;
    validate_external_url(&metadata.token_endpoint)?;
    if let Some(reg) = &metadata.registration_endpoint {
        validate_external_url(reg)?;
    }
    Ok(())
}

async fn register_client(
    client: &reqwest::Client,
    registration_endpoint: &str,
    redirect_uri: &str,
) -> Result<ClientRegistrationResponse, String> {
    // The registration endpoint comes from attacker-controllable metadata.
    validate_external_url(registration_endpoint)?;
    let body = ClientRegistrationRequest {
        client_name: "Notesage",
        redirect_uris: vec![redirect_uri.to_string()],
        grant_types: vec!["authorization_code", "refresh_token"],
        response_types: vec!["code"],
        token_endpoint_auth_method: "none",
    };
    let resp = client
        .post(registration_endpoint)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Client registration failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Client registration returned HTTP {}", resp.status()));
    }
    resp.json()
        .await
        .map_err(|e| format!("Invalid client-registration response: {}", e))
}

/// Bind a loopback listener; returns the redirect URI and the listener.
async fn bind_loopback() -> Result<(String, TcpListener), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind loopback listener: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();
    Ok((format!("http://127.0.0.1:{}/callback", port), listener))
}

/// Accept a single callback request, reply with a friendly page, return params.
async fn await_callback(listener: TcpListener) -> Result<CallbackParams, String> {
    let (mut stream, _) = listener
        .accept()
        .await
        .map_err(|e| format!("Callback accept failed: {}", e))?;
    let mut buf = [0u8; 4096];
    let n = stream
        .read(&mut buf)
        .await
        .map_err(|e| format!("Callback read failed: {}", e))?;
    let req = String::from_utf8_lossy(&buf[..n]);
    let params = parse_callback_request_line(req.lines().next().unwrap_or(""));

    let page = "<!doctype html><html><body style=\"font-family:system-ui,sans-serif;text-align:center;padding-top:3rem;color:#222\">\
<h2>Authentication complete</h2><p>You can close this tab and return to Notesage.</p></body></html>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        page.len(),
        page
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
    Ok(params)
}

async fn exchange_code(
    client: &reqwest::Client,
    token_endpoint: &str,
    client_id: &str,
    client_secret: Option<&str>,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<TokenResponse, String> {
    // Defense-in-depth: the token endpoint comes from attacker-controllable
    // metadata — re-validate immediately before POSTing credentials to it.
    validate_external_url(token_endpoint)?;
    let mut form = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", client_id),
        ("code_verifier", verifier),
    ];
    if let Some(sec) = client_secret {
        form.push(("client_secret", sec));
    }
    let resp = client
        .post(token_endpoint)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Token exchange failed: {}", e))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Token endpoint returned HTTP {}: {}", status, text));
    }
    resp.json()
        .await
        .map_err(|e| format!("Invalid token response: {}", e))
}

async fn refresh_with(
    client: &reqwest::Client,
    tokens: &OAuthTokens,
    refresh_token: &str,
) -> Result<OAuthTokens, String> {
    // The token endpoint was persisted from attacker-controllable metadata —
    // re-validate before POSTing to it (catches tokens stored before this
    // guard existed, and is cheap defense-in-depth otherwise).
    validate_external_url(&tokens.token_endpoint)?;
    let mut form = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", tokens.client_id.as_str()),
    ];
    if let Some(sec) = &tokens.client_secret {
        form.push(("client_secret", sec));
    }
    let resp = client
        .post(&tokens.token_endpoint)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Token refresh failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Token refresh returned HTTP {}", resp.status()));
    }
    let token: TokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("Invalid refresh response: {}", e))?;
    Ok(OAuthTokens {
        access_token: token.access_token,
        // Some servers omit refresh_token on refresh — keep the prior one.
        refresh_token: token.refresh_token.or_else(|| tokens.refresh_token.clone()),
        token_type: token.token_type.or_else(|| tokens.token_type.clone()),
        expires_at: token.expires_in.map(|s| now_unix_secs() + s),
        scope: token.scope.or_else(|| tokens.scope.clone()),
        token_endpoint: tokens.token_endpoint.clone(),
        client_id: tokens.client_id.clone(),
        client_secret: tokens.client_secret.clone(),
    })
}

/// Return a usable access token for a server, refreshing if expired. `None`
/// when the server isn't authorized. Used by the HTTP transport to attach a
/// Bearer header.
pub async fn valid_access_token(server_id: &str) -> Option<String> {
    let tokens = load_tokens(server_id)?;
    if !tokens.is_expired(now_unix_secs(), 30) {
        return Some(tokens.access_token);
    }
    let refresh = tokens.refresh_token.clone()?;
    let client = oauth_http_client();
    match refresh_with(&client, &tokens, &refresh).await {
        Ok(fresh) => {
            let _ = store_tokens(server_id, &fresh).await;
            Some(fresh.access_token)
        }
        // Refresh failed — hand back the (expired) token; the server will 401
        // and the user can re-authorize.
        Err(_) => Some(tokens.access_token),
    }
}

/// Run the full browser-based authorization-code + PKCE flow for a remote MCP
/// server and persist the resulting tokens. Requires the server to support
/// dynamic client registration (RFC 7591) — Notesage ships no static client.
#[tauri::command]
pub async fn mcp_oauth_authorize(
    app: tauri::AppHandle,
    server_id: String,
    server_url: String,
    scope: Option<String>,
) -> Result<OAuthStatus, String> {
    let client = oauth_http_client();

    let metadata = discover_metadata(&client, &server_url).await?;
    let registration_endpoint = metadata
        .registration_endpoint
        .clone()
        .ok_or("This server does not advertise dynamic client registration")?;

    let (redirect_uri, listener) = bind_loopback().await?;
    let reg = register_client(&client, &registration_endpoint, &redirect_uri).await?;
    let (verifier, challenge) = generate_pkce();
    let state = uuid::Uuid::new_v4().to_string();

    // Re-validate the authorization endpoint before handing it to the browser.
    validate_external_url(&metadata.authorization_endpoint)?;
    let auth_url = build_authorize_url(
        &metadata.authorization_endpoint,
        &reg.client_id,
        &redirect_uri,
        &challenge,
        &state,
        scope.as_deref(),
    )?;
    app.opener()
        .open_url(auth_url, None::<String>)
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    // Wait up to 5 minutes for the user to complete the browser flow.
    let params = tokio::time::timeout(Duration::from_secs(300), await_callback(listener))
        .await
        .map_err(|_| "Timed out waiting for authorization".to_string())??;

    if let Some(err) = params.error {
        return Err(format!("Authorization was denied: {}", err));
    }
    if params.state.as_deref() != Some(state.as_str()) {
        return Err("Authorization state mismatch — aborting for safety".to_string());
    }
    let code = params.code.ok_or("No authorization code was returned")?;

    let token = exchange_code(
        &client,
        &metadata.token_endpoint,
        &reg.client_id,
        reg.client_secret.as_deref(),
        &code,
        &verifier,
        &redirect_uri,
    )
    .await?;

    let tokens = OAuthTokens {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        token_type: token.token_type,
        expires_at: token.expires_in.map(|s| now_unix_secs() + s),
        scope: token.scope,
        token_endpoint: metadata.token_endpoint,
        client_id: reg.client_id,
        client_secret: reg.client_secret,
    };
    store_tokens(&server_id, &tokens).await?;
    Ok(OAuthStatus {
        authorized: true,
        expires_at: tokens.expires_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_matches_rfc4648_vectors() {
        assert_eq!(base64url_nopad(b""), "");
        assert_eq!(base64url_nopad(b"f"), "Zg");
        assert_eq!(base64url_nopad(b"fo"), "Zm8");
        assert_eq!(base64url_nopad(b"foo"), "Zm9v");
        assert_eq!(base64url_nopad(b"foob"), "Zm9vYg");
        assert_eq!(base64url_nopad(b"fooba"), "Zm9vYmE");
        assert_eq!(base64url_nopad(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn base64url_is_url_safe() {
        // 0xFB 0xFF maps to bytes that would be '+' '/' in standard base64.
        let s = base64url_nopad(&[0xfb, 0xff]);
        assert!(!s.contains('+') && !s.contains('/') && !s.contains('='));
    }

    #[test]
    fn pkce_challenge_is_s256_of_verifier() {
        let (verifier, challenge) = generate_pkce();
        assert_eq!(verifier.len(), 64);
        assert!(verifier.len() >= 43 && verifier.len() <= 128);
        // 32-byte SHA-256 → 43 base64url chars (no padding).
        assert_eq!(challenge.len(), 43);
        let expected = base64url_nopad(Sha256::digest(verifier.as_bytes()).as_slice());
        assert_eq!(challenge, expected);
    }

    #[test]
    fn pkce_pairs_are_unique() {
        assert_ne!(generate_pkce().0, generate_pkce().0);
    }

    #[test]
    fn parse_callback_extracts_code_and_state() {
        let p = parse_callback_request_line("GET /callback?code=abc123&state=xyz HTTP/1.1");
        assert_eq!(p.code.as_deref(), Some("abc123"));
        assert_eq!(p.state.as_deref(), Some("xyz"));
        assert!(p.error.is_none());
    }

    #[test]
    fn parse_callback_percent_decodes_and_reads_error() {
        let p = parse_callback_request_line("GET /callback?error=access_denied&code=a%2Bb HTTP/1.1");
        assert_eq!(p.error.as_deref(), Some("access_denied"));
        assert_eq!(p.code.as_deref(), Some("a+b"));
    }

    #[test]
    fn build_authorize_url_has_pkce_and_required_params() {
        let url = build_authorize_url(
            "https://auth.example.com/authorize",
            "client-1",
            "http://127.0.0.1:1234/callback",
            "CHALLENGE",
            "STATE",
            Some("mcp"),
        )
        .expect("url");
        assert!(url.starts_with("https://auth.example.com/authorize?"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains("code_challenge=CHALLENGE"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("client_id=client-1"));
        assert!(url.contains("state=STATE"));
        assert!(url.contains("scope=mcp"));
        // redirect_uri is percent-encoded
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcallback"));
    }

    #[test]
    fn build_authorize_url_rejects_bad_endpoint() {
        assert!(build_authorize_url("not a url", "c", "r", "ch", "s", None).is_err());
    }

    #[test]
    fn tokens_expiry_respects_skew() {
        let mut t = OAuthTokens {
            access_token: "a".into(),
            refresh_token: None,
            token_type: Some("Bearer".into()),
            expires_at: Some(1000),
            scope: None,
            token_endpoint: "https://auth/token".into(),
            client_id: "c".into(),
            client_secret: None,
        };
        assert!(t.is_expired(1000, 0)); // exactly at expiry
        assert!(t.is_expired(960, 60)); // within skew window
        assert!(!t.is_expired(900, 30)); // comfortably valid
        t.expires_at = None;
        assert!(!t.is_expired(u64::MAX, 0)); // unknown expiry never expires
    }

    #[test]
    fn tokens_round_trip_through_json() {
        let t = OAuthTokens {
            access_token: "tok".into(),
            refresh_token: Some("ref".into()),
            token_type: Some("Bearer".into()),
            expires_at: Some(42),
            scope: Some("mcp".into()),
            token_endpoint: "https://auth/token".into(),
            client_id: "c".into(),
            client_secret: Some("s".into()),
        };
        let json = serde_json::to_string(&t).unwrap();
        let back: OAuthTokens = serde_json::from_str(&json).unwrap();
        assert_eq!(t, back);
    }

    #[test]
    fn oauth_service_id_is_namespaced() {
        assert_eq!(oauth_service("global:github"), "notesage:mcp:global:github:oauth");
    }

    #[test]
    fn validate_external_url_accepts_public_https() {
        assert!(validate_external_url("https://accounts.google.com").is_ok());
        assert!(validate_external_url("https://api.example.com/.well-known/x").is_ok());
        // A public IP literal is fine.
        assert!(validate_external_url("https://8.8.8.8/token").is_ok());
    }

    #[test]
    fn validate_external_url_rejects_non_https() {
        assert!(validate_external_url("http://example.com").is_err());
        assert!(validate_external_url("ftp://example.com").is_err());
        assert!(validate_external_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn validate_external_url_rejects_cloud_metadata_endpoint() {
        // AWS/GCP/Azure link-local metadata service.
        assert!(validate_external_url("https://169.254.169.254/latest/meta-data/").is_err());
    }

    #[test]
    fn validate_external_url_rejects_localhost() {
        assert!(validate_external_url("https://localhost/oauth").is_err());
        assert!(validate_external_url("https://app.localhost/oauth").is_err());
        assert!(validate_external_url("https://LOCALHOST:8443/x").is_err());
    }

    #[test]
    fn validate_external_url_rejects_private_ipv4() {
        assert!(validate_external_url("https://10.0.0.1").is_err());
        assert!(validate_external_url("https://172.16.0.1").is_err());
        assert!(validate_external_url("https://192.168.1.1").is_err());
        assert!(validate_external_url("https://127.0.0.1:9000/x").is_err());
        assert!(validate_external_url("https://0.0.0.0").is_err());
    }

    #[test]
    fn validate_external_url_rejects_internal_ipv6() {
        assert!(validate_external_url("https://[::1]").is_err()); // loopback
        assert!(validate_external_url("https://[::]").is_err()); // unspecified
        assert!(validate_external_url("https://[fe80::1]").is_err()); // link-local
        assert!(validate_external_url("https://[fc00::1]").is_err()); // unique-local
        assert!(validate_external_url("https://[fd12:3456::1]").is_err()); // unique-local
    }

    #[test]
    fn validate_external_url_uses_shared_superset_blocklist() {
        // Regression lock for audit batch 3 fix #10: these ranges were missing
        // from this module's old private blocklist and are only rejected
        // because validation now routes through the shared `net_guard` list.
        assert!(validate_external_url("https://100.64.0.1/token").is_err()); // CGNAT
        assert!(validate_external_url("https://255.255.255.255/x").is_err()); // broadcast
        assert!(validate_external_url("https://192.0.2.1/x").is_err()); // documentation
        assert!(validate_external_url("https://0.1.2.3/x").is_err()); // 0.0.0.0/8
        assert!(validate_external_url("https://[::ffff:127.0.0.1]/x").is_err()); // v4-mapped loopback
    }

    #[test]
    fn well_known_uses_origin_only() {
        assert_eq!(
            well_known("https://api.example.com/mcp/v1", "oauth-protected-resource"),
            "https://api.example.com/.well-known/oauth-protected-resource"
        );
        assert_eq!(
            well_known("https://host:8443/path", "oauth-authorization-server"),
            "https://host:8443/.well-known/oauth-authorization-server"
        );
    }
}
