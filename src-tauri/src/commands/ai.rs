use serde::{Deserialize, Serialize};
use std::fmt;
use std::sync::LazyLock;
use super::constants;
use super::credentials::get_credential_internal;

/// Typed AI provider enum replacing raw `String` for compile-time safety.
/// JSON values match the frontend strings: `"anthropic"`, `"openai"`, `"ollama"`,
/// `"openai_compatible"`, `"local_bundled"`.
///
/// Note: `#[serde(rename_all = "snake_case")]` would convert `OpenAI` to `"open_a_i"`
/// (not `"openai"`), so we use explicit `#[serde(rename)]` on variants whose
/// natural snake_case doesn't match the established wire format.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AIProviderType {
    Anthropic,
    #[serde(rename = "openai")]
    OpenAI,
    Ollama,
    #[serde(rename = "openai_compatible")]
    OpenAICompatible,
    LocalBundled,
}

impl fmt::Display for AIProviderType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AIProviderType::Anthropic => write!(f, "anthropic"),
            AIProviderType::OpenAI => write!(f, "openai"),
            AIProviderType::Ollama => write!(f, "ollama"),
            AIProviderType::OpenAICompatible => write!(f, "openai_compatible"),
            AIProviderType::LocalBundled => write!(f, "local_bundled"),
        }
    }
}

/// Shared HTTP client for connection pooling across all AI provider requests.
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

/// Normalize a base URL: strip trailing slashes and `/v1` suffix to prevent
/// double-path issues like `https://api.example.com//v1/models` or `.../v1/v1/chat/completions`.
pub fn normalize_base_url(url: &str) -> &str {
    url.trim_end_matches('/')
        .trim_end_matches("/v1")
        .trim_end_matches('/')
}

/// Resolve an API key: prefer explicit `api_key`, fall back to keychain via `connection_id`.
fn resolve_api_key(api_key: &Option<String>, connection_id: &Option<String>) -> Result<Option<String>, String> {
    if let Some(key) = api_key.as_ref() {
        if !key.is_empty() {
            log::debug!(target: "notesage::ai", "Using explicit api_key parameter");
            return Ok(Some(key.clone()));
        }
    }
    if let Some(conn_id) = connection_id.as_ref() {
        log::debug!(target: "notesage::ai", "Resolving API key from keychain for connection={conn_id}");
        let result = get_credential_internal(conn_id);
        if let Ok(None) = &result {
            log::warn!(target: "notesage::ai", "No credential found in keychain for connection={conn_id}");
        }
        return result;
    }
    Ok(None)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<ImageData>>,
}

/// Image data sent alongside a chat message for multi-modal AI providers.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImageData {
    /// Base64-encoded image data
    pub data: String,
    /// MIME type: "image/jpeg", "image/png", etc.
    pub mime_type: String,
}

/// Definition of a tool that can be passed to an AI provider for function calling.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// A tool call request returned by the AI model in an assistant message.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

