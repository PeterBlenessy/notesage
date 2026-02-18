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
) -> Result<(), String> {
    let api_key = api_key.as_ref().ok_or("Anthropic API key is required")?;
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
        "model": "claude-sonnet-4-5-20250929",
        "max_tokens": 4096,
        "messages": api_messages,
        "stream": true,
    });

    if let Some(ref system) = system_content {
        body["system"] = serde_json::json!(system);
    }

    // Add web search tool when enabled
    if web_search_enabled {
        body["tools"] = serde_json::json!([{
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": 5
        }]);
    }

    // Note: web_search_20250305 does not require a beta header.
    // web_search_20260209 with dynamic filtering would require:
    //   anthropic-beta: code-execution-web-tools-2026-02-09
    // Using the stable version for now.

    let response = client
        .post("https://api.anthropic.com/v1/messages")
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
                                    // The API paused a long-running turn. The text streamed
                                    // so far is already emitted. The user can continue by
                                    // sending a follow-up message.
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
) -> Result<(), String> {
    let api_key = api_key.as_ref().ok_or("OpenAI API key is required")?;

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
        "model": "gpt-4o",
        "input": input,
        "stream": true,
        "store": false,
    });

    if let Some(ref inst) = instructions {
        body["instructions"] = serde_json::json!(inst);
    }

    if web_search_enabled {
        body["tools"] = serde_json::json!([{
            "type": "web_search_preview",
            "search_context_size": "medium"
        }]);
    }

    let response = client
        .post("https://api.openai.com/v1/responses")
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
) -> Result<(), String> {
    let ollama_url = ollama_url.as_deref().unwrap_or("http://localhost:11434");

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

    let response = client
        .post(format!("{}/api/chat", ollama_url))
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": "llama2",
            "messages": api_messages,
            "stream": true
        }))
        .send()
        .await
        .map_err(|e| format!("Ollama API request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Ollama API error: {}", error_text));
    }

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
                        if let Some(content) = json["message"]["content"].as_str() {
                            if !content.is_empty() {
                                window
                                    .emit("ai-stream-chunk", content)
                                    .map_err(|e| format!("Failed to emit event: {}", e))?;
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
