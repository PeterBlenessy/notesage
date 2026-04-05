use serde_json;

/// Generate a simple UUID v4-like string for tool call IDs when the provider
/// doesn't supply one (e.g., Ollama). Not cryptographically secure — just unique enough.
pub fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:032x}", t)
}

/// Accumulator for OpenAI Responses API function call arguments streamed incrementally.
#[derive(Debug, Clone)]
pub struct OpenAIToolCallAccumulator {
    pub call_id: String,
    pub name: String,
    pub arguments: String,
}

/// Accumulator for OpenAI Chat Completions API tool calls streamed incrementally.
/// Used by Ollama and OpenAI-compatible providers which use the standard chat completions format.
#[derive(Debug, Clone)]
pub struct ChatCompletionsToolCallAccumulator {
    pub id: String,
    pub name: String,
    pub arguments: String,
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
}
