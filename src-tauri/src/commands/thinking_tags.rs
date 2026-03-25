use super::constants;
use super::local_inference::LocalInferenceState;
use super::model_management::CatalogEntry;

// ---------------------------------------------------------------------------
// Thinking tag detection from llama-server /props chat_template
// ---------------------------------------------------------------------------

/// Detect thinking tags from llama-server's /props chat_template.
/// Returns None if no thinking pattern is found in the template.
pub async fn detect_thinking_tags_from_template(port: u16) -> Option<(String, String)> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;
    let resp = client
        .get(format!("http://127.0.0.1:{}/props", port))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let props: serde_json::Value = resp.json().await.ok()?;
    let template = props.get("chat_template")?.as_str()?;
    parse_thinking_tags_from_jinja(template)
}

/// Parse a Jinja2 chat template for thinking tag patterns.
/// Looks for blocks like `{% if thinking %}`, `{% if message.role == "thinking" %}`
/// and extracts the surrounding XML-like delimiter tags.
fn parse_thinking_tags_from_jinja(template: &str) -> Option<(String, String)> {
    // Common patterns in Jinja2 chat templates for thinking blocks:
    //   {% if thinking %}...<think>{{ thinking }}</think>...{% endif %}
    //   {%- if message.role == "thinking" -%}<think>{{ message.content }}</think>{%- endif -%}
    //   {%- if message['role'] == 'thinking' -%}
    // We scan for these patterns and extract the XML tags surrounding them.

    // Strategy 1: Look for a thinking-related Jinja block and extract tags
    let thinking_indicators = [
        "if thinking",
        "message.role == \"thinking\"",
        "message.role == 'thinking'",
        "message['role'] == 'thinking'",
        "message['role'] == \"thinking\"",
        "if message.thinking",
    ];

    for indicator in &thinking_indicators {
        if let Some(pos) = template.find(indicator) {
            // Search for XML-like tags near this position
            let region_start = pos.saturating_sub(200);
            let region_end = (pos + 400).min(template.len());
            let region = &template[region_start..region_end];

            if let Some(tags) = extract_xml_tags_from_region(region) {
                return Some(tags);
            }
        }
    }

    // Strategy 2: Look for known thinking tag patterns directly in the template
    let known_patterns = [
        ("<think>", "</think>"),
        ("<thinking>", "</thinking>"),
        ("<thought>", "</thought>"),
        ("<reasoning>", "</reasoning>"),
    ];

    for (open, close) in &known_patterns {
        if template.contains(open) && template.contains(close) {
            return Some((open.to_string(), close.to_string()));
        }
    }

    None
}

/// Extract XML-like opening/closing tag pair from a template region.
fn extract_xml_tags_from_region(region: &str) -> Option<(String, String)> {
    // Look for patterns like <think>...</think>, <|think|>...<|/think|>
    let re_patterns = [
        // Standard XML tags: <tagname>...</tagname>
        ("<think>", "</think>"),
        ("<thinking>", "</thinking>"),
        ("<thought>", "</thought>"),
        ("<reasoning>", "</reasoning>"),
        ("<reflection>", "</reflection>"),
        // Pipe-delimited: <|think|>...<|/think|>
        ("<|think|>", "<|/think|>"),
        ("<|thinking|>", "<|/thinking|>"),
    ];

    for (open, close) in &re_patterns {
        if region.contains(open) {
            return Some((open.to_string(), close.to_string()));
        }
    }

    None
}

/// Get thinking tags for a custom/unknown model, using cached /props detection
/// with fallback to FALLBACK_THINKING_TAGS.
pub async fn get_thinking_tags_for_custom_model(
    state: &LocalInferenceState,
    port: u16,
) -> Vec<(String, String)> {
    // Check cache first
    let cached = state.detected_thinking_tags().await;
    if let Some(cached_result) = cached {
        return match cached_result {
            Some((open, close)) => vec![(open, close)],
            None => constants::FALLBACK_THINKING_TAGS
                .iter()
                .map(|(o, c)| (o.to_string(), c.to_string()))
                .collect(),
        };
    }

    // Not cached yet — detect from /props
    let detected = detect_thinking_tags_from_template(port).await;
    state.set_detected_thinking_tags(Some(detected.clone())).await;

    match detected {
        Some((open, close)) => vec![(open, close)],
        None => constants::FALLBACK_THINKING_TAGS
            .iter()
            .map(|(o, c)| (o.to_string(), c.to_string()))
            .collect(),
    }
}

/// Strip thinking/reasoning XML tags from model output, using catalog metadata when available.
/// `detected_tags` provides /props-detected tags for custom models (cached by the streaming path).
pub fn strip_thinking_tags_for_model(
    text: &str,
    catalog_entry: Option<&CatalogEntry>,
    detected_tags: Option<&(String, String)>,
) -> String {
    let tag_pairs_owned: Vec<(String, String)> = match catalog_entry {
        Some(entry) if !entry.supports_thinking => return text.trim().to_string(),
        Some(entry) => match &entry.thinking_tags {
            Some(tags) => vec![(tags.open.clone(), tags.close.clone())],
            None => vec![("<think>".to_string(), "</think>".to_string())],
        },
        None => match detected_tags {
            Some((open, close)) => vec![(open.clone(), close.clone())],
            None => {
                // Custom/unknown model, no /props detection — use shared fallback set
                constants::FALLBACK_THINKING_TAGS
                    .iter().map(|(o, c)| (o.to_string(), c.to_string())).collect()
            }
        }
    };

    let mut result = text.to_string();
    for (open, close) in &tag_pairs_owned {
        loop {
            let Some(start) = result.find(open.as_str()) else { break };
            if let Some(end) = result[start..].find(close.as_str()) {
                result = format!("{}{}", &result[..start], &result[start + end + close.len()..]);
            } else {
                // Opening tag without closing — strip from opening tag to end
                result = result[..start].to_string();
                break;
            }
        }
    }
    result.trim().to_string()
}
