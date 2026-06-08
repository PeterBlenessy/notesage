use serde::{Deserialize, Serialize};
use std::net::{IpAddr, ToSocketAddrs};

/// Maximum bytes we will read from a link-preview response body.
const MAX_PREVIEW_BODY_BYTES: usize = 2 * 1024 * 1024; // 2 MiB
/// Maximum number of redirects we will follow (each re-validated for SSRF).
const MAX_PREVIEW_REDIRECTS: usize = 3;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LinkMetadata {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
    pub image_url: Option<String>,
    pub favicon_url: Option<String>,
}

/// Fetch a URL and extract OpenGraph / meta tag metadata from the HTML `<head>`.
/// Returns structured link preview data for rich link cards.
///
/// SSRF hardening: this command runs in the main (unsandboxed) process and is
/// auto-triggered when an agent-authored `> [!link](url)` card renders, so it
/// must not be usable to probe internal services. We require an http(s) scheme,
/// reject any host that resolves to a loopback/private/link-local/CGNAT address
/// (covers the cloud-metadata endpoint and the app's own localhost servers),
/// re-validate every redirect hop, and cap the response body size.
#[tauri::command]
pub async fn fetch_link_metadata(url: String) -> Result<LinkMetadata, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        // Follow redirects manually so every hop can be re-validated for SSRF.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let original_url = validate_public_url(&url).await?;
    let mut current = original_url.clone();
    let mut redirects = 0usize;

    let mut resp = loop {
        let resp = client
            .get(current.clone())
            .header(
                "User-Agent",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            .header("Accept", "text/html,application/xhtml+xml")
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if resp.status().is_redirection() {
            if redirects >= MAX_PREVIEW_REDIRECTS {
                return Err("Too many redirects".to_string());
            }
            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or("Redirect without a Location header")?;
            // Resolve relative redirects against the current URL, then re-validate.
            let next = current
                .join(location)
                .map_err(|e| format!("Invalid redirect target: {}", e))?;
            current = validate_public_url(next.as_str()).await?;
            redirects += 1;
            continue;
        }
        break resp;
    };

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    // Only parse HTML responses — skip binary, JSON, etc.
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if !content_type.contains("text/html") && !content_type.contains("application/xhtml") {
        return Err(format!("Not an HTML page (Content-Type: {})", content_type));
    }

    // Read the body with a hard size cap — defends against unbounded or chunked
    // responses that carry no Content-Length.
    let mut body = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?
    {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_PREVIEW_BODY_BYTES {
            return Err("Response body too large".to_string());
        }
    }
    let html = String::from_utf8_lossy(&body).into_owned();

    Ok(parse_html_metadata(original_url.as_str(), &html))
}

/// Validate that a URL is safe to fetch server-side: an http(s) scheme and a
/// host that does not resolve to a private/loopback/link-local address.
/// Returns the parsed URL on success so the caller can reuse it.
async fn validate_public_url(raw: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(raw).map_err(|e| format!("Invalid URL: {}", e))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => {
            return Err(format!(
                "Unsupported URL scheme '{}': only http(s) is allowed",
                other
            ))
        }
    }
    let host = parsed.host_str().ok_or("URL has no host")?.to_string();

    // Host given as an IP literal — check it directly (no DNS).
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err("Refusing to fetch a private or loopback address".to_string());
        }
        return Ok(parsed);
    }

    // Hostname — resolve and reject if ANY resolved address is blocked.
    // DNS resolution is blocking, so run it on the blocking pool (our tokio
    // build does not enable the `net` feature for async lookup_host).
    let port = parsed.port_or_known_default().unwrap_or(80);
    let resolved = tokio::task::spawn_blocking(move || {
        (host.as_str(), port)
            .to_socket_addrs()
            .map(|it| it.collect::<Vec<_>>())
    })
    .await
    .map_err(|e| format!("DNS resolution task failed: {}", e))?
    .map_err(|e| format!("Could not resolve host: {}", e))?;
    let mut saw_any = false;
    for addr in resolved {
        saw_any = true;
        if is_blocked_ip(addr.ip()) {
            return Err(
                "Refusing to fetch a host that resolves to a private or loopback address"
                    .to_string(),
            );
        }
    }
    if !saw_any {
        return Err("Host did not resolve to any address".to_string());
    }
    Ok(parsed)
}

