use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Perform a web search using DuckDuckGo HTML endpoint.
/// Parses the HTML response to extract search results.
#[tauri::command]
pub async fn web_search(query: String, max_results: Option<usize>) -> Result<Vec<SearchResult>, String> {
    let max = max_results.unwrap_or(5).min(10);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Use DuckDuckGo HTML endpoint (no API key, no JS required)
    let resp = client
        .post("https://html.duckduckgo.com/html/")
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(format!("q={}", urlencoding::encode(&query)))
        .send()
        .await
        .map_err(|e| format!("Search request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Search failed with status: {}", resp.status()));
    }

    let html = resp.text().await
        .map_err(|e| format!("Failed to read search response: {}", e))?;

    // Parse DuckDuckGo HTML results
    let results = parse_duckduckgo_html(&html, max);

    Ok(results)
}

/// Parse DuckDuckGo HTML search results page.
/// This is a simple string-splitting parser since we don't need a full HTML parser.
fn parse_duckduckgo_html(html: &str, max: usize) -> Vec<SearchResult> {
    let mut results = Vec::new();

    // DuckDuckGo HTML results have this structure:
    // <div class="result results_links results_links_deep web-result">
    //   <div class="links_main links_deep result__body">
    //     <h2 class="result__title">
    //       <a rel="nofollow" class="result__a" href="https://...">Title</a>
    //     </h2>
    //     <div class="result__extras">...</div>
    //     <a class="result__snippet" href="...">Snippet text</a>
    //   </div>
    // </div>

    // Split by result blocks
    let result_blocks: Vec<&str> = html.split("class=\"result results_links")
        .skip(1) // skip content before first result
        .collect();

    for block in result_blocks {
        if results.len() >= max {
            break;
        }

        // Extract URL from result__a href
        let url = extract_between(block, "class=\"result__a\" href=\"", "\"")
            .or_else(|| extract_between(block, "class='result__a' href='", "'"))
            .unwrap_or_default();

        // Skip DuckDuckGo internal links
        if url.is_empty() || url.starts_with('/') || url.contains("duckduckgo.com") {
            continue;
        }

        // DuckDuckGo wraps URLs in a redirect: //duckduckgo.com/l/?uddg=ENCODED_URL
        let actual_url = if url.contains("uddg=") {
            url.split("uddg=")
                .nth(1)
                .and_then(|u| u.split('&').next())
                .and_then(|u| urlencoding::decode(u).ok())
                .map(|u| u.into_owned())
                .unwrap_or_else(|| url.to_string())
        } else {
            url.to_string()
        };

        // Extract title from result__a tag content
        let title = extract_tag_content(block, "class=\"result__a\"")
            .or_else(|| extract_tag_content(block, "class='result__a'"))
            .unwrap_or_default();

        // Extract snippet from result__snippet
        let snippet = extract_tag_content(block, "class=\"result__snippet\"")
            .or_else(|| extract_tag_content(block, "class='result__snippet'"))
            .unwrap_or_default();

        if !actual_url.is_empty() && !title.is_empty() {
            results.push(SearchResult {
                title: html_decode(&strip_tags(&title)),
                url: actual_url,
                snippet: html_decode(&strip_tags(&snippet)),
            });
        }
    }

    results
}

/// Extract text between a start marker and end marker.
fn extract_between(s: &str, start: &str, end: &str) -> Option<String> {
    let start_pos = s.find(start)? + start.len();
    let remaining = &s[start_pos..];
    let end_pos = remaining.find(end)?;
    Some(remaining[..end_pos].to_string())
}

/// Extract the text content of an HTML tag identified by an attribute.
fn extract_tag_content(s: &str, attr: &str) -> Option<String> {
    let attr_pos = s.find(attr)?;
    let after_attr = &s[attr_pos..];
    // Find the closing > of the opening tag
    let tag_close = after_attr.find('>')?;
    let after_tag = &after_attr[tag_close + 1..];
    // Find the closing tag
    let end = after_tag.find("</").unwrap_or(after_tag.len());
    Some(after_tag[..end].to_string())
}

/// Strip HTML tags from a string.
fn strip_tags(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        if ch == '<' {
            in_tag = true;
        } else if ch == '>' {
            in_tag = false;
        } else if !in_tag {
            result.push(ch);
        }
    }
    result.trim().to_string()
}

/// Decode common HTML entities.
fn html_decode(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&#x27;", "'")
        .replace("&nbsp;", " ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_strip_tags() {
        assert_eq!(strip_tags("<b>hello</b> world"), "hello world");
        assert_eq!(strip_tags("no tags here"), "no tags here");
        assert_eq!(strip_tags("<a href=\"x\">link</a>"), "link");
    }

    #[test]
    fn test_html_decode() {
        assert_eq!(html_decode("hello &amp; world"), "hello & world");
        assert_eq!(html_decode("a &lt; b &gt; c"), "a < b > c");
        assert_eq!(html_decode("&quot;quoted&quot;"), "\"quoted\"");
        assert_eq!(html_decode("it&#39;s"), "it's");
    }

    #[test]
    fn test_extract_between() {
        assert_eq!(
            extract_between("href=\"https://example.com\" class", "href=\"", "\""),
            Some("https://example.com".to_string())
        );
        assert_eq!(extract_between("no match", "start", "end"), None);
    }

    #[test]
    fn test_parse_empty_html() {
        let results = parse_duckduckgo_html("", 5);
        assert!(results.is_empty());
    }

    #[test]
    fn test_parse_duckduckgo_result_block() {
        let html = r##"
        <div class="result results_links results_links_deep web-result">
          <div class="links_main">
            <h2><a class="result__a" href="https://example.com">Example Title</a></h2>
            <a class="result__snippet" href="#">This is a snippet about the result.</a>
          </div>
        </div>
        "##;
        let results = parse_duckduckgo_html(html, 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Example Title");
        assert_eq!(results[0].url, "https://example.com");
        assert_eq!(results[0].snippet, "This is a snippet about the result.");
    }

    #[test]
    fn test_parse_multiple_results_with_max() {
        let html = r##"
        <div class="result results_links web-result">
          <a class="result__a" href="https://one.com">One</a>
          <a class="result__snippet" href="#">Snippet one</a>
        </div>
        <div class="result results_links web-result">
          <a class="result__a" href="https://two.com">Two</a>
          <a class="result__snippet" href="#">Snippet two</a>
        </div>
        <div class="result results_links web-result">
          <a class="result__a" href="https://three.com">Three</a>
          <a class="result__snippet" href="#">Snippet three</a>
        </div>
        "##;
        let results = parse_duckduckgo_html(html, 2);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "One");
        assert_eq!(results[1].title, "Two");
    }

    #[test]
    fn test_parse_uddg_redirect_url() {
        let html = r##"
        <div class="result results_links web-result">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=abc">Example</a>
          <a class="result__snippet" href="#">A snippet</a>
        </div>
        "##;
        let results = parse_duckduckgo_html(html, 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].url, "https://example.com/page");
    }

    #[test]
    fn test_parse_skips_internal_links() {
        let html = r##"
        <div class="result results_links web-result">
          <a class="result__a" href="/feedback">Feedback</a>
          <a class="result__snippet" href="#">Internal link</a>
        </div>
        "##;
        let results = parse_duckduckgo_html(html, 5);
        assert!(results.is_empty());
    }

    #[test]
    fn test_strip_tags_with_nested_tags() {
        assert_eq!(strip_tags("<b><i>bold italic</i></b>"), "bold italic");
    }

    #[test]
    fn test_html_decode_nbsp() {
        assert_eq!(html_decode("hello&nbsp;world"), "hello world");
    }
}
