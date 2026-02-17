use serde_json;
use tauri::Emitter;
use futures::StreamExt;
use super::ChatMessage;
use super::tools::{tools_to_anthropic_format, tools_to_openai_format, execute_tool, ToolCall};

// Anthropic streaming implementation with tool support
pub async fn anthropic_chat_stream(
    window: &tauri::Window,
    messages: &[ChatMessage],
    api_key: &Option<String>,
) -> Result<(), String> {
    let api_key = api_key.as_ref().ok_or("Anthropic API key is required")?;
    let client = reqwest::Client::new();

    // Extract system message for Anthropic's top-level "system" parameter
    let system_content: Option<String> = messages
        .iter()
        .find(|m| m.role == "system")
        .map(|m| m.content.clone());

    let mut current_messages: Vec<serde_json::Value> = messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| {
            serde_json::json!({
                "role": m.role,
                "content": m.content
            })
        })
        .collect();

    // Tool execution loop
    loop {
        let mut body = serde_json::json!({
            "model": "claude-sonnet-4-5-20250929",
            "max_tokens": 4096,
            "messages": current_messages,
            "tools": tools_to_anthropic_format(),
        });

        if let Some(ref system) = system_content {
            body["system"] = serde_json::json!(system);
        }

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

        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        // Check for tool use
        let content_blocks = json["content"].as_array().ok_or("Invalid response format")?;

        let mut has_tool_use = false;
        let mut tool_results = Vec::new();
        let mut text_content = String::new();

        for block in content_blocks {
            if block["type"] == "text" {
                if let Some(text) = block["text"].as_str() {
                    text_content.push_str(text);
                }
            } else if block["type"] == "tool_use" {
                has_tool_use = true;

                let tool_name = block["name"].as_str().ok_or("Missing tool name")?;
                let tool_id = block["id"].as_str().ok_or("Missing tool ID")?;
                let tool_input = &block["input"];

                // Emit tool use event
                window
                    .emit("ai-tool-use", serde_json::json!({
                        "tool": tool_name,
                        "status": "start"
                    }))
                    .map_err(|e| format!("Failed to emit tool event: {}", e))?;

                // Execute tool
                let tool_call = ToolCall {
                    id: tool_id.to_string(),
                    name: tool_name.to_string(),
                    arguments: tool_input.clone(),
                };

                let result = execute_tool(&tool_call).await?;

                tool_results.push(serde_json::json!({
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": result
                }));
            }
        }

        // If no tool use, stream the text response and exit
        if !has_tool_use {
            // Stream the text character by character for smooth display
            for ch in text_content.chars() {
                window
                    .emit("ai-stream-chunk", ch.to_string())
                    .map_err(|e| format!("Failed to emit chunk: {}", e))?;

                // Small delay for visual effect
                tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
            }
            break;
        }

        // Add assistant message with tool use and user message with tool results
        current_messages.push(serde_json::json!({
            "role": "assistant",
            "content": content_blocks
        }));

        current_messages.push(serde_json::json!({
            "role": "user",
            "content": tool_results
        }));

        // Continue loop to get final response
    }

    window
        .emit("ai-stream-done", ())
        .map_err(|e| format!("Failed to emit done event: {}", e))?;

    Ok(())
}

// OpenAI streaming implementation
pub async fn openai_chat_stream(
    window: &tauri::Window,
    messages: &[ChatMessage],
    api_key: &Option<String>,
) -> Result<(), String> {
    let api_key = api_key.as_ref().ok_or("OpenAI API key is required")?;

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
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": "gpt-4-turbo-preview",
            "messages": api_messages,
            "max_tokens": 4096,
            "tools": tools_to_openai_format(),
            "stream": true
        }))
        .send()
        .await
        .map_err(|e| format!("OpenAI API request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error: {}", error_text));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                buffer.push_str(&text);

                // Process complete SSE events
                while let Some(event_end) = buffer.find("\n\n") {
                    let event = buffer[..event_end].to_string();
                    buffer = buffer[event_end + 2..].to_string();

                    for line in event.lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            if data == "[DONE]" {
                                continue;
                            }

                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                                if let Some(delta) = json["choices"][0]["delta"]["content"].as_str() {
                                    window
                                        .emit("ai-stream-chunk", delta)
                                        .map_err(|e| format!("Failed to emit event: {}", e))?;
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
