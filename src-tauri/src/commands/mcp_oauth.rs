//! OAuth 2.1 (PKCE) support for remote (HTTP) MCP servers.
//!
//! This module is intentionally hand-rolled on `reqwest` + `url` + `sha2`
//! rather than pulling in the `oauth2` crate: the flow we need (authorization
//! code + PKCE, dynamic client registration, refresh) is small, and keeping it
//! explicit lets every step be unit-tested. The fiddly pieces — PKCE
//! generation, `WWW-Authenticate` parsing, the loopback callback query, and the
//! authorize-URL shape — are pure functions covered by tests below.
//!
//! Tokens are persisted as a JSON blob in the OS keychain under
//! `notesage:mcp:<server_id>:oauth` (the same keyring layer connections use).
//! Secret material never touches `mcp.json` and is never returned to the
//! frontend — `mcp_oauth_status` reports only authorized/expiry.
//!
//! The async flow (discovery, dynamic client registration, loopback capture,
//! token exchange/refresh, and the `mcp_oauth_authorize` command) lands in a
//! follow-up; this file establishes the tested core + storage + status/logout.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

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

/// Parsed `WWW-Authenticate` challenge from a 401 on a protected MCP endpoint.
#[derive(Debug, Default, PartialEq)]
pub struct WwwAuthChallenge {
    /// RFC 9728 `resource_metadata` URL, if advertised.
    pub resource_metadata: Option<String>,
    /// `authorization_uri`, if advertised directly.
    pub authorization_uri: Option<String>,
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

/// Parse a `WWW-Authenticate` header for the `resource_metadata` (RFC 9728)
/// and/or `authorization_uri` params. Tolerant of the `Bearer` scheme prefix
/// and quoted values; ignores params it doesn't recognize.
pub fn parse_www_authenticate(header: &str) -> WwwAuthChallenge {
    let mut out = WwwAuthChallenge::default();
    for part in header.split(',') {
        let part = part.trim();
        let Some((raw_key, raw_val)) = part.split_once('=') else {
            continue;
        };
        // The first param may be prefixed with the auth scheme, e.g. `Bearer key`.
        let key = raw_key.trim().rsplit(' ').next().unwrap_or("").trim();
        let val = raw_val.trim().trim_matches('"');
        match key {
            "resource_metadata" => out.resource_metadata = Some(val.to_string()),
            "authorization_uri" => out.authorization_uri = Some(val.to_string()),
            _ => {}
        }
    }
    out
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
    fn parse_www_authenticate_extracts_resource_metadata() {
        let c = parse_www_authenticate(
            r#"Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource", error="invalid_token""#,
        );
        assert_eq!(
            c.resource_metadata.as_deref(),
            Some("https://api.example.com/.well-known/oauth-protected-resource")
        );
    }

    #[test]
    fn parse_www_authenticate_extracts_authorization_uri() {
        let c = parse_www_authenticate(r#"Bearer authorization_uri="https://auth.example.com""#);
        assert_eq!(c.authorization_uri.as_deref(), Some("https://auth.example.com"));
        assert!(c.resource_metadata.is_none());
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
}