/// The result of executing a tool call, sent back to the model.
#[allow(dead_code)]
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ToolResult {
    pub tool_call_id: String,
    pub content: String,
    pub is_error: bool,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct AIRequest {
    pub provider: AIProviderType,
    pub prompt: String,
    pub api_key: Option<String>,
    pub connection_id: Option<String>,
    pub ollama_url: Option<String>,
    pub stream: bool,
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
    pub base_url: Option<String>,
}

#[tauri::command]
pub async fn ai_generate_text(
    request: AIRequest,
    state: tauri::State<'_, super::local_inference::LocalInferenceState>,
) -> Result<String, String> {
    match request.provider {
        AIProviderType::Anthropic => anthropic_generate(&request).await,
        AIProviderType::OpenAI => openai_generate(&request).await,
        AIProviderType::Ollama => ollama_generate(&request).await,
        AIProviderType::OpenAICompatible => openai_compatible_generate(&request).await,
        AIProviderType::LocalBundled => {
            super::local_inference::local_bundled_generate(
                &request.prompt,
                &state,
                &request.model,
                request.temperature,
                request.max_tokens,
            )
            .await
        }
    }
}

#[tauri::command]
pub async fn ai_chat(
    messages: Vec<ChatMessage>,
    provider: AIProviderType,
    api_key: Option<String>,
    connection_id: Option<String>,
    ollama_url: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    base_url: Option<String>,
    state: tauri::State<'_, super::local_inference::LocalInferenceState>,
) -> Result<String, String> {
    let resolved_key = resolve_api_key(&api_key, &connection_id)?;
    match provider {
        AIProviderType::Anthropic => anthropic_chat(&messages, &resolved_key, &model, temperature, max_tokens, &base_url).await,
        AIProviderType::OpenAI => openai_chat(&messages, &resolved_key, &model, temperature, max_tokens, &base_url).await,
        AIProviderType::Ollama => ollama_chat(&messages, &ollama_url, &model, temperature, max_tokens, &base_url).await,
        AIProviderType::OpenAICompatible => openai_compatible_chat(&messages, &resolved_key, &model, temperature, max_tokens, &base_url).await,
        AIProviderType::LocalBundled => {
            super::local_inference::local_bundled_chat(&messages, &state, &model, temperature, max_tokens).await
        }
    }
}

#[tauri::command]
pub async fn ai_chat_stream(
    window: tauri::Window,
    messages: Vec<ChatMessage>,
    provider: AIProviderType,
    api_key: Option<String>,
    connection_id: Option<String>,
    ollama_url: Option<String>,
    web_search_enabled: Option<bool>,
    tools: Option<Vec<ToolDefinition>>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    base_url: Option<String>,
    response_format: Option<serde_json::Value>,
    state: tauri::State<'_, super::local_inference::LocalInferenceState>,
) -> Result<(), String> {
    use crate::commands::ai_streaming::*;

    let search = web_search_enabled.unwrap_or(false);
    let resolved_key = resolve_api_key(&api_key, &connection_id)?;

    match provider {
        AIProviderType::Anthropic => anthropic_chat_stream(&window, &messages, &resolved_key, search, &tools, &model, temperature, max_tokens, &base_url).await,
        AIProviderType::OpenAI => openai_chat_stream(&window, &messages, &resolved_key, search, &tools, &model, temperature, max_tokens, &base_url).await,
        AIProviderType::Ollama => ollama_chat_stream(&window, &messages, &ollama_url, &tools, &model, temperature, max_tokens, &base_url, &response_format).await,
        AIProviderType::OpenAICompatible => openai_compatible_chat_stream(&window, &messages, &resolved_key, &tools, &model, temperature, max_tokens, &base_url, &response_format).await,
        AIProviderType::LocalBundled => {
            super::local_inference::local_bundled_chat_stream(&window, &messages, &state, &tools, &model, temperature, max_tokens, &response_format).await
        }
    }
}

#[tauri::command]
pub async fn list_models(
    provider: AIProviderType,
    api_key: Option<String>,
    connection_id: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<String>, String> {
    let client = &*HTTP_CLIENT;
    let resolved_key = resolve_api_key(&api_key, &connection_id)?;

    match provider {
        AIProviderType::Anthropic => {
            let api_key = resolved_key.as_ref().ok_or("Anthropic API key is required")?;
            let url = format!(
                "{}/v1/models",
                normalize_base_url(base_url.as_deref().unwrap_or("https://api.anthropic.com"))
            );

            let response = client
                .get(&url)
                .header("x-api-key", api_key)
                .header("anthropic-version", constants::ANTHROPIC_API_VERSION)
                .send()
                .await
                .map_err(|e| format!("Failed to fetch Anthropic models: {}", e))?;

            if !response.status().is_success() {
                let error_text = response.text().await.unwrap_or_default();
                return Err(format!("Anthropic API error: {}", error_text));
            }

            let json: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse Anthropic models response: {}", e))?;

            let models: Vec<String> = json["data"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|m| m["id"].as_str().map(String::from))
                .collect();

            Ok(models)
        }

        AIProviderType::OpenAI | AIProviderType::OpenAICompatible => {
            let api_key = resolved_key.as_ref().ok_or("API key is required")?;
            let effective_base = if provider == AIProviderType::OpenAICompatible {
                base_url.as_deref()
                    .ok_or("Base URL is required for OpenAI-Compatible provider")?
            } else {
                base_url.as_deref().unwrap_or("https://api.openai.com")
            };
            let url = format!("{}/v1/models", normalize_base_url(effective_base));

            let response = client
                .get(&url)
                .header("Authorization", format!("Bearer {}", api_key))
                .send()
                .await
                .map_err(|e| format!("Failed to fetch models: {}", e))?;

            if !response.status().is_success() {
                let status = response.status();
                let error_text = response.text().await.unwrap_or_default();
                return Err(format!("API error ({}): {} — {}", url, status, error_text));
            }

            let json: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse models response from {}: {}", url, e))?;

            let mut models: Vec<String> = json["data"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|m| m["id"].as_str().map(String::from))
                .collect();

            models.sort();
            Ok(models)
        }

        AIProviderType::Ollama => {
            let url = format!(
                "{}/api/tags",
                base_url.as_deref().unwrap_or("http://localhost:11434")
            );

            let response = client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("Failed to fetch Ollama models from {}: {}", url, e))?;

            if !response.status().is_success() {
                let status = response.status();
                let error_text = response.text().await.unwrap_or_default();
                return Err(format!("Ollama API error ({}): {} — {}", url, status, error_text));
            }

            let json: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse Ollama models response from {}: {}", url, e))?;

            let models: Vec<String> = json["models"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|m| m["name"].as_str().map(String::from))
                .collect();

            Ok(models)
        }

        AIProviderType::LocalBundled => {
            Err("Local bundled provider does not support model listing via this endpoint".to_string())
        }
    }
}

// Anthropic API implementation
async fn anthropic_generate(request: &AIRequest) -> Result<String, String> {
    let resolved = resolve_api_key(&request.api_key, &request.connection_id)?;
    let api_key = resolved
        .as_ref()
        .ok_or("Anthropic API key is required")?;

    let model = request.model.as_deref().unwrap_or(constants::DEFAULT_MODEL_ANTHROPIC);
    let max_tokens = request.max_tokens.unwrap_or(4096);
    let api_url = format!(
        "{}/v1/messages",
        request.base_url.as_deref().unwrap_or("https://api.anthropic.com")
    );

    let client = &*HTTP_CLIENT;

    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{
            "role": "user",
            "content": request.prompt
        }]
    });

    if let Some(temp) = request.temperature {
        body["temperature"] = serde_json::json!(temp);
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

async fn anthropic_chat(
    messages: &[ChatMessage],
    api_key: &Option<String>,
    model: &Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    base_url: &Option<String>,
) -> Result<String, String> {
    let api_key = api_key.as_ref().ok_or("Anthropic API key is required")?;
    let model = model.as_deref().unwrap_or(constants::DEFAULT_MODEL_ANTHROPIC);
    let max_tokens = max_tokens.unwrap_or(4096);
    let api_url = format!(
        "{}/v1/messages",
        base_url.as_deref().unwrap_or("https://api.anthropic.com")
    );

    let client = &*HTTP_CLIENT;

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
        "messages": api_messages
    });

    if let Some(ref system) = system_content {
        body["system"] = serde_json::json!(system);
    }

    if let Some(temp) = temperature {
        body["temperature"] = serde_json::json!(temp);
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

// OpenAI Responses API implementation
async fn openai_generate(request: &AIRequest) -> Result<String, String> {
    let resolved = resolve_api_key(&request.api_key, &request.connection_id)?;
    let api_key = resolved.as_ref().ok_or("OpenAI API key is required")?;
    let model = request.model.as_deref().unwrap_or(constants::DEFAULT_MODEL_OPENAI);
    let api_url = format!(
        "{}/v1/responses",
        normalize_base_url(request.base_url.as_deref().unwrap_or("https://api.openai.com"))
    );

    let client = &*HTTP_CLIENT;

    let mut body = serde_json::json!({
        "model": model,
        "input": request.prompt,
        "store": false,
    });

    if let Some(temp) = request.temperature {
        body["temperature"] = serde_json::json!(temp);
    }
    if let Some(max) = request.max_tokens {
        body["max_output_tokens"] = serde_json::json!(max);
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

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse OpenAI response: {}", e))?;

    // Responses API: output[0].content[0].text
    let content = json["output"][0]["content"][0]["text"]
        .as_str()
        .ok_or("Invalid response format from OpenAI")?
        .to_string();

    Ok(content)
}

async fn openai_chat(
    messages: &[ChatMessage],
    api_key: &Option<String>,
    model: &Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    base_url: &Option<String>,
) -> Result<String, String> {
    let api_key = api_key.as_ref().ok_or("OpenAI API key is required")?;
    let model = model.as_deref().unwrap_or(constants::DEFAULT_MODEL_OPENAI);
    let api_url = format!(
        "{}/v1/responses",
        normalize_base_url(base_url.as_deref().unwrap_or("https://api.openai.com"))
    );

    let client = &*HTTP_CLIENT;

    // Extract system message as top-level `instructions`
    let instructions: Option<String> = messages
        .iter()
        .find(|m| m.role == "system")
        .map(|m| m.content.clone());

    // Build input array for Responses API
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

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse OpenAI response: {}", e))?;

    // Responses API: output[0].content[0].text
    let content = json["output"][0]["content"][0]["text"]
        .as_str()
        .ok_or("Invalid response format from OpenAI")?
        .to_string();

    Ok(content)
}

/// Resolve the Ollama model: use the requested model, fall back to the default,
/// or query /api/tags and pick the first available model if the default isn't pulled.
pub async fn resolve_ollama_model(base_url: &str, requested: Option<&str>) -> String {
    if let Some(model) = requested {
        return model.to_string();
    }
    // Check if the default model is available
    if let Ok(resp) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()
        .unwrap_or_default()
        .get(format!("{}/api/tags", base_url))
        .send()
        .await
    {
        if let Ok(json) = resp.json::<serde_json::Value>().await {
            if let Some(models) = json.get("models").and_then(|v| v.as_array()) {
                let names: Vec<&str> = models.iter()
                    .filter_map(|m| m.get("name").and_then(|n| n.as_str()))
                    .collect();
                // Default is available
                if names.iter().any(|n| n.starts_with(constants::DEFAULT_MODEL_OLLAMA)) {
                    return constants::DEFAULT_MODEL_OLLAMA.to_string();
                }
                // Use first available model
                if let Some(first) = names.first() {
                    return first.to_string();
                }
            }
        }
    }
    constants::DEFAULT_MODEL_OLLAMA.to_string()
}

// Ollama API implementation
async fn ollama_generate(request: &AIRequest) -> Result<String, String> {
    let base = request.base_url.as_deref()
        .or(request.ollama_url.as_deref())
        .unwrap_or("http://localhost:11434");
    let model = resolve_ollama_model(base, request.model.as_deref()).await;

    // Ollama may need to load the model on first request — generous timeout
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut body = serde_json::json!({
        "model": model,
        "prompt": request.prompt,
        "stream": false
    });

    if let Some(temp) = request.temperature {
        body["options"] = serde_json::json!({ "temperature": temp });
    }

    let response = client
        .post(format!("{}/api/generate", base))
        .header("content-type", "application/json")
        .json(&body)
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

async fn ollama_chat(
    messages: &[ChatMessage],
    ollama_url: &Option<String>,
    model: &Option<String>,
    temperature: Option<f64>,
    _max_tokens: Option<u32>,
    base_url: &Option<String>,
) -> Result<String, String> {
    let base = base_url.as_deref()
        .or(ollama_url.as_deref())
        .unwrap_or("http://localhost:11434");
    let model = resolve_ollama_model(base, model.as_deref()).await;

    // Ollama may need to load the model on first request — generous timeout
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

    let mut body = serde_json::json!({
        "model": model,
        "messages": api_messages,
        "stream": false
    });

    if let Some(temp) = temperature {
        body["options"] = serde_json::json!({ "temperature": temp });
    }

    let response = client
        .post(format!("{}/api/chat", base))
        .header("content-type", "application/json")
        .json(&body)
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

// OpenAI-Compatible API implementation (standard Chat Completions format)
async fn openai_compatible_generate(request: &AIRequest) -> Result<String, String> {
    let resolved = resolve_api_key(&request.api_key, &request.connection_id)?;
    let api_key = resolved.as_ref().ok_or("API key is required")?;
    let base_url = request.base_url.as_ref().ok_or("Base URL is required for OpenAI-Compatible provider")?;
    let model = request.model.as_deref().ok_or("Model is required for OpenAI-Compatible provider")?;

    let client = &*HTTP_CLIENT;

    let mut body = serde_json::json!({
        "model": model,
        "messages": [{
            "role": "user",
            "content": request.prompt
        }]
    });

    if let Some(temp) = request.temperature {
        body["temperature"] = serde_json::json!(temp);
    }
    if let Some(max) = request.max_tokens {
        body["max_tokens"] = serde_json::json!(max);
    }

    let response = client
        .post(format!("{}/v1/chat/completions", normalize_base_url(base_url)))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI-compatible request to {} failed: {}", base_url, e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI-compatible API error ({} {}): {}", base_url, status, error_text));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response from {}: {}", base_url, e))?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| format!("Invalid response format from {} — expected choices[0].message.content", base_url))?
        .to_string();

    Ok(content)
}

// Ollama Fill-in-the-Middle (FIM) completion
#[tauri::command]
pub async fn ollama_fim_completion(
    prefix: String,
    suffix: String,
    model: Option<String>,
    ollama_url: Option<String>,
) -> Result<String, String> {
    let base = ollama_url.as_deref().unwrap_or("http://localhost:11434");
    let model = model.as_deref().unwrap_or("qwen2.5-coder");

    // Ollama may need to load the model on first request — generous timeout
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let body = serde_json::json!({
        "model": model,
        "prompt": prefix,
        "suffix": suffix,
        "stream": false,
        "options": {
            "num_predict": 128,
            "temperature": constants::CHAT_TEMPERATURE_FIM_FALLBACK,
            "stop": ["\n\n", "\n#", "\n//"]
        }
    });

    let response = client
        .post(format!("{}/api/generate", base))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama FIM request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Ollama FIM error: {}", error_text));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama FIM response: {}", e))?;

    let content = json["response"]
        .as_str()
        .unwrap_or("")
        .to_string();

    Ok(content)
}

