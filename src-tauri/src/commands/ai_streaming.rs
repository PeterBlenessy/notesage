use serde::{Deserialize, Serialize};
use serde_json;
use tauri::Emitter;
use futures::StreamExt;
use super::ChatMessage;
use super::ai::ToolDefinition;
use super::constants;

/// Convert tool definitions to Anthropic's native format (name, description, input_schema).
fn tools_to_anthropic_format(tools: &[ToolDefinition]) -> Vec<serde_json::Value> {
    tools.iter().map(|t| {
        serde_json::json!({
            "name": t.name,
            "description": t.description,
            "input_schema": t.input_schema
        })
    }).collect()
}

/// Convert tool definitions to OpenAI function-calling format
/// (used by OpenAI, Ollama, OpenAI-compatible, and local bundled providers).
pub fn tools_to_openai_format(tools: &[ToolDefinition]) -> Vec<serde_json::Value> {
    tools.iter().map(|t| {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": t.input_schema
            }
        })
    }).collect()
}

/// Citation data emitted to the frontend via the `ai-citation` event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Citation {
    pub url: String,
    pub title: String,
    pub cited_text: String,
}

/// Generate a simple UUID v4-like string for tool call IDs when the provider
/// doesn't supply one (e.g., Ollama). Not cryptographically secure — just unique enough.
fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:032x}", t)
}

/// Accumulator for OpenAI Responses API function call arguments streamed incrementally.
#[derive(Debug, Clone)]
struct OpenAIToolCallAccumulator {
    call_id: String,
    name: String,
    arguments: String,
}

/// Accumulator for OpenAI Chat Completions API tool calls streamed incrementally.
/// Used by Ollama and OpenAI-compatible providers which use the standard chat completions format.
#[derive(Debug, Clone)]
struct ChatCompletionsToolCallAccumulator {
    id: String,
    name: String,
    arguments: String,
}

/// Thinking tag pair inferred from a model's capabilities or template.
#[derive(Debug, Clone)]
struct ThinkingTags {
    opening: String,
    closing: String,
}

/// Result of querying a model's thinking capabilities.
#[derive(Debug)]
struct ThinkingSupport {
    /// Whether the model natively supports Ollama's `think: true` parameter.
    has_native: bool,
    /// Tags to parse from the content stream (when native thinking is not available).
    tags: Option<ThinkingTags>,
}

