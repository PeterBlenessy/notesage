use serde::{Deserialize, Serialize};
use serde_json;
use tauri::Emitter;
use futures::StreamExt;
use super::ChatMessage;

/// Citation data emitted to the frontend via the `ai-citation` event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub url: String,
    pub title: String,
    pub cited_text: String,
}

/// Thinking tag pair inferred from a model's capabilities or template.
#[derive(Debug, Clone)]
struct ThinkingTags {
    opening: String,
    closing: String,
}

/// Query the Ollama `/api/show` endpoint for a model and return:
/// - whether the model natively supports `think: true`
/// - the thinking tags to look for in the content stream (if any)
///
/// Ollama detects thinking capability from the model template. When a model
/// doesn't support native `think: true`, it may still emit thinking tags like
/// `<think>...</think>` in its content. We detect these by inspecting the
/// model template for common patterns rather than hardcoding model-specific tags.
async fn detect_thinking_support(
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
) -> (bool, Option<ThinkingTags>) {
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
        None => return (false, None),
    };

    // Check if capabilities include "thinking"
    let has_native_thinking = json["capabilities"]
        .as_array()
        .map(|arr| arr.iter().any(|v| v.as_str() == Some("thinking")))
        .unwrap_or(false);

    if has_native_thinking {
        return (true, None); // Ollama handles it — no need for tag parsing
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
            return (false, Some(tags));
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
        return (false, Some(ThinkingTags {
            opening: "<think>".to_string(),
            closing: "</think>".to_string(),
        }));
    }

    (false, None)
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

/// Parse SSE events from a buffer. Extracts complete events (terminated by \n\n)
/// and returns them as (event_type, data) pairs. Mutates the buffer to remove
/// consumed events.
fn parse_sse_events(buffer: &mut String) -> Vec<(String, String)> {
    let mut events = Vec::new();

    while let Some(event_end) = buffer.find("\n\n") {
        let event_block = buffer[..event_end].to_string();
        *buffer = buffer[event_end + 2..].to_string();

        let mut event_type = String::new();
        let mut data = String::new();

        for line in event_block.lines() {
            if let Some(et) = line.strip_prefix("event: ") {
                event_type = et.to_string();
            } else if let Some(d) = line.strip_prefix("data: ") {
                data = d.to_string();
            }
        }

        if !data.is_empty() {
            events.push((event_type, data));
        }
    }

    events
}