/// True if an IP is in a range we must never fetch from the main process
/// (loopback, RFC-1918 private, link-local incl. cloud metadata, CGNAT, ULA…).
fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()            // 127.0.0.0/8
                || v4.is_private()      // 10/8, 172.16/12, 192.168/16
                || v4.is_link_local()   // 169.254.0.0/16 (incl. 169.254.169.254 metadata)
                || v4.is_broadcast()    // 255.255.255.255
                || v4.is_unspecified()  // 0.0.0.0
                || v4.is_documentation()
                || o[0] == 0            // 0.0.0.0/8
                || (o[0] == 100 && (o[1] & 0xc0) == 0x40) // 100.64.0.0/10 CGNAT
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_blocked_ip(IpAddr::V4(v4));
            }
            let seg = v6.segments();
            v6.is_loopback()
                || v6.is_unspecified()
                || (seg[0] & 0xfe00) == 0xfc00 // fc00::/7 unique-local
                || (seg[0] & 0xffc0) == 0xfe80 // fe80::/10 link-local
        }
    }
}

/// Parse HTML and extract metadata using CSS selectors.
fn parse_html_metadata(page_url: &str, html: &str) -> LinkMetadata {
    let document = scraper::Html::parse_document(html);

    let og_title = select_meta_property(&document, "og:title");
    let og_description = select_meta_property(&document, "og:description");
    let og_image = select_meta_property(&document, "og:image");
    let og_site_name = select_meta_property(&document, "og:site_name");

    let html_title = select_title(&document);
    let meta_description = select_meta_name(&document, "description");

    let title = og_title.or(html_title);
    let description = og_description.or(meta_description);
    let image_url = og_image.map(|img| resolve_url(page_url, &img));
    let site_name = og_site_name.or_else(|| extract_domain(page_url));
    let favicon_url = Some(resolve_favicon(page_url, &document));

    LinkMetadata {
        url: page_url.to_string(),
        title,
        description,
        site_name,
        image_url,
        favicon_url,
    }
}

