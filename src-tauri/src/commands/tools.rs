use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub tool_use_id: String,
    pub content: String,
}

// Define available tools
pub fn get_available_tools() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "web_search".to_string(),
            description: "Search the web for current information. Use this when you need up-to-date information or facts about current events, people, places, or things.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query to look up on the web"
                    }
                },
                "required": ["query"]
            }),
        },
    ]
}

// Execute a tool call
pub async fn execute_tool(tool_call: &ToolCall) -> Result<String, String> {
    match tool_call.name.as_str() {
        "web_search" => {
            let query = tool_call.arguments["query"]
                .as_str()
                .ok_or("Missing query parameter")?;
            web_search(query).await
        }
        _ => Err(format!("Unknown tool: {}", tool_call.name)),
    }
}

// Web search implementation using DuckDuckGo
async fn web_search(query: &str) -> Result<String, String> {
    let client = reqwest::Client::new();

    // Use DuckDuckGo Instant Answer API (free, no API key needed)
    let url = format!(
        "https://api.duckduckgo.com/?q={}&format=json&no_redirect=1",
        urlencoding::encode(query)
    );

    let response = client
        .get(&url)
        .header("User-Agent", "Notesage/1.0")
        .send()
        .await
        .map_err(|e| format!("Search request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Search failed with status: {}", response.status()));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse search response: {}", e))?;

    // Extract search results
    let mut results = Vec::new();

    // Get abstract if available
    if let Some(abstract_text) = json["AbstractText"].as_str() {
        if !abstract_text.is_empty() {
            results.push(format!("Summary: {}", abstract_text));
        }
    }

    // Get related topics
    if let Some(topics) = json["RelatedTopics"].as_array() {
        for (i, topic) in topics.iter().take(5).enumerate() {
            if let Some(text) = topic["Text"].as_str() {
                if !text.is_empty() {
                    results.push(format!("{}. {}", i + 1, text));
                }
            }
        }
    }

    if results.is_empty() {
        return Ok(format!("No detailed results found for '{}'. The topic may be too specific or recent.", query));
    }

    Ok(results.join("\n\n"))
}

// Convert tool definitions to Anthropic format
pub fn tools_to_anthropic_format() -> Vec<serde_json::Value> {
    get_available_tools()
        .iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.parameters
            })
        })
        .collect()
}

// Convert tool definitions to OpenAI format
pub fn tools_to_openai_format() -> Vec<serde_json::Value> {
    get_available_tools()
        .iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters
                }
            })
        })
        .collect()
}