/// Query the Ollama `/api/show` endpoint for a model and return its thinking support.
///
/// Ollama detects thinking capability from the model template. When a model
/// doesn't support native `think: true`, it may still emit thinking tags like
/// `<think>...</think>` in its content. We detect these by inspecting the
/// model template for common patterns rather than hardcoding model-specific tags.
async fn detect_thinking_support(
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
    tools: &Option<Vec<ToolDefinition>>,
    model: &Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    base_url: &Option<String>,
) -> Result<(), String> {
    let api_key = api_key.as_ref().ok_or("Anthropic API key is required")?;
    let model = model.as_deref().unwrap_or(constants::DEFAULT_MODEL_ANTHROPIC);
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

    // Build tools array: merge web search tool (if enabled) with skill tools (if provided)
    {
        let mut all_tools: Vec<serde_json::Value> = Vec::new();
        if web_search_enabled {
            all_tools.push(serde_json::json!({
                "type": constants::ANTHROPIC_WEB_SEARCH_TOOL,
                "name": "web_search",
                "max_uses": constants::ANTHROPIC_WEB_SEARCH_MAX_USES
            }));
        }
        if let Some(ref tool_defs) = tools {
            all_tools.extend(tools_to_anthropic_format(tool_defs));
        }
        if !all_tools.is_empty() {
            body["tools"] = serde_json::Value::Array(all_tools);
        }
    }

    let response = client
        .post(&api_url)
        .header("x-api-key", api_key)
        .header("anthropic-version", constants::ANTHROPIC_API_VERSION)
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

    // Tool call accumulation state
    let mut current_tool_id = String::new();
    let mut current_tool_name = String::new();
    let mut current_tool_input = String::new();
    let mut in_tool_use_block = false;
    let mut stop_reason = String::new();

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
                                "tool_use" => {
                                    current_tool_id = block["id"].as_str().unwrap_or("").to_string();
                                    current_tool_name = block["name"].as_str().unwrap_or("").to_string();
                                    current_tool_input.clear();
                                    in_tool_use_block = true;
                                }
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
                            } else if delta_type == "input_json_delta" {
                                // Accumulate tool call arguments (streamed as partial JSON)
                                if let Some(partial) = delta["partial_json"].as_str() {
                                    current_tool_input.push_str(partial);
                                }
                            }
                        }

                        "content_block_stop" => {
                            if in_tool_use_block {
                                let arguments: serde_json::Value = serde_json::from_str(&current_tool_input)
                                    .unwrap_or(serde_json::Value::Null);
                                window
                                    .emit("ai-tool-call", serde_json::json!({
                                        "id": current_tool_id,
                                        "name": current_tool_name,
                                        "arguments": arguments
                                    }))
                                    .map_err(|e| format!("Failed to emit tool call: {}", e))?;
                                in_tool_use_block = false;
                                current_tool_input.clear();
                            }
                        }

                        "message_delta" => {
                            if let Some(reason) = json["delta"]["stop_reason"].as_str() {
                                stop_reason = reason.to_string();
                                if reason == "pause_turn" {
                                    log::warn!(target: "notesage::ai", "Anthropic returned pause_turn — response may be incomplete");
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

    // If the model stopped because it wants tool results, signal the frontend
    // to execute tools and continue. Do NOT emit ai-stream-done in this case.
    if stop_reason == "tool_use" {
        window
            .emit("ai-tool-calls-done", ())
            .map_err(|e| format!("Failed to emit tool calls done: {}", e))?;
    } else {
        window
            .emit("ai-stream-done", ())
            .map_err(|e| format!("Failed to emit done event: {}", e))?;
    }

    Ok(())
}

// OpenAI Responses API streaming implementation
pub async fn openai_chat_stream(
    window: &tauri::Window,
    messages: &[ChatMessage],
    api_key: &Option<String>,
    web_search_enabled: bool,
    tools: &Option<Vec<ToolDefinition>>,
    model: &Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    base_url: &Option<String>,
) -> Result<(), String> {
    let api_key = api_key.as_ref().ok_or("OpenAI API key is required")?;
    let model = model.as_deref().unwrap_or(constants::DEFAULT_MODEL_OPENAI);
    let api_url = format!(
        "{}/v1/responses",
        super::ai::normalize_base_url(base_url.as_deref().unwrap_or("https://api.openai.com"))
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

    {
        let mut all_tools: Vec<serde_json::Value> = Vec::new();
        if web_search_enabled {
            all_tools.push(serde_json::json!({
                "type": constants::OPENAI_WEB_SEARCH_TOOL,
                "search_context_size": "medium"
            }));
        }
        if let Some(ref tool_defs) = tools {
            all_tools.extend(tools_to_openai_format(tool_defs));
        }
        if !all_tools.is_empty() {
            body["tools"] = serde_json::Value::Array(all_tools);
        }
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

    // Tool call accumulation state for OpenAI Responses API
    // Each function_call output item has: call_id, name, arguments (streamed)
    let mut openai_tool_calls: Vec<OpenAIToolCallAccumulator> = Vec::new();
    let mut has_tool_calls = false;

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

                        "response.output_item.added" => {
                            // A new output item was added — check if it's a function_call
                            let item = &json["item"];
                            if item["type"].as_str() == Some("function_call") {
                                let call_id = item["call_id"].as_str().unwrap_or("").to_string();
                                let name = item["name"].as_str().unwrap_or("").to_string();
                                openai_tool_calls.push(OpenAIToolCallAccumulator {
                                    call_id,
                                    name,
                                    arguments: String::new(),
                                });
                                has_tool_calls = true;
                            }
                        }

                        "response.function_call_arguments.delta" => {
                            // Accumulate partial arguments for the current function call
                            if let Some(delta) = json["delta"].as_str() {
                                if let Some(last) = openai_tool_calls.last_mut() {
                                    last.arguments.push_str(delta);
                                }
                            }
                        }

                        "response.function_call_arguments.done" => {
                            // Function call arguments are complete — emit the tool call event
                            if let Some(tool_call) = openai_tool_calls.last() {
                                let arguments: serde_json::Value = serde_json::from_str(&tool_call.arguments)
                                    .unwrap_or(serde_json::Value::Null);
                                window
                                    .emit("ai-tool-call", serde_json::json!({
                                        "id": tool_call.call_id,
                                        "name": tool_call.name,
                                        "arguments": arguments
                                    }))
                                    .map_err(|e| format!("Failed to emit tool call: {}", e))?;
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
                            // Check if the response ended due to tool use
                            let status = json["response"]["status"].as_str().unwrap_or("");
                            if status == "requires_action" || has_tool_calls {
                                // Model wants tool results — will be signaled after the loop
                            }
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

    // If tool calls were made, signal the frontend to execute them and continue.
    // Do NOT emit ai-stream-done in this case.
    if has_tool_calls {
        window
            .emit("ai-tool-calls-done", ())
            .map_err(|e| format!("Failed to emit tool calls done: {}", e))?;
    } else {
        window
            .emit("ai-stream-done", ())
            .map_err(|e| format!("Failed to emit done event: {}", e))?;
    }

    Ok(())
}

// Ollama streaming implementation
pub async fn ollama_chat_stream(
    window: &tauri::Window,
    messages: &[ChatMessage],
    ollama_url: &Option<String>,
    tools: &Option<Vec<ToolDefinition>>,
    model: &Option<String>,
    temperature: Option<f64>,
    _max_tokens: Option<u32>,
    base_url: &Option<String>,
) -> Result<(), String> {
    let base = base_url.as_deref()
        .or(ollama_url.as_deref())
        .unwrap_or("http://localhost:11434");
    let model = super::ai::resolve_ollama_model(base, model.as_deref()).await;

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
    let thinking = detect_thinking_support(&client, base, &model).await;
    let has_native_thinking = thinking.has_native;
    let thinking_tags = thinking.tags;

    let mut body = serde_json::json!({
        "model": model,
        "messages": api_messages,
        "stream": true
    });

    // Only send think:true when the model natively supports it
    if has_native_thinking {
        body["think"] = serde_json::json!(true);
    }

    // Add tools in OpenAI function-calling format
    if let Some(ref tool_defs) = tools {
        if !tool_defs.is_empty() {
            body["tools"] = serde_json::Value::Array(tools_to_openai_format(tool_defs));
        }
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
    let mut has_tool_calls = false;

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

                        // Check for tool calls in Ollama's response format.
                        // Tool calls appear in the `message.tool_calls` array, typically
                        // in the final chunk (when `done: true`).
                        if let Some(tool_calls) = json["message"]["tool_calls"].as_array() {
                            for tool_call in tool_calls {
                                let function = &tool_call["function"];
                                let name = function["name"].as_str().unwrap_or("").to_string();
                                let arguments = &function["arguments"];
                                if !name.is_empty() {
                                    has_tool_calls = true;
                                    window
                                        .emit("ai-tool-call", serde_json::json!({
                                            "id": format!("ollama-{}", uuid_v4()),
                                            "name": name,
                                            "arguments": arguments
                                        }))
                                        .map_err(|e| format!("Failed to emit tool call: {}", e))?;
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

    // If tool calls were detected, signal the frontend to execute them.
    if has_tool_calls {
        window
            .emit("ai-tool-calls-done", ())
            .map_err(|e| format!("Failed to emit tool calls done: {}", e))?;
    } else {
        window
            .emit("ai-stream-done", ())
            .map_err(|e| format!("Failed to emit done event: {}", e))?;
    }

    Ok(())
}

// OpenAI-Compatible streaming implementation (standard Chat Completions SSE format)
pub async fn openai_compatible_chat_stream(
    window: &tauri::Window,
    messages: &[ChatMessage],
    api_key: &Option<String>,
    tools: &Option<Vec<ToolDefinition>>,
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

    // Add tools in OpenAI function-calling format
    if let Some(ref tool_defs) = tools {
        if !tool_defs.is_empty() {
            body["tools"] = serde_json::Value::Array(tools_to_openai_format(tool_defs));
        }
    }

    let response = client
        .post(format!("{}/v1/chat/completions", super::ai::normalize_base_url(base_url)))
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

    // Tool call accumulation state for Chat Completions format.
    // Tool calls arrive incrementally across multiple SSE chunks:
    //   delta.tool_calls[i].id, delta.tool_calls[i].function.name (first chunk)
    //   delta.tool_calls[i].function.arguments (subsequent chunks, accumulated)
    let mut tool_calls: Vec<ChatCompletionsToolCallAccumulator> = Vec::new();
    let mut finish_reason = String::new();

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
                            let choice = &json["choices"][0];

                            // Track finish reason
                            if let Some(reason) = choice["finish_reason"].as_str() {
                                finish_reason = reason.to_string();
                            }

                            // Handle text content
                            if let Some(content) = choice["delta"]["content"].as_str() {
                                if !content.is_empty() {
                                    window
                                        .emit("ai-stream-chunk", content)
                                        .map_err(|e| format!("Failed to emit chunk: {}", e))?;
                                }
                            }

                            // Handle tool calls streamed incrementally
                            if let Some(tc_array) = choice["delta"]["tool_calls"].as_array() {
                                for tc in tc_array {
                                    let index = tc["index"].as_u64().unwrap_or(0) as usize;

                                    // Grow the accumulator vec to fit this index
                                    while tool_calls.len() <= index {
                                        tool_calls.push(ChatCompletionsToolCallAccumulator {
                                            id: String::new(),
                                            name: String::new(),
                                            arguments: String::new(),
                                        });
                                    }

                                    // First chunk for this tool call carries id and function name
                                    if let Some(id) = tc["id"].as_str() {
                                        tool_calls[index].id = id.to_string();
                                    }
                                    if let Some(name) = tc["function"]["name"].as_str() {
                                        tool_calls[index].name = name.to_string();
                                    }
                                    // Arguments are accumulated across chunks
                                    if let Some(args) = tc["function"]["arguments"].as_str() {
                                        tool_calls[index].arguments.push_str(args);
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

    // Emit any accumulated tool calls
    let has_tool_calls = !tool_calls.is_empty() && tool_calls.iter().any(|tc| !tc.name.is_empty());
    if has_tool_calls {
        for tc in &tool_calls {
            if tc.name.is_empty() {
                continue;
            }
            let arguments: serde_json::Value = serde_json::from_str(&tc.arguments)
                .unwrap_or(serde_json::Value::Null);
            window
                .emit("ai-tool-call", serde_json::json!({
                    "id": if tc.id.is_empty() { format!("compat-{}", uuid_v4()) } else { tc.id.clone() },
                    "name": tc.name,
                    "arguments": arguments
                }))
                .map_err(|e| format!("Failed to emit tool call: {}", e))?;
        }
    }

    // If tool calls are present (finish_reason "tool_calls" or accumulated calls),
    // signal the frontend to execute them instead of emitting stream-done.
    if has_tool_calls || finish_reason == "tool_calls" {
        window
            .emit("ai-tool-calls-done", ())
            .map_err(|e| format!("Failed to emit tool calls done: {}", e))?;
    } else {
        window
            .emit("ai-stream-done", ())
            .map_err(|e| format!("Failed to emit done event: {}", e))?;
    }

    Ok(())
}

/// Extract tool calls from an Anthropic `content_block_start` event with type `tool_use`.
/// Returns `(id, name)` if this is a tool use block start.
#[allow(dead_code)]
pub(crate) fn parse_anthropic_tool_use_block_start(json: &serde_json::Value) -> Option<(String, String)> {
    let block = &json["content_block"];
    if block["type"].as_str() != Some("tool_use") {
        return None;
    }
    let id = block["id"].as_str().unwrap_or("").to_string();
    let name = block["name"].as_str().unwrap_or("").to_string();
    Some((id, name))
}

/// Extract partial JSON from an Anthropic `content_block_delta` with type `input_json_delta`.
#[allow(dead_code)]
pub(crate) fn parse_anthropic_input_json_delta(json: &serde_json::Value) -> Option<String> {
    let delta = &json["delta"];
    if delta["type"].as_str() != Some("input_json_delta") {
        return None;
    }
    delta["partial_json"].as_str().map(|s| s.to_string())
}

/// Extract tool calls from an Ollama streaming JSON line.
/// Returns a vec of `(name, arguments_value)` pairs.
#[allow(dead_code)]
pub(crate) fn parse_ollama_tool_calls(json: &serde_json::Value) -> Vec<(String, serde_json::Value)> {
    let mut results = Vec::new();
    if let Some(tool_calls) = json["message"]["tool_calls"].as_array() {
        for tool_call in tool_calls {
            let function = &tool_call["function"];
            let name = function["name"].as_str().unwrap_or("").to_string();
            let arguments = function["arguments"].clone();
            if !name.is_empty() {
                results.push((name, arguments));
            }
        }
    }
    results
}

/// Parse an OpenAI Chat Completions SSE chunk for incremental tool call data.
/// Returns a vec of `(index, id_opt, name_opt, args_opt)` tuples.
#[allow(dead_code)]
pub(crate) fn parse_chat_completions_tool_call_delta(
    json: &serde_json::Value,
) -> Vec<(usize, Option<String>, Option<String>, Option<String>)> {
    let mut results = Vec::new();
    if let Some(tc_array) = json["choices"][0]["delta"]["tool_calls"].as_array() {
        for tc in tc_array {
            let index = tc["index"].as_u64().unwrap_or(0) as usize;
            let id = tc["id"].as_str().map(|s| s.to_string());
            let name = tc["function"]["name"].as_str().map(|s| s.to_string());
            let args = tc["function"]["arguments"].as_str().map(|s| s.to_string());
            results.push((index, id, name, args));
        }
    }
    results
}

/// Parse an OpenAI Responses API `response.output_item.added` event for function_call items.
/// Returns `Some((call_id, name))` if this is a function_call item.
#[allow(dead_code)]
pub(crate) fn parse_openai_responses_function_call_item(json: &serde_json::Value) -> Option<(String, String)> {
    let item = &json["item"];
    if item["type"].as_str() != Some("function_call") {
        return None;
    }
    let call_id = item["call_id"].as_str().unwrap_or("").to_string();
    let name = item["name"].as_str().unwrap_or("").to_string();
    Some((call_id, name))
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Anthropic tool call parsing tests ---

    #[test]
    fn test_anthropic_tool_use_block_start() {
        let json = serde_json::json!({
            "type": "content_block_start",
            "index": 1,
            "content_block": {
                "type": "tool_use",
                "id": "toolu_01abc123",
                "name": "get_weather",
                "input": {}
            }
        });
        let result = parse_anthropic_tool_use_block_start(&json);
        assert_eq!(result, Some(("toolu_01abc123".to_string(), "get_weather".to_string())));
    }

    #[test]
    fn test_anthropic_tool_use_block_start_text_block() {
        let json = serde_json::json!({
            "type": "content_block_start",
            "index": 0,
            "content_block": {
                "type": "text",
                "text": ""
            }
        });
        assert_eq!(parse_anthropic_tool_use_block_start(&json), None);
    }

    #[test]
    fn test_anthropic_input_json_delta() {
        let json = serde_json::json!({
            "type": "content_block_delta",
            "index": 1,
            "delta": {
                "type": "input_json_delta",
                "partial_json": "{\"location\":"
            }
        });
        let result = parse_anthropic_input_json_delta(&json);
        assert_eq!(result, Some("{\"location\":".to_string()));
    }

    #[test]
    fn test_anthropic_input_json_delta_text_delta() {
        let json = serde_json::json!({
            "type": "content_block_delta",
            "index": 0,
            "delta": {
                "type": "text_delta",
                "text": "hello"
            }
        });
        assert_eq!(parse_anthropic_input_json_delta(&json), None);
    }

    #[test]
    fn test_anthropic_tool_input_accumulation() {
        let chunks = vec![
            "{\"loc",
            "ation\": \"San ",
            "Francisco\"}",
        ];
        let mut accumulated = String::new();
        for chunk in chunks {
            accumulated.push_str(chunk);
        }
        let parsed: serde_json::Value = serde_json::from_str(&accumulated).unwrap();
        assert_eq!(parsed["location"], "San Francisco");
    }

    // --- Ollama tool call parsing tests ---

    #[test]
    fn test_ollama_tool_calls_present() {
        let json = serde_json::json!({
            "model": "llama3.1",
            "message": {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "function": {
                            "name": "get_weather",
                            "arguments": { "city": "Tokyo" }
                        }
                    },
                    {
                        "function": {
                            "name": "get_time",
                            "arguments": { "timezone": "JST" }
                        }
                    }
                ]
            },
            "done": true
        });
        let calls = parse_ollama_tool_calls(&json);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].0, "get_weather");
        assert_eq!(calls[0].1["city"], "Tokyo");
        assert_eq!(calls[1].0, "get_time");
        assert_eq!(calls[1].1["timezone"], "JST");
    }

    #[test]
    fn test_ollama_tool_calls_absent() {
        let json = serde_json::json!({
            "model": "llama3.1",
            "message": {
                "role": "assistant",
                "content": "Hello!"
            },
            "done": false
        });
        let calls = parse_ollama_tool_calls(&json);
        assert!(calls.is_empty());
    }

    #[test]
    fn test_ollama_tool_calls_empty_name_skipped() {
        let json = serde_json::json!({
            "message": {
                "tool_calls": [
                    { "function": { "name": "", "arguments": {} } }
                ]
            }
        });
        let calls = parse_ollama_tool_calls(&json);
        assert!(calls.is_empty());
    }

    // --- OpenAI Chat Completions tool call delta tests ---

    #[test]
    fn test_chat_completions_tool_call_delta_first_chunk() {
        let json = serde_json::json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_abc123",
                        "function": {
                            "name": "search",
                            "arguments": ""
                        }
                    }]
                }
            }]
        });
        let results = parse_chat_completions_tool_call_delta(&json);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0, 0);
        assert_eq!(results[0].1, Some("call_abc123".to_string()));
        assert_eq!(results[0].2, Some("search".to_string()));
        assert_eq!(results[0].3, Some("".to_string()));
    }

    #[test]
    fn test_chat_completions_tool_call_delta_args_chunk() {
        let json = serde_json::json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "function": {
                            "arguments": "{\"query\":"
                        }
                    }]
                }
            }]
        });
        let results = parse_chat_completions_tool_call_delta(&json);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].0, 0);
        assert_eq!(results[0].1, None);
        assert_eq!(results[0].2, None);
        assert_eq!(results[0].3, Some("{\"query\":".to_string()));
    }

    #[test]
    fn test_chat_completions_tool_call_accumulation() {
        let mut tool_calls: Vec<ChatCompletionsToolCallAccumulator> = Vec::new();

        let chunks = vec![
            serde_json::json!({
                "choices": [{ "delta": { "tool_calls": [{
                    "index": 0, "id": "call_1",
                    "function": { "name": "read_file", "arguments": "" }
                }]}}]
            }),
            serde_json::json!({
                "choices": [{ "delta": { "tool_calls": [{
                    "index": 0,
                    "function": { "arguments": "{\"path\":" }
                }]}}]
            }),
            serde_json::json!({
                "choices": [{ "delta": { "tool_calls": [{
                    "index": 0,
                    "function": { "arguments": " \"/tmp/test.txt\"}" }
                }]}}]
            }),
        ];

        for chunk in &chunks {
            let deltas = parse_chat_completions_tool_call_delta(chunk);
            for (index, id, name, args) in deltas {
                while tool_calls.len() <= index {
                    tool_calls.push(ChatCompletionsToolCallAccumulator {
                        id: String::new(),
                        name: String::new(),
                        arguments: String::new(),
                    });
                }
                if let Some(id) = id {
                    tool_calls[index].id = id;
                }
                if let Some(name) = name {
                    tool_calls[index].name = name;
                }
                if let Some(args) = args {
                    tool_calls[index].arguments.push_str(&args);
                }
            }
        }

        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].id, "call_1");
        assert_eq!(tool_calls[0].name, "read_file");
        let parsed: serde_json::Value = serde_json::from_str(&tool_calls[0].arguments).unwrap();
        assert_eq!(parsed["path"], "/tmp/test.txt");
    }

    #[test]
    fn test_chat_completions_no_tool_calls() {
        let json = serde_json::json!({
            "choices": [{
                "delta": {
                    "content": "Hello world"
                }
            }]
        });
        let results = parse_chat_completions_tool_call_delta(&json);
        assert!(results.is_empty());
    }

    // --- OpenAI Responses API tests ---

    #[test]
    fn test_openai_responses_function_call_item() {
        let json = serde_json::json!({
            "type": "response.output_item.added",
            "item": {
                "type": "function_call",
                "call_id": "fc_abc123",
                "name": "calculate"
            }
        });
        let result = parse_openai_responses_function_call_item(&json);
        assert_eq!(result, Some(("fc_abc123".to_string(), "calculate".to_string())));
    }

    #[test]
    fn test_openai_responses_text_item_ignored() {
        let json = serde_json::json!({
            "type": "response.output_item.added",
            "item": {
                "type": "message",
                "role": "assistant"
            }
        });
        assert_eq!(parse_openai_responses_function_call_item(&json), None);
    }

    // --- UUID generation test ---

    #[test]
    fn test_uuid_v4_format() {
        let id = uuid_v4();
        assert_eq!(id.len(), 32);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    // --- SSE parsing tests ---

    #[test]
    fn test_parse_sse_events_tool_use() {
        let mut buffer = "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"search\",\"input\":{}}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"q\\\": \\\"rust\\\"}\"}}\n\n".to_string();
        let events = parse_sse_events(&mut buffer);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].0, "content_block_start");
        assert_eq!(events[1].0, "content_block_delta");

        let start_json: serde_json::Value = serde_json::from_str(&events[0].1).unwrap();
        assert_eq!(start_json["content_block"]["type"], "tool_use");
        assert_eq!(start_json["content_block"]["name"], "search");

        let delta_json: serde_json::Value = serde_json::from_str(&events[1].1).unwrap();
        assert_eq!(delta_json["delta"]["type"], "input_json_delta");
    }

    // --- Anthropic stop_reason tracking ---

    #[test]
    fn test_anthropic_message_delta_tool_use_stop() {
        let json = serde_json::json!({
            "type": "message_delta",
            "delta": {
                "stop_reason": "tool_use",
                "stop_sequence": null
            },
            "usage": { "output_tokens": 42 }
        });
        let stop_reason = json["delta"]["stop_reason"].as_str().unwrap_or("");
        assert_eq!(stop_reason, "tool_use");
    }

    #[test]
    fn test_anthropic_message_delta_end_turn_stop() {
        let json = serde_json::json!({
            "type": "message_delta",
            "delta": {
                "stop_reason": "end_turn",
                "stop_sequence": null
            }
        });
        let stop_reason = json["delta"]["stop_reason"].as_str().unwrap_or("");
        assert_eq!(stop_reason, "end_turn");
    }

    // --- Multiple tool calls in one response ---

    #[test]
    fn test_chat_completions_multiple_tool_calls() {
        let json = serde_json::json!({
            "choices": [{
                "delta": {
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": "call_1",
                            "function": { "name": "search", "arguments": "{\"q\": \"rust\"}" }
                        },
                        {
                            "index": 1,
                            "id": "call_2",
                            "function": { "name": "read_file", "arguments": "{\"path\": \"/tmp\"}" }
                        }
                    ]
                }
            }]
        });
        let results = parse_chat_completions_tool_call_delta(&json);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].0, 0);
        assert_eq!(results[0].2, Some("search".to_string()));
        assert_eq!(results[1].0, 1);
        assert_eq!(results[1].2, Some("read_file".to_string()));
    }

    // --- SSE parsing edge cases ---

    #[test]
    fn test_parse_sse_events_incomplete_buffer() {
        let mut buffer = "event: content_block_start\ndata: {\"type\"".to_string();
        let events = parse_sse_events(&mut buffer);
        assert!(events.is_empty(), "no complete event should be returned");
        assert_eq!(buffer, "event: content_block_start\ndata: {\"type\"",
            "incomplete data must remain in the buffer");
    }

    #[test]
    fn test_parse_sse_events_two_complete_plus_trailing_incomplete() {
        let mut buffer = "event: e1\ndata: {\"a\":1}\n\nevent: e2\ndata: {\"b\":2}\n\nevent: e3\ndata: {\"c\"".to_string();
        let events = parse_sse_events(&mut buffer);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].0, "e1");
        assert_eq!(events[0].1, "{\"a\":1}");
        assert_eq!(events[1].0, "e2");
        assert_eq!(events[1].1, "{\"b\":2}");
        assert_eq!(buffer, "event: e3\ndata: {\"c\"",
            "incomplete third event must remain in the buffer");
    }

    #[test]
    fn test_parse_sse_events_done_marker() {
        let mut buffer = "data: [DONE]\n\n".to_string();
        let events = parse_sse_events(&mut buffer);
        // [DONE] is non-empty data, so it should be returned as a raw event
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].1, "[DONE]");
        assert!(buffer.is_empty());
    }

    #[test]
    fn test_parse_sse_events_malformed_json_data() {
        let mut buffer = "event: content_block_delta\ndata: {not valid json!}\n\n".to_string();
        let events = parse_sse_events(&mut buffer);
        // parse_sse_events returns raw strings — JSON parsing happens elsewhere
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "content_block_delta");
        assert_eq!(events[0].1, "{not valid json!}");
        assert!(buffer.is_empty());
    }

    #[test]
    fn test_parse_sse_events_data_prefix_without_space() {
        // SSE spec: "data:" without a trailing space is valid but our parser uses
        // strip_prefix("data: ") which requires the space. Verify this behavior.
        let mut buffer = "data:{\"compact\":true}\n\n".to_string();
        let events = parse_sse_events(&mut buffer);
        // Without the space after "data:", strip_prefix("data: ") won't match,
        // so the line is skipped and no data is collected → empty event (no push).
        assert!(events.is_empty(),
            "data: without space should not match the parser's strip_prefix");
        assert!(buffer.is_empty(), "the event block is still consumed from the buffer");
    }

    // --- Empty / edge-case tool call arguments ---

    #[test]
    fn test_anthropic_input_json_delta_empty_partial_json() {
        let json = serde_json::json!({
            "type": "content_block_delta",
            "index": 1,
            "delta": {
                "type": "input_json_delta",
                "partial_json": ""
            }
        });
        let result = parse_anthropic_input_json_delta(&json);
        assert_eq!(result, Some("".to_string()),
            "empty partial_json should still return Some with empty string");
    }

    #[test]
    fn test_chat_completions_tool_call_delta_empty_arguments() {
        let json = serde_json::json!({
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_empty",
                        "function": {
                            "name": "no_args_tool",
                            "arguments": ""
                        }
                    }]
                }
            }]
        });
        let results = parse_chat_completions_tool_call_delta(&json);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].1, Some("call_empty".to_string()));
        assert_eq!(results[0].2, Some("no_args_tool".to_string()));
        assert_eq!(results[0].3, Some("".to_string()),
            "empty arguments string should still be returned as Some");
    }

    #[test]
    fn test_parse_sse_events_empty_buffer() {
        let mut buffer = String::new();
        let events = parse_sse_events(&mut buffer);
        assert!(events.is_empty());
        assert!(buffer.is_empty());
    }

    #[test]
    fn test_parse_sse_events_no_event_type() {
        // SSE with only data line, no event: line
        let mut buffer = "data: {\"text\":\"hello\"}\n\n".to_string();
        let events = parse_sse_events(&mut buffer);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "", "event type should be empty string when not specified");
        assert_eq!(events[0].1, "{\"text\":\"hello\"}");
    }
}