// Generic OpenAI-compatible /v1/completions FIM endpoint
// Works with llama-server, vLLM, LiteLLM, Together AI, Groq, etc.
#[tauri::command]
pub async fn openai_completions_fim(
    base_url: String,
    api_key: Option<String>,
    connection_id: Option<String>,
    model: String,
    prefix: String,
    suffix: String,
    max_tokens: Option<u32>,
) -> Result<String, String> {
    let api_key = resolve_api_key(&api_key, &connection_id)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let url = format!("{}/v1/completions", normalize_base_url(&base_url));

    let body = serde_json::json!({
        "model": model,
        "prompt": prefix,
        "suffix": suffix,
        "max_tokens": max_tokens.unwrap_or(128),
        "temperature": constants::CHAT_TEMPERATURE_FIM_FALLBACK,
        "stop": ["\n\n"]
    });

    let mut req = client
        .post(&url)
        .header("content-type", "application/json")
        .json(&body);

    if let Some(key) = &api_key {
        req = req.header("authorization", format!("Bearer {}", key));
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("Completion request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Completion error: {}", error_text));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse completion response: {}", e))?;

    let text = json["choices"][0]["text"]
        .as_str()
        .unwrap_or("")
        .to_string();

    Ok(text)
}

async fn openai_compatible_chat(
    messages: &[ChatMessage],
    api_key: &Option<String>,
    model: &Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    base_url: &Option<String>,
) -> Result<String, String> {
    let api_key = api_key.as_ref().ok_or("API key is required")?;
    let base_url = base_url.as_ref().ok_or("Base URL is required for OpenAI-Compatible provider")?;
    let model = model.as_deref().ok_or("Model is required for OpenAI-Compatible provider")?;

    let client = &*HTTP_CLIENT;

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
        "messages": api_messages
    });

    if let Some(temp) = temperature {
        body["temperature"] = serde_json::json!(temp);
    }
    if let Some(max) = max_tokens {
        body["max_tokens"] = serde_json::json!(max);
    }

    let response = client
        .post(format!("{}/v1/chat/completions", normalize_base_url(base_url)))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI-compatible chat request to {} failed: {}", base_url, e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI-compatible API error ({} {}): {}", base_url, status, error_text));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse chat response from {}: {}", base_url, e))?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| format!("Invalid chat response format from {} — expected choices[0].message.content", base_url))?
        .to_string();

    Ok(content)
}