/// Select an OpenGraph `<meta property="..." content="...">` value.
fn select_meta_property(document: &scraper::Html, property: &str) -> Option<String> {
    let selector_str = format!("meta[property=\"{}\"]", property);
    let selector = scraper::Selector::parse(&selector_str).ok()?;
    document
        .select(&selector)
        .next()
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Select a `<meta name="..." content="...">` value.
fn select_meta_name(document: &scraper::Html, name: &str) -> Option<String> {
    let selector_str = format!("meta[name=\"{}\"]", name);
    let selector = scraper::Selector::parse(&selector_str).ok()?;
    document
        .select(&selector)
        .next()
        .and_then(|el| el.value().attr("content"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Select the `<title>` element text.
fn select_title(document: &scraper::Html) -> Option<String> {
    let selector = scraper::Selector::parse("title").ok()?;
    document
        .select(&selector)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Resolve the favicon URL from `<link rel="icon">` or `<link rel="shortcut icon">`,
/// falling back to `{origin}/favicon.ico`.
fn resolve_favicon(page_url: &str, document: &scraper::Html) -> String {
    // Try <link rel="icon">
    if let Some(href) = select_link_href(document, "icon") {
        return resolve_url(page_url, &href);
    }
    // Try <link rel="shortcut icon">
    if let Some(href) = select_link_href(document, "shortcut icon") {
        return resolve_url(page_url, &href);
    }
    // Fallback to /favicon.ico at origin
    extract_origin(page_url)
        .map(|origin| format!("{}/favicon.ico", origin))
        .unwrap_or_default()
}

/// Select the `href` attribute from `<link rel="...">`.
fn select_link_href(document: &scraper::Html, rel: &str) -> Option<String> {
    let selector_str = format!("link[rel=\"{}\"]", rel);
    let selector = scraper::Selector::parse(&selector_str).ok()?;
    document
        .select(&selector)
        .next()
        .and_then(|el| el.value().attr("href"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Resolve a potentially relative URL against the page URL.
fn resolve_url(base: &str, href: &str) -> String {
    // Already absolute
    if href.starts_with("http://") || href.starts_with("https://") {
        return href.to_string();
    }
    // Protocol-relative
    if let Some(stripped) = href.strip_prefix("//") {
        let protocol = if base.starts_with("https") {
            "https"
        } else {
            "http"
        };
        return format!("{}://{}", protocol, stripped);
    }
    // Relative to origin
    if let Some(origin) = extract_origin(base) {
        if href.starts_with('/') {
            return format!("{}{}", origin, href);
        }
        // Relative to current path
        if let Some(base_path) = base.rfind('/') {
            return format!("{}/{}", &base[..base_path], href);
        }
    }
    href.to_string()
}

/// Extract the origin (scheme + host + optional port) from a URL.
fn extract_origin(url: &str) -> Option<String> {
    // Find scheme://
    let scheme_end = url.find("://")?;
    let after_scheme = &url[scheme_end + 3..];
    // Find end of host (first / or end of string)
    let host_end = after_scheme.find('/').unwrap_or(after_scheme.len());
    Some(format!("{}{}", &url[..scheme_end + 3], &after_scheme[..host_end]))
}

/// Extract the domain name from a URL for site_name fallback.
fn extract_domain(url: &str) -> Option<String> {
    let origin = extract_origin(url)?;
    let after_scheme = origin.split("://").nth(1)?;
    // Strip www. prefix and port
    let host = after_scheme.split(':').next().unwrap_or(after_scheme);
    let domain = host.strip_prefix("www.").unwrap_or(host);
    if domain.is_empty() {
        None
    } else {
        Some(domain.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Compile-time assertion: scraper must be pinned to 0.27 in Cargo.toml.
    /// This test is RED when scraper = "0.23" and GREEN after the bump to "0.27".
    #[test]
    fn test_scraper_dependency_is_0_27() {
        let cargo_toml = include_str!("../../Cargo.toml");
        assert!(
            cargo_toml.contains("scraper = \"0.27\""),
            "Expected scraper = \"0.27\" in Cargo.toml but found: {}",
            cargo_toml
                .lines()
                .find(|l| l.contains("scraper"))
                .unwrap_or("<scraper line not found>")
        );
    }

    #[test]
    fn test_full_metadata() {
        let html = r#"
        <html>
        <head>
            <title>Page Title</title>
            <meta property="og:title" content="OG Title">
            <meta property="og:description" content="OG Description">
            <meta property="og:image" content="https://example.com/image.png">
            <meta property="og:site_name" content="Example Site">
            <link rel="icon" href="/favicon.png">
        </head>
        <body></body>
        </html>
        "#;
        let meta = parse_html_metadata("https://example.com/page", html);
        assert_eq!(meta.url, "https://example.com/page");
        assert_eq!(meta.title.as_deref(), Some("OG Title"));
        assert_eq!(meta.description.as_deref(), Some("OG Description"));
        assert_eq!(meta.image_url.as_deref(), Some("https://example.com/image.png"));
        assert_eq!(meta.site_name.as_deref(), Some("Example Site"));
        assert_eq!(meta.favicon_url.as_deref(), Some("https://example.com/favicon.png"));
    }

    #[test]
    fn test_partial_metadata_fallback_to_html_title() {
        let html = r#"
        <html>
        <head>
            <title>HTML Title</title>
            <meta name="description" content="Meta description">
        </head>
        <body></body>
        </html>
        "#;
        let meta = parse_html_metadata("https://example.com/page", html);
        assert_eq!(meta.title.as_deref(), Some("HTML Title"));
        assert_eq!(meta.description.as_deref(), Some("Meta description"));
        // No og:site_name, should fall back to domain
        assert_eq!(meta.site_name.as_deref(), Some("example.com"));
        assert!(meta.image_url.is_none());
        // No <link rel="icon">, should fall back to /favicon.ico
        assert_eq!(meta.favicon_url.as_deref(), Some("https://example.com/favicon.ico"));
    }

    #[test]
    fn test_missing_tags() {
        let html = "<html><head></head><body></body></html>";
        let meta = parse_html_metadata("https://example.com", html);
        assert!(meta.title.is_none());
        assert!(meta.description.is_none());
        assert!(meta.image_url.is_none());
        assert_eq!(meta.site_name.as_deref(), Some("example.com"));
        assert_eq!(meta.favicon_url.as_deref(), Some("https://example.com/favicon.ico"));
    }

    #[test]
    fn test_og_title_takes_precedence_over_html_title() {
        let html = r#"
        <html>
        <head>
            <title>HTML Title</title>
            <meta property="og:title" content="OG Title">
        </head>
        </html>
        "#;
        let meta = parse_html_metadata("https://example.com", html);
        assert_eq!(meta.title.as_deref(), Some("OG Title"));
    }

    #[test]
    fn test_favicon_shortcut_icon_fallback() {
        let html = r#"
        <html>
        <head>
            <link rel="shortcut icon" href="/img/shortcut.ico">
        </head>
        </html>
        "#;
        let meta = parse_html_metadata("https://example.com/page", html);
        assert_eq!(meta.favicon_url.as_deref(), Some("https://example.com/img/shortcut.ico"));
    }

    #[test]
    fn test_resolve_relative_image_url() {
        let html = r#"
        <html>
        <head>
            <meta property="og:image" content="/images/preview.jpg">
        </head>
        </html>
        "#;
        let meta = parse_html_metadata("https://example.com/blog/post", html);
        assert_eq!(meta.image_url.as_deref(), Some("https://example.com/images/preview.jpg"));
    }

    #[test]
    fn test_resolve_protocol_relative_image_url() {
        let html = r#"
        <html>
        <head>
            <meta property="og:image" content="//cdn.example.com/img.png">
        </head>
        </html>
        "#;
        let meta = parse_html_metadata("https://example.com", html);
        assert_eq!(meta.image_url.as_deref(), Some("https://cdn.example.com/img.png"));
    }

    #[test]
    fn test_domain_extraction_strips_www() {
        assert_eq!(extract_domain("https://www.example.com/page"), Some("example.com".to_string()));
        assert_eq!(extract_domain("https://blog.example.com"), Some("blog.example.com".to_string()));
    }

    #[test]
    fn test_extract_origin() {
        assert_eq!(extract_origin("https://example.com/path"), Some("https://example.com".to_string()));
        assert_eq!(extract_origin("http://localhost:3000/page"), Some("http://localhost:3000".to_string()));
    }

    #[test]
    fn test_resolve_url_absolute() {
        assert_eq!(resolve_url("https://a.com", "https://b.com/img.png"), "https://b.com/img.png");
    }

    #[test]
    fn test_resolve_url_relative_to_root() {
        assert_eq!(resolve_url("https://a.com/path/page", "/img.png"), "https://a.com/img.png");
    }

    #[test]
    fn test_resolve_url_relative_path() {
        assert_eq!(resolve_url("https://a.com/blog/post", "image.png"), "https://a.com/blog/image.png");
    }

    #[test]
    fn test_empty_content_attributes_ignored() {
        let html = r#"
        <html>
        <head>
            <meta property="og:title" content="">
            <meta property="og:description" content="   ">
            <title>   </title>
        </head>
        </html>
        "#;
        let meta = parse_html_metadata("https://example.com", html);
        assert!(meta.title.is_none());
        assert!(meta.description.is_none());
    }

    #[test]
    fn blocks_private_loopback_and_metadata_ips() {
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254", // cloud metadata
            "100.64.0.1",      // CGNAT
            "0.0.0.0",
        ] {
            assert!(
                is_blocked_ip(ip.parse::<IpAddr>().unwrap()),
                "{} should be blocked",
                ip
            );
        }
        assert!(is_blocked_ip("::1".parse::<IpAddr>().unwrap()));
        assert!(is_blocked_ip("fe80::1".parse::<IpAddr>().unwrap()));
        assert!(is_blocked_ip("fc00::1".parse::<IpAddr>().unwrap()));
        assert!(is_blocked_ip("::ffff:127.0.0.1".parse::<IpAddr>().unwrap()));
    }

    #[test]
    fn allows_public_ips() {
        assert!(!is_blocked_ip("8.8.8.8".parse::<IpAddr>().unwrap()));
        assert!(!is_blocked_ip("1.1.1.1".parse::<IpAddr>().unwrap()));
        assert!(!is_blocked_ip("2606:4700:4700::1111".parse::<IpAddr>().unwrap()));
    }

    #[tokio::test]
    async fn rejects_non_http_scheme() {
        assert!(validate_public_url("file:///etc/passwd").await.is_err());
        assert!(validate_public_url("ftp://example.com").await.is_err());
    }

    #[tokio::test]
    async fn rejects_ip_literal_to_internal_targets() {
        // Cloud metadata, the app's own localhost inference server, and IPv6 loopback.
        assert!(validate_public_url("http://169.254.169.254/latest/meta-data/")
            .await
            .is_err());
        assert!(validate_public_url("http://127.0.0.1:8190/").await.is_err());
        assert!(validate_public_url("http://[::1]/").await.is_err());
    }
}
