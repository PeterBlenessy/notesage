use serde::{Deserialize, Serialize};

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
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
    pub base_url: Option<String>,
}

#[tauri::command]
pub async fn ai_generate_text(request: AIRequest) -> Result<String, String> {
    match request.provider.as_str() {
        "anthropic" => anthropic_generate(&request).await,
        "openai" => openai_generate(&request).await,
        "ollama" => ollama_generate(&request).await,
        "openai_compatible" => openai_compatible_generate(&request).await,
        _ => Err(format!("Unknown provider: {}", request.provider)),
    }
}

#[tauri::command]
pub async fn ai_chat(
    messages: Vec<ChatMessage>,
    provider: String,
    api_key: Option<String>,
    ollama_url: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    base_url: Option<String>,
) -> Result<String, String> {
    match provider.as_str() {
        "anthropic" => anthropic_chat(&messages, &api_key, &model, temperature, max_tokens, &base_url).await,
        "openai" => openai_chat(&messages, &api_key, &model, temperature, max_tokens, &base_url).await,
        "ollama" => ollama_chat(&messages, &ollama_url, &model, temperature, max_tokens, &base_url).await,
        "openai_compatible" => openai_compatible_chat(&messages, &api_key, &model, temperature, max_tokens, &base_url).await,
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
    web_search_enabled: Option<bool>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    base_url: Option<String>,
) -> Result<(), String> {
    use crate::commands::ai_streaming::*;

    let search = web_search_enabled.unwrap_or(false);

    match provider.as_str() {
        "anthropic" => anthropic_chat_stream(&window, &messages, &api_key, search, &model, temperature, max_tokens, &base_url).await,
        "openai" => openai_chat_stream(&window, &messages, &api_key, search, &model, temperature, max_tokens, &base_url).await,
        "ollama" => ollama_chat_stream(&window, &messages, &ollama_url, &model, temperature, max_tokens, &base_url).await,
        "openai_compatible" => openai_compatible_chat_stream(&window, &messages, &api_key, &model, temperature, max_tokens, &base_url).await,
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

#[tauri::command]
pub async fn list_models(
    provider: String,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();

    match provider.as_str() {
        "anthropic" => {
            let api_key = api_key.as_ref().ok_or("Anthropic API key is required")?;
            let url = format!(
                "{}/v1/models",
                base_url.as_deref().unwrap_or("https://api.anthropic.com")
            );

            let response = client
                .get(&url)
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
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

        "openai" | "openai_compatible" => {
            let api_key = api_key.as_ref().ok_or("API key is required")?;
            let default_base = if provider == "openai" {
                "https://api.openai.com"
            } else {
                return Err("Base URL is required for OpenAI-Compatible provider".to_string());
            };
            let url = format!(
                "{}/v1/models",
                base_url.as_deref().unwrap_or(default_base)
            );

            let response = client
                .get(&url)
                .header("Authorization", format!("Bearer {}", api_key))
                .send()
                .await
                .map_err(|e| format!("Failed to fetch models: {}", e))?;

            if !response.status().is_success() {
                let error_text = response.text().await.unwrap_or_default();
                return Err(format!("API error: {}", error_text));
            }

            let json: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse models response: {}", e))?;

            let mut models: Vec<String> = json["data"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|m| m["id"].as_str().map(String::from))
                .collect();

            models.sort();
            Ok(models)
        }

        "ollama" => {
            let url = format!(
                "{}/api/tags",
                base_url.as_deref().unwrap_or("http://localhost:11434")
            );

            let response = client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("Failed to fetch Ollama models: {}", e))?;

            if !response.status().is_success() {
                let error_text = response.text().await.unwrap_or_default();
                return Err(format!("Ollama API error: {}", error_text));
            }

            let json: serde_json::Value = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse Ollama models response: {}", e))?;

            let models: Vec<String> = json["models"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|m| m["name"].as_str().map(String::from))
                .collect();

            Ok(models)
        }

        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

// Anthropic API implementation
async fn anthropic_generate(request: &AIRequest) -> Result<String, String> {
    let api_key = request
        .api_key
        .as_ref()
        .ok_or("Anthropic API key is required")?;

    let model = request.model.as_deref().unwrap_or("claude-sonnet-4-5-20250929");
    let max_tokens = request.max_tokens.unwrap_or(4096);
    let api_url = format!(
        "{}/v1/messages",
        request.base_url.as_deref().unwrap_or("https://api.anthropic.com")
    );

    let client = reqwest::Client::new();

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
        .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;

    let content = json["content"][0]["text"]
        .as_str()
        .ok_or("Invalid response format from Anthropic")?
        .to_string();

    Ok(content)
}

// OpenAI Responses API implementation
async fn openai_generate(request: &AIRequest) -> Result<String, String> {
    let api_key = request.api_key.as_ref().ok_or("OpenAI API key is required")?;
    let model = request.model.as_deref().unwrap_or("gpt-4o");
    let api_url = format!(
        "{}/v1/responses",
        request.base_url.as_deref().unwrap_or("https://api.openai.com")
    );

    let client = reqwest::Client::new();

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
    let model = model.as_deref().unwrap_or("gpt-4o");
    let api_url = format!(
        "{}/v1/responses",
        base_url.as_deref().unwrap_or("https://api.openai.com")
    );

    let client = reqwest::Client::new();

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

// Ollama API implementation
async fn ollama_generate(request: &AIRequest) -> Result<String, String> {
    let base = request.base_url.as_deref()
        .or(request.ollama_url.as_deref())
        .unwrap_or("http://localhost:11434");
    let model = request.model.as_deref().unwrap_or("llama3.2");

    let client = reqwest::Client::new();

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
    let model = model.as_deref().unwrap_or("llama3.2");

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
    let api_key = request.api_key.as_ref().ok_or("API key is required")?;
    let base_url = request.base_url.as_ref().ok_or("Base URL is required for OpenAI-Compatible provider")?;
    let model = request.model.as_deref().ok_or("Model is required for OpenAI-Compatible provider")?;

    let client = reqwest::Client::new();

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
        .post(format!("{}/v1/chat/completions", base_url.trim_end_matches('/')))
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

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Invalid response format")?
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

    let client = reqwest::Client::new();

    let body = serde_json::json!({
        "model": model,
        "prompt": prefix,
        "suffix": suffix,
        "stream": false,
        "options": {
            "num_predict": 128,
            "temperature": 0.2,
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
        "messages": api_messages
    });

    if let Some(temp) = temperature {
        body["temperature"] = serde_json::json!(temp);
    }
    if let Some(max) = max_tokens {
        body["max_tokens"] = serde_json::json!(max);
    }

    let response = client
        .post(format!("{}/v1/chat/completions", base_url.trim_end_matches('/')))
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

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Invalid response format")?
        .to_string();

    Ok(content)
}