#[tauri::command]
pub async fn ollama_model_supports_vision(
    ollama_url: Option<String>,
    model: String,
    base_url: Option<String>,
) -> Result<bool, String> {
    let base = base_url
        .as_deref()
        .or(ollama_url.as_deref())
        .unwrap_or("http://localhost:11434");

    let client = reqwest::Client::new();
    let result =
        crate::commands::segment_builder::detect_vision_support(&client, base, &model).await;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_chat_message_basic_serialization() {
        let msg = ChatMessage {
            role: "user".to_string(),
            content: "Hello".to_string(),
            tool_calls: None,
            tool_call_id: None,
            images: None,
        };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["role"], "user");
        assert_eq!(json["content"], "Hello");
        // Optional fields should be absent (skip_serializing_if)
        assert!(json.get("tool_calls").is_none());
        assert!(json.get("tool_call_id").is_none());
    }

    #[test]
    fn test_chat_message_with_tool_calls() {
        let msg = ChatMessage {
            role: "assistant".to_string(),
            content: "".to_string(),
            tool_calls: Some(vec![ToolCall {
                id: "call_123".to_string(),
                name: "read_file".to_string(),
                arguments: json!({"path": "/tmp/test.md"}),
            }]),
            tool_call_id: None,
            images: None,
        };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["tool_calls"][0]["id"], "call_123");
        assert_eq!(json["tool_calls"][0]["name"], "read_file");
        assert_eq!(json["tool_calls"][0]["arguments"]["path"], "/tmp/test.md");
        assert!(json.get("tool_call_id").is_none());
    }

    #[test]
    fn test_chat_message_tool_role() {
        let msg = ChatMessage {
            role: "tool".to_string(),
            content: "file contents here".to_string(),
            tool_calls: None,
            tool_call_id: Some("call_123".to_string()),
            images: None,
        };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["role"], "tool");
        assert_eq!(json["tool_call_id"], "call_123");
        assert!(json.get("tool_calls").is_none());
    }

    #[test]
    fn test_chat_message_deserialization_without_optional_fields() {
        let json_str = r#"{"role": "user", "content": "Hi"}"#;
        let msg: ChatMessage = serde_json::from_str(json_str).unwrap();
        assert_eq!(msg.role, "user");
        assert_eq!(msg.content, "Hi");
        assert!(msg.tool_calls.is_none());
        assert!(msg.tool_call_id.is_none());
    }

    #[test]
    fn test_chat_message_deserialization_with_tool_calls() {
        let json_str = r#"{
            "role": "assistant",
            "content": "",
            "tool_calls": [
                {"id": "tc_1", "name": "search", "arguments": {"query": "rust"}}
            ]
        }"#;
        let msg: ChatMessage = serde_json::from_str(json_str).unwrap();
        assert_eq!(msg.role, "assistant");
        let calls = msg.tool_calls.unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "tc_1");
        assert_eq!(calls[0].name, "search");
        assert_eq!(calls[0].arguments["query"], "rust");
    }

    #[test]
    fn test_tool_definition_serialization_roundtrip() {
        let def = ToolDefinition {
            name: "read_file".to_string(),
            description: "Read a file from disk".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute file path"}
                },
                "required": ["path"]
            }),
        };
        let serialized = serde_json::to_string(&def).unwrap();
        let deserialized: ToolDefinition = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.name, "read_file");
        assert_eq!(deserialized.description, "Read a file from disk");
        assert_eq!(deserialized.input_schema["properties"]["path"]["type"], "string");
    }

    #[test]
    fn test_tool_call_serialization_roundtrip() {
        let call = ToolCall {
            id: "call_abc".to_string(),
            name: "write_file".to_string(),
            arguments: json!({"path": "/tmp/out.txt", "content": "hello"}),
        };
        let serialized = serde_json::to_string(&call).unwrap();
        let deserialized: ToolCall = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.id, "call_abc");
        assert_eq!(deserialized.name, "write_file");
        assert_eq!(deserialized.arguments["content"], "hello");
    }

    #[test]
    fn test_tool_result_serialization_roundtrip() {
        let result = ToolResult {
            tool_call_id: "call_abc".to_string(),
            content: "File written successfully".to_string(),
            is_error: false,
        };
        let serialized = serde_json::to_string(&result).unwrap();
        let deserialized: ToolResult = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.tool_call_id, "call_abc");
        assert_eq!(deserialized.content, "File written successfully");
        assert!(!deserialized.is_error);
    }

    #[test]
    fn test_tool_result_error_case() {
        let result = ToolResult {
            tool_call_id: "call_xyz".to_string(),
            content: "Permission denied".to_string(),
            is_error: true,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["is_error"], true);
        assert_eq!(json["content"], "Permission denied");
    }

    #[test]
    fn test_tool_call_with_complex_arguments() {
        let call = ToolCall {
            id: "call_complex".to_string(),
            name: "search".to_string(),
            arguments: json!({
                "query": "test",
                "filters": ["markdown", "code"],
                "options": {"case_sensitive": false, "max_results": 10}
            }),
        };
        let serialized = serde_json::to_string(&call).unwrap();
        let deserialized: ToolCall = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.arguments["filters"][0], "markdown");
        assert_eq!(deserialized.arguments["options"]["max_results"], 10);
    }

    #[test]
    fn test_multiple_tool_calls_in_message() {
        let msg = ChatMessage {
            role: "assistant".to_string(),
            content: "".to_string(),
            tool_calls: Some(vec![
                ToolCall {
                    id: "call_1".to_string(),
                    name: "read_file".to_string(),
                    arguments: json!({"path": "/a.md"}),
                },
                ToolCall {
                    id: "call_2".to_string(),
                    name: "read_file".to_string(),
                    arguments: json!({"path": "/b.md"}),
                },
            ]),
            tool_call_id: None,
            images: None,
        };
        let json = serde_json::to_value(&msg).unwrap();
        let calls = json["tool_calls"].as_array().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0]["id"], "call_1");
        assert_eq!(calls[1]["id"], "call_2");
    }

    #[test]
    fn test_chat_message_with_images_serializes() {
        let msg = ChatMessage {
            role: "user".to_string(),
            content: "Check this image".to_string(),
            tool_calls: None,
            tool_call_id: None,
            images: Some(vec![ImageData {
                data: "base64data".to_string(),
                mime_type: "image/jpeg".to_string(),
            }]),
        };
        let json = serde_json::to_value(&msg).unwrap();
        assert_eq!(json["role"], "user");
        assert_eq!(json["content"], "Check this image");
        let images = json["images"].as_array().unwrap();
        assert_eq!(images.len(), 1);
        assert_eq!(images[0]["data"], "base64data");
        assert_eq!(images[0]["mime_type"], "image/jpeg");
    }

    #[test]
    fn test_chat_message_without_images_skips_field() {
        let msg = ChatMessage {
            role: "user".to_string(),
            content: "No images".to_string(),
            tool_calls: None,
            tool_call_id: None,
            images: None,
        };
        let json = serde_json::to_value(&msg).unwrap();
        assert!(json.get("images").is_none());
    }

    #[test]
    fn test_chat_message_with_images_deserializes() {
        let json = json!({
            "role": "user",
            "content": "Check this",
            "images": [{
                "data": "abc123",
                "mime_type": "image/png"
            }]
        });
        let msg: ChatMessage = serde_json::from_value(json).unwrap();
        assert!(msg.images.is_some());
        let images = msg.images.unwrap();
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].data, "abc123");
        assert_eq!(images[0].mime_type, "image/png");
    }

    #[test]
    fn test_chat_message_without_images_deserializes() {
        let json = json!({
            "role": "user",
            "content": "No images"
        });
        let msg: ChatMessage = serde_json::from_value(json).unwrap();
        assert!(msg.images.is_none());
    }

    #[test]
    fn test_image_data_roundtrip() {
        let img = ImageData {
            data: "base64data==".to_string(),
            mime_type: "image/jpeg".to_string(),
        };
        let serialized = serde_json::to_string(&img).unwrap();
        let deserialized: ImageData = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.data, "base64data==");
        assert_eq!(deserialized.mime_type, "image/jpeg");
    }
}
