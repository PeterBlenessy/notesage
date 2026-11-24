use serde_json;

/// Thinking tag pair inferred from a model's capabilities or template.
#[derive(Debug, Clone)]
pub struct ThinkingTags {
    pub opening: String,
    pub closing: String,
}

/// Result of querying a model's thinking capabilities.
#[derive(Debug)]
pub struct ThinkingSupport {
    /// Whether the model natively supports Ollama's `think: true` parameter.
    pub has_native: bool,
    /// Tags to parse from the content stream (when native thinking is not available).
    pub tags: Option<ThinkingTags>,
}

/// Query the Ollama `/api/show` endpoint for a model and return its thinking support.
///
/// Ollama detects thinking capability from the model template. When a model
/// doesn't support native `think: true`, it may still emit thinking tags like
/// `<think>...</think>` in its content. We detect these by inspecting the
/// model template for common patterns rather than hardcoding model-specific tags.
pub async fn detect_thinking_support(
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
) -> ThinkingSupport {
    let url = format!("{}/api/show", base_url);
    let resp = client
        .post(&url)
        .json(&serde_json::json!({ "name": model }))
        .send()
        .await;

    let json = match resp {
        Ok(r) if r.status().is_success() => r.json::<serde_json::Value>().await.ok(),
        _ => None,
    };

    let json = match json {
        Some(j) => j,
        None => return ThinkingSupport { has_native: false, tags: None },
    };

    // Check if capabilities include "thinking"
    let has_native_thinking = json["capabilities"]
        .as_array()
        .map(|arr| arr.iter().any(|v| v.as_str() == Some("thinking")))
        .unwrap_or(false);

    if has_native_thinking {
        return ThinkingSupport { has_native: true, tags: None };
    }

    // Model doesn't support native thinking. Inspect the template for thinking
    // tag patterns. Common patterns across models:
    //   <think>...</think>       (DeepSeek-R1, Qwen, phi4)
    //   <thinking>...</thinking> (some models)
    //   <thought>...</thought>   (some models)
    let template_str = json["template"].as_str().unwrap_or("");

    // Look for {{.Thinking}} or {{ .Thinking }} references in the Go template
    // which indicate the model is designed for thinking but may not be registered
    // with Ollama's parser system yet.
    let has_thinking_field = template_str.contains(".Thinking");

    if has_thinking_field {
        // The model template references Thinking but Ollama didn't detect it.
        // Try to extract the tags surrounding the Thinking field reference.
        // Common template patterns:
        //   <think>{{.Thinking}}</think>
        //   <|think|>{{.Thinking}}<|/think|>
        if let Some(tags) = extract_tags_from_template(template_str) {
            return ThinkingSupport { has_native: false, tags: Some(tags) };
        }
    }

    // Fallback: check if the model family/name suggests reasoning capability
    // and use standard <think>...</think> tags as a best guess.
    let model_lower = model.to_lowercase();
    let model_family = json["details"]["family"].as_str().unwrap_or("");
    let model_type = json["model_info"]["general.basename"].as_str().unwrap_or("");
    let is_reasoning_model = model_lower.contains("reason")
        || model_lower.contains("think")
        || model_lower.contains("deepseek-r1")
        || model_lower.contains("qwen")
        || model_family.contains("deepseek")
        || model_type.contains("reason")
        || model_type.contains("think");

    if is_reasoning_model {
        return ThinkingSupport {
            has_native: false,
            tags: Some(ThinkingTags {
                opening: "<think>".to_string(),
                closing: "</think>".to_string(),
            }),
        };
    }

    ThinkingSupport { has_native: false, tags: None }
}

/// Try to extract opening/closing tags from a Go template string by finding
/// text surrounding a `{{.Thinking}}` reference.
fn extract_tags_from_template(template: &str) -> Option<ThinkingTags> {
    // Find the position of .Thinking in the template
    let think_pos = template.find(".Thinking")?;

    // Walk backward from .Thinking to find the nearest non-template text
    // that looks like an XML-ish opening tag
    let before = &template[..think_pos];
    let after = &template[think_pos..];

    // Look for patterns like `<think>`, `<|think|>`, etc. before .Thinking
    // by finding the last `<` before the template action
    let opening = extract_tag_before(before)?;
    let closing = extract_tag_after(after)?;

    Some(ThinkingTags { opening, closing })
}

fn extract_tag_before(s: &str) -> Option<String> {
    // Find the last line/segment that contains a `<` before the template action
    // Look for pattern: <tagname> or <|tagname|>
    let trimmed = s.trim_end_matches(|c: char| c == '{' || c == ' ' || c == '-');
    let last_line = trimmed.lines().last().unwrap_or("").trim();
    if last_line.starts_with('<') && last_line.ends_with('>') {
        return Some(last_line.to_string());
    }
    None
}

fn extract_tag_after(s: &str) -> Option<String> {
    // Skip past the `{{.Thinking}}` action and find the closing tag
    let after_action = s.find("}}")? + 2;
    let rest = s[after_action..].trim_start();
    let first_line = rest.lines().next().unwrap_or("").trim();
    if first_line.starts_with("</") && first_line.ends_with('>') {
        return Some(first_line.to_string());
    }
    // Also match <|/tagname|> style
    if first_line.starts_with("<|/") && first_line.ends_with("|>") {
        return Some(first_line.to_string());
    }
    None
}
