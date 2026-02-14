use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AIRequest {
    pub provider: String,
    pub prompt: String,
    pub api_key: Option<String>,
    pub ollama_url: Option<String>,
    pub stream: bool,
}

#[tauri::command]
pub async fn ai_generate_text(request: AIRequest) -> Result<String, String> {
    match request.provider.as_str() {
        "anthropic" => anthropic_generate(&request).await,
        "openai" => openai_generate(&request).await,
        "ollama" => ollama_generate(&request).await,
        _ => Err(format!("Unknown provider: {}", request.provider)),
    }
}

#[tauri::command]
pub async fn ai_chat(
    messages: Vec<ChatMessage>,
    provider: String,
    api_key: Option<String>,
    ollama_url: Option<String>,
) -> Result<String, String> {
    match provider.as_str() {
        "anthropic" => anthropic_chat(&messages, &api_key).await,
        "openai" => openai_chat(&messages, &api_key).await,
        "ollama" => ollama_chat(&messages, &ollama_url).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

#[tauri::command]
pub async fn ai_chat_stream(
    window: tauri::Window,
    messages: Vec<ChatMessage>,
    provider: String,
    api_key: Option<String>,
    ollama_url: Option<String>,
) -> Result<(), String> {
    use crate::commands::ai_streaming::*;

    match provider.as_str() {
        "anthropic" => anthropic_chat_stream(&window, &messages, &api_key).await,
        "openai" => openai_chat_stream(&window, &messages, &api_key).await,
        "ollama" => ollama_chat_stream(&window, &messages, &ollama_url).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

// Anthropic API implementation
async fn anthropic_generate(request: &AIRequest) -> Result<String, String> {
    let api_key = request
        .api_key
        .as_ref()
        .ok_or("Anthropic API key is required")?;

    let client = reqwest::Client::new();

    let mut body = HashMap::new();
    body.insert("model", "claude-sonnet-4-5-20250929");
    body.insert("max_tokens", "4096");

    let messages_array = vec![HashMap::from([
        ("role", "user"),
        ("content", request.prompt.as_str()),
    ])];

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": "claude-sonnet-4-5-20250929",
            "max_tokens": 4096,
            "messages": messages_array
        }))
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
        .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;

    let content = json["content"][0]["text"]
        .as_str()
        .ok_or("Invalid response format from Anthropic")?
        .to_string();

    Ok(content)
}

async fn anthropic_chat(messages: &[ChatMessage], api_key: &Option<String>) -> Result<String, String> {
    let api_key = api_key.as_ref().ok_or("Anthropic API key is required")?;

    let client = reqwest::Client::new();

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

    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": "claude-sonnet-4-5-20250929",
            "max_tokens": 4096,
            "messages": api_messages
        }))
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
        .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;

    let content = json["content"][0]["text"]
        .as_str()
        .ok_or("Invalid response format from Anthropic")?
        .to_string();

    Ok(content)
}

// OpenAI API implementation
async fn openai_generate(request: &AIRequest) -> Result<String, String> {
    let api_key = request.api_key.as_ref().ok_or("OpenAI API key is required")?;

    let client = reqwest::Client::new();

    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": "gpt-4-turbo-preview",
            "messages": [
                {
                    "role": "user",
                    "content": request.prompt
                }
            ],
            "max_tokens": 4096
        }))
        .send()
        .await
        .map_err(|e| format!("OpenAI API request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error: {}", error_text));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse OpenAI response: {}", e))?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Invalid response format from OpenAI")?
        .to_string();

    Ok(content)
}

async fn openai_chat(messages: &[ChatMessage], api_key: &Option<String>) -> Result<String, String> {
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
            "max_tokens": 4096
        }))
        .send()
        .await
        .map_err(|e| format!("OpenAI API request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error: {}", error_text));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse OpenAI response: {}", e))?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Invalid response format from OpenAI")?
        .to_string();

    Ok(content)
}

// Ollama API implementation
async fn ollama_generate(request: &AIRequest) -> Result<String, String> {
    let ollama_url = request
        .ollama_url
        .as_deref()
        .unwrap_or("http://localhost:11434");

    let client = reqwest::Client::new();

    let response = client
        .post(format!("{}/api/generate", ollama_url))
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": "llama2",
            "prompt": request.prompt,
            "stream": false
        }))
        .send()
        .await
        .map_err(|e| format!("Ollama API request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Ollama API error: {}", error_text));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    let content = json["response"]
        .as_str()
        .ok_or("Invalid response format from Ollama")?
        .to_string();

    Ok(content)
}

async fn ollama_chat(messages: &[ChatMessage], ollama_url: &Option<String>) -> Result<String, String> {
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
            "stream": false
        }))
        .send()
        .await
        .map_err(|e| format!("Ollama API request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Ollama API error: {}", error_text));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    let content = json["message"]["content"]
        .as_str()
        .ok_or("Invalid response format from Ollama")?
        .to_string();

    Ok(content)
}