// Anthropic streaming implementation with server-side web search
pub async fn anthropic_chat_stream(
    window: &tauri::Window,
    messages: &[ChatMessage],
    api_key: &Option<String>,
    web_search_enabled: bool,
    model: &Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    base_url: &Option<String>,
) -> Result<(), String> {
    let api_key = api_key.as_ref().ok_or("Anthropic API key is required")?;
    let model = model.as_deref().unwrap_or("claude-sonnet-4-5-20250929");
    let max_tokens = max_tokens.unwrap_or(4096);
    let api_url = format!(
        "{}/v1/messages",
        base_url.as_deref().unwrap_or("https://api.anthropic.com")
    );
    let client = reqwest::Client::new();

    // Extract system message for Anthropic's top-level "system" parameter
    let system_content: Option<String> = messages
        .iter()
        .find(|m| m.role == "system")
        .map(|m| m.content.clone());

    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| {
            serde_json::json!({
                "role": m.role,
                "content": m.content
            })
        })
        .collect();

    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": api_messages,
        "stream": true,
    });

    if let Some(ref system) = system_content {
        body["system"] = serde_json::json!(system);
    }

    if let Some(temp) = temperature {
        body["temperature"] = serde_json::json!(temp);
    }

    // Add web search tool when enabled
    if web_search_enabled {
        body["tools"] = serde_json::json!([{
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": 5
        }]);
    }

    let response = client
        .post(&api_url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic API request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Anthropic API error: {}", error_text));
    }

    // Parse SSE stream
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut citations: Vec<Citation> = Vec::new();

    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                buffer.push_str(&text);

                let events = parse_sse_events(&mut buffer);

                for (_event_type, data) in events {
                    let json: serde_json::Value = match serde_json::from_str(&data) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    let event_type_str = json["type"].as_str().unwrap_or("");

                    match event_type_str {
                        "content_block_start" => {
                            let block = &json["content_block"];
                            let block_type = block["type"].as_str().unwrap_or("");

                            match block_type {
                                "server_tool_use" => {
                                    let tool_name = block["name"].as_str().unwrap_or("web_search");
                                    window
                                        .emit("ai-tool-use", serde_json::json!({
                                            "tool": tool_name,
                                            "status": "start"
                                        }))
                                        .map_err(|e| format!("Failed to emit tool event: {}", e))?;
                                }
                                "web_search_tool_result" => {
                                    // Extract citations from search results
                                    if let Some(content) = block["content"].as_array() {
                                        for result in content {
                                            if result["type"] == "web_search_result" {
                                                let url = result["url"].as_str().unwrap_or("").to_string();
                                                let title = result["title"].as_str().unwrap_or("").to_string();
                                                if !url.is_empty() {
                                                    citations.push(Citation {
                                                        url,
                                                        title,
                                                        cited_text: String::new(),
                                                    });
                                                }
                                            }
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }

                        "content_block_delta" => {
                            let delta = &json["delta"];
                            let delta_type = delta["type"].as_str().unwrap_or("");

                            if delta_type == "text_delta" {
                                if let Some(text) = delta["text"].as_str() {
                                    window
                                        .emit("ai-stream-chunk", text)
                                        .map_err(|e| format!("Failed to emit chunk: {}", e))?;
                                }

                                // Extract inline citations if present
                                if let Some(cites) = delta["citations"].as_array() {
                                    for cite in cites {
                                        let url = cite["url"].as_str().unwrap_or("").to_string();
                                        let title = cite["title"].as_str().unwrap_or("").to_string();
                                        let cited_text = cite["cited_text"].as_str().unwrap_or("").to_string();
                                        if !url.is_empty() {
                                            // Deduplicate by URL
                                            if !citations.iter().any(|c| c.url == url) {
                                                citations.push(Citation { url, title, cited_text });
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        "message_delta" => {
                            // Check for pause_turn stop reason
                            if let Some(stop_reason) = json["delta"]["stop_reason"].as_str() {
                                if stop_reason == "pause_turn" {
                                    eprintln!("[notesage] Anthropic returned pause_turn — response may be incomplete");
                                }
                            }
                        }

                        "error" => {
                            let error_msg = json["error"]["message"]
                                .as_str()
                                .unwrap_or("Unknown streaming error");
                            return Err(format!("Anthropic stream error: {}", error_msg));
                        }

                        _ => {}
                    }
                }
            }
            Err(e) => {
                return Err(format!("Stream error: {}", e));
            }
        }
    }

    // Emit collected citations
    if !citations.is_empty() {
        // Deduplicate by URL one final time
        let mut seen = std::collections::HashSet::new();
        let unique_citations: Vec<&Citation> = citations
            .iter()
            .filter(|c| seen.insert(c.url.clone()))
            .collect();

        for citation in unique_citations {
            window
                .emit("ai-citation", citation)
                .map_err(|e| format!("Failed to emit citation: {}", e))?;
        }
    }

    window
        .emit("ai-stream-done", ())
        .map_err(|e| format!("Failed to emit done event: {}", e))?;

    Ok(())
}

// OpenAI Responses API streaming implementation
pub async fn openai_chat_stream(
    window: &tauri::Window,
    messages: &[ChatMessage],
    api_key: &Option<String>,
    web_search_enabled: bool,
    model: &Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    base_url: &Option<String>,
) -> Result<(), String> {
    let api_key = api_key.as_ref().ok_or("OpenAI API key is required")?;
    let model = model.as_deref().unwrap_or("gpt-4o");
    let api_url = format!(
        "{}/v1/responses",
        base_url.as_deref().unwrap_or("https://api.openai.com")
    );

    let client = reqwest::Client::new();

    // Extract system message as top-level `instructions` (Responses API pattern)
    let instructions: Option<String> = messages
        .iter()
        .find(|m| m.role == "system")
        .map(|m| m.content.clone());

    // Build input array — Responses API uses { type: "message", role, content } items
    let input: Vec<serde_json::Value> = messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| {
            if m.role == "assistant" {
                serde_json::json!({
                    "type": "message",
                    "role": "assistant",
                    "content": [{
                        "type": "output_text",
                        "text": m.content
                    }]
                })
            } else {
                serde_json::json!({
                    "type": "message",
                    "role": "user",
                    "content": m.content
                })
            }
        })
        .collect();

    let mut body = serde_json::json!({
        "model": model,
        "input": input,
        "stream": true,
        "store": false,
    });

    if let Some(ref inst) = instructions {
        body["instructions"] = serde_json::json!(inst);
    }

    if let Some(temp) = temperature {
        body["temperature"] = serde_json::json!(temp);
    }
    if let Some(max) = max_tokens {
        body["max_output_tokens"] = serde_json::json!(max);
    }

    if web_search_enabled {
        body["tools"] = serde_json::json!([{
            "type": "web_search_preview",
            "search_context_size": "medium"
        }]);
    }

    let response = client
        .post(&api_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI API request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error: {}", error_text));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut citations: Vec<Citation> = Vec::new();

    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                buffer.push_str(&text);

                let events = parse_sse_events(&mut buffer);

                for (event_type, data) in events {
                    let json: serde_json::Value = match serde_json::from_str(&data) {
                        Ok(v) => v,
                        Err(_) => continue,
                    };

                    match event_type.as_str() {
                        "response.output_text.delta" => {
                            if let Some(delta) = json["delta"].as_str() {
                                window
                                    .emit("ai-stream-chunk", delta)
                                    .map_err(|e| format!("Failed to emit chunk: {}", e))?;
                            }
                        }

                        "response.web_search_call.in_progress" | "response.web_search_call.searching" => {
                            window
                                .emit("ai-tool-use", serde_json::json!({
                                    "tool": "web_search",
                                    "status": "start"
                                }))
                                .map_err(|e| format!("Failed to emit tool event: {}", e))?;
                        }

                        "response.output_text.annotation.added" => {
                            let annotation = &json["annotation"];
                            if annotation["type"].as_str() == Some("url_citation") {
                                let url = annotation["url"].as_str().unwrap_or("").to_string();
                                let title = annotation["title"].as_str().unwrap_or("").to_string();
                                if !url.is_empty() && !citations.iter().any(|c| c.url == url) {
                                    citations.push(Citation {
                                        url,
                                        title,
                                        cited_text: String::new(),
                                    });
                                }
                            }
                        }

                        "response.completed" => {
                            // Stream done — break out
                        }

                        "response.failed" => {
                            let error_msg = json["response"]["error"]["message"]
                                .as_str()
                                .unwrap_or("Unknown OpenAI streaming error");
                            return Err(format!("OpenAI stream error: {}", error_msg));
                        }

                        _ => {}
                    }
                }
            }
            Err(e) => {
                return Err(format!("Stream error: {}", e));
            }
        }
    }

    // Emit collected citations
    if !citations.is_empty() {
        for citation in &citations {
            window
                .emit("ai-citation", citation)
                .map_err(|e| format!("Failed to emit citation: {}", e))?;
        }
    }

    window
        .emit("ai-stream-done", ())
        .map_err(|e| format!("Failed to emit done event: {}", e))?;

    Ok(())
}

// Ollama streaming implementation
pub async fn ollama_chat_stream(
    window: &tauri::Window,
    messages: &[ChatMessage],
    ollama_url: &Option<String>,
    model: &Option<String>,
    temperature: Option<f64>,
    _max_tokens: Option<u32>,
    base_url: &Option<String>,
) -> Result<(), String> {
    let base = base_url.as_deref()
        .or(ollama_url.as_deref())
        .unwrap_or("http://localhost:11434");
    let model = model.as_deref().unwrap_or("llama3.2");

    // Ollama may need to load the model into memory on first request — use a generous timeout
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            serde_json::json!({
                "role": m.role,
                "content": m.content
            })
        })
        .collect();

    // Query model capabilities before streaming to determine thinking support.
    // This avoids hardcoding model-specific tag patterns.
    let (has_native_thinking, thinking_tags) =
        detect_thinking_support(&client, base, model).await;

    let mut body = serde_json::json!({
        "model": model,
        "messages": api_messages,
        "stream": true
    });

    // Only send think:true when the model natively supports it
    if has_native_thinking {
        body["think"] = serde_json::json!(true);
    }

    if let Some(temp) = temperature {
        body["options"] = serde_json::json!({ "temperature": temp });
    }

    // State for tag-based thinking parsing (only used when thinking_tags is Some)
    let mut in_think_tag = false;
    let mut tag_scan_buf = String::new();

    let response = {
        let resp = client
            .post(format!("{}/api/chat", base))
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Ollama API request failed: {}", e))?;

        if !resp.status().is_success() {
            let error_text = resp.text().await.unwrap_or_default();
            return Err(format!("Ollama API error: {}", error_text));
        }
        resp
    };

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                buffer.push_str(&text);

                // Ollama sends one JSON object per line
                while let Some(line_end) = buffer.find('\n') {
                    let line = buffer[..line_end].to_string();
                    buffer = buffer[line_end + 1..].to_string();

                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                        // Native thinking field (produced when think:true is set and model supports it)
                        if has_native_thinking {
                            if let Some(thinking) = json["message"]["thinking"].as_str() {
                                if !thinking.is_empty() {
                                    window
                                        .emit("ai-stream-thinking-chunk", thinking)
                                        .map_err(|e| format!("Failed to emit thinking event: {}", e))?;
                                }
                            }
                        }

                        if let Some(content) = json["message"]["content"].as_str() {
                            if !content.is_empty() {
                                if has_native_thinking || thinking_tags.is_none() {
                                    // Native thinking handled above, or no thinking tags detected —
                                    // emit content as-is
                                    window
                                        .emit("ai-stream-chunk", content)
                                        .map_err(|e| format!("Failed to emit event: {}", e))?;
                                } else {
                                    // Tag-based thinking: parse using the detected opening/closing tags
                                    let tags = thinking_tags.as_ref().unwrap();
                                    tag_scan_buf.push_str(content);
                                    while !tag_scan_buf.is_empty() {
                                        if in_think_tag {
                                            if let Some(end) = tag_scan_buf.find(&tags.closing) {
                                                let thinking_text = &tag_scan_buf[..end];
                                                if !thinking_text.is_empty() {
                                                    window
                                                        .emit("ai-stream-thinking-chunk", thinking_text)
                                                        .map_err(|e| format!("Failed to emit thinking event: {}", e))?;
                                                }
                                                tag_scan_buf = tag_scan_buf[end + tags.closing.len()..].to_string();
                                                in_think_tag = false;
                                            } else {
                                                // Might have a partial closing tag at the end
                                                let hold = tags.closing.len() - 1;
                                                let safe = if tag_scan_buf.len() > hold { tag_scan_buf.len() - hold } else { 0 };
                                                if safe > 0 {
                                                    let to_emit = &tag_scan_buf[..safe];
                                                    if !to_emit.is_empty() {
                                                        window
                                                            .emit("ai-stream-thinking-chunk", to_emit)
                                                            .map_err(|e| format!("Failed to emit thinking event: {}", e))?;
                                                    }
                                                    tag_scan_buf = tag_scan_buf[safe..].to_string();
                                                }
                                                break; // Wait for more data
                                            }
                                        } else if let Some(start) = tag_scan_buf.find(&tags.opening) {
                                            let before = &tag_scan_buf[..start];
                                            if !before.is_empty() {
                                                window
                                                    .emit("ai-stream-chunk", before)
                                                    .map_err(|e| format!("Failed to emit event: {}", e))?;
                                            }
                                            tag_scan_buf = tag_scan_buf[start + tags.opening.len()..].to_string();
                                            in_think_tag = true;
                                        } else {
                                            // Might have a partial opening tag at the end
                                            let hold = tags.opening.len() - 1;
                                            let safe = if tag_scan_buf.len() > hold { tag_scan_buf.len() - hold } else { 0 };
                                            if safe > 0 {
                                                let to_emit = &tag_scan_buf[..safe];
                                                if !to_emit.is_empty() {
                                                    window
                                                        .emit("ai-stream-chunk", to_emit)
                                                        .map_err(|e| format!("Failed to emit event: {}", e))?;
                                                }
                                                tag_scan_buf = tag_scan_buf[safe..].to_string();
                                            }
                                            break; // Wait for more data
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                return Err(format!("Stream error: {}", e));
            }
        }
    }

    // Flush any remaining content from the tag scan buffer
    if !tag_scan_buf.is_empty() {
        if in_think_tag {
            window
                .emit("ai-stream-thinking-chunk", &tag_scan_buf)
                .map_err(|e| format!("Failed to emit thinking event: {}", e))?;
        } else {
            window
                .emit("ai-stream-chunk", &tag_scan_buf)
                .map_err(|e| format!("Failed to emit event: {}", e))?;
        }
    }

    window
        .emit("ai-stream-done", ())
        .map_err(|e| format!("Failed to emit done event: {}", e))?;

    Ok(())
}

// OpenAI-Compatible streaming implementation (standard Chat Completions SSE format)
pub async fn openai_compatible_chat_stream(
    window: &tauri::Window,
    messages: &[ChatMessage],
    api_key: &Option<String>,
    model: &Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    base_url: &Option<String>,
) -> Result<(), String> {
    let api_key = api_key.as_ref().ok_or("API key is required")?;
    let base_url = base_url.as_ref().ok_or("Base URL is required for OpenAI-Compatible provider")?;
    let model = model.as_deref().ok_or("Model is required for OpenAI-Compatible provider")?;

    let client = reqwest::Client::new();

    let api_messages: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            serde_json::json!({
                "role": m.role,
                "content": m.content
            })
        })
        .collect();

    let mut body = serde_json::json!({
        "model": model,
        "messages": api_messages,
        "stream": true
    });

    if let Some(temp) = temperature {
        body["temperature"] = serde_json::json!(temp);
    }
    if let Some(max) = max_tokens {
        body["max_tokens"] = serde_json::json!(max);
    }

    // Normalize base_url: strip trailing /v1 or /v1/ to prevent double /v1/v1/...
    let normalized_base = base_url
        .trim_end_matches('/')
        .trim_end_matches("/v1");

    let response = client
        .post(format!("{}/v1/chat/completions", normalized_base))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("API error: {}", error_text));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                buffer.push_str(&text);

                // SSE format: "data: {...}\n\n" or "data: [DONE]\n\n"
                while let Some(line_end) = buffer.find('\n') {
                    let line = buffer[..line_end].to_string();
                    buffer = buffer[line_end + 1..].to_string();

                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }

                    if let Some(data) = line.strip_prefix("data: ") {
                        if data == "[DONE]" {
                            break;
                        }

                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                            if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                                if !content.is_empty() {
                                    window
                                        .emit("ai-stream-chunk", content)
                                        .map_err(|e| format!("Failed to emit chunk: {}", e))?;
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                return Err(format!("Stream error: {}", e));
            }
        }
    }

    window
        .emit("ai-stream-done", ())
        .map_err(|e| format!("Failed to emit done event: {}", e))?;

    Ok(())
}
