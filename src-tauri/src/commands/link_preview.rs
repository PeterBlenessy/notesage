use serde::{Deserialize, Serialize};

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
#[tauri::command]
pub async fn fetch_link_metadata(url: String) -> Result<LinkMetadata, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let resp = client
        .get(&url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .header("Accept", "text/html,application/xhtml+xml")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    // Only parse HTML responses — skip binary, JSON, etc.
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !content_type.contains("text/html") && !content_type.contains("application/xhtml") {
        return Err(format!("Not an HTML page (Content-Type: {})", content_type));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    Ok(parse_html_metadata(&url, &html))
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
}
