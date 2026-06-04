//! GGUF header capability reader.
//!
//! Extracts feature-mechanism facts (FIM tokens, tool-call template, thinking)
//! from a GGUF metadata header — either a local file or, crucially, a remote
//! HuggingFace `resolve` URL read via an HTTP `Range` request so we never
//! download the multi-GB weights to learn what a model can do.

use std::collections::HashMap;
use std::io::Cursor;

use super::super::gguf_parser::{parse_gguf_kv, GgufValue};
use super::types::GgufCapabilities;

/// Initial header window (MB) for the remote Range read. Widened once on
/// truncation so a large vocab array can't push the chat template off-window.
const INITIAL_WINDOW_MB: u64 = 16;
const WIDE_WINDOW_MB: u64 = 48;

fn build_capabilities(
    version: u32,
    kv: &HashMap<String, GgufValue>,
    truncated: bool,
) -> GgufCapabilities {
    let architecture = kv.get("general.architecture").and_then(|v| v.as_string());

    let context_length = architecture
        .as_ref()
        .and_then(|a| kv.get(&format!("{}.context_length", a)))
        .and_then(|v| v.as_u32());

    // FIM: all three infill token ids must be present.
    let has_fim_tokens = ["prefix", "suffix", "middle"].iter().all(|t| {
        kv.get(&format!("tokenizer.ggml.{}_token_id", t))
            .and_then(|v| v.as_u32())
            .is_some()
    });

    let template = kv
        .get("tokenizer.chat_template")
        .and_then(|v| v.as_string())
        .unwrap_or_default()
        .to_lowercase();

    let has_tool_template =
        template.contains("tool_calls") || template.contains("tools") || template.contains("function");
    let has_thinking =
        template.contains("<think>") || template.contains("reasoning") || template.contains("thinking");

    GgufCapabilities {
        architecture,
        context_length,
        has_fim_tokens,
        has_tool_template,
        has_thinking,
        gguf_version: version,
        truncated,
    }
}

/// Parse capabilities from an in-memory header buffer (tolerant — the buffer
/// may be a Range-limited slice that ends mid-metadata).
pub fn capabilities_from_buffer(buf: &[u8]) -> Result<GgufCapabilities, String> {
    let mut cursor = Cursor::new(buf);
    let raw = parse_gguf_kv(&mut cursor, true)?;
    Ok(build_capabilities(raw.version, &raw.kv, raw.truncated))
}

/// Parse capabilities from a complete local GGUF file (never truncated).
pub fn capabilities_from_file(path: &str) -> Result<GgufCapabilities, String> {
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("Failed to open GGUF file: {}", e))?;
    let raw = parse_gguf_kv(&mut file, false)?;
    Ok(build_capabilities(raw.version, &raw.kv, false))
}

async fn fetch_header_window(url: &str, window_mb: u64) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::new();
    let end = window_mb * 1_000_000 - 1;
    let resp = client
        .get(url)
        .header("Range", format!("bytes=0-{}", end))
        .send()
        .await
        .map_err(|e| format!("Range request failed: {}", e))?;
    let status = resp.status();
    // 206 = partial content (Range honored), 200 = full (Range ignored — still fine).
    if status != reqwest::StatusCode::PARTIAL_CONTENT && !status.is_success() {
        return Err(format!("HF returned {} for {}", status, url));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read header bytes: {}", e))?;
    Ok(bytes.to_vec())
}

/// Read GGUF capabilities for a model without downloading its weights.
///
/// Prefers `local_path` (full file). Otherwise reads `resolve_url` via a
/// Range request, widening the window once if the first read truncates before
/// reaching the chat template.
pub async fn read_capabilities(
    resolve_url: Option<String>,
    local_path: Option<String>,
) -> Result<GgufCapabilities, String> {
    if let Some(path) = local_path {
        return capabilities_from_file(&path);
    }
    let url = resolve_url.ok_or_else(|| "read_gguf_capabilities: no url or path".to_string())?;

    let buf = fetch_header_window(&url, INITIAL_WINDOW_MB).await?;
    let caps = capabilities_from_buffer(&buf)?;
    if !caps.truncated {
        return Ok(caps);
    }
    // Truncated — the template may be off-window. Widen once.
    let buf = fetch_header_window(&url, WIDE_WINDOW_MB).await?;
    capabilities_from_buffer(&buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // --- minimal GGUF header writer for fixtures -------------------------
    const GGUF_STRING: u32 = 8;
    const GGUF_UINT32: u32 = 4;
    const GGUF_ARRAY: u32 = 9;

    fn w_u32(buf: &mut Vec<u8>, v: u32) {
        buf.write_all(&v.to_le_bytes()).unwrap();
    }
    fn w_u64(buf: &mut Vec<u8>, v: u64) {
        buf.write_all(&v.to_le_bytes()).unwrap();
    }
    fn w_str(buf: &mut Vec<u8>, s: &str) {
        w_u64(buf, s.len() as u64);
        buf.write_all(s.as_bytes()).unwrap();
    }
    fn w_kv_str(buf: &mut Vec<u8>, key: &str, val: &str) {
        w_str(buf, key);
        w_u32(buf, GGUF_STRING);
        w_str(buf, val);
    }
    fn w_kv_u32(buf: &mut Vec<u8>, key: &str, val: u32) {
        w_str(buf, key);
        w_u32(buf, GGUF_UINT32);
        w_u32(buf, val);
    }
    /// A big string-array KV — stand-in for the vocab `tokenizer.ggml.tokens`.
    fn w_kv_big_array(buf: &mut Vec<u8>, key: &str, n: usize) {
        w_str(buf, key);
        w_u32(buf, GGUF_ARRAY);
        w_u32(buf, GGUF_STRING);
        w_u64(buf, n as u64);
        for i in 0..n {
            w_str(buf, &format!("tok{}", i));
        }
    }

    fn header(kv_count: u64) -> Vec<u8> {
        let mut buf = Vec::new();
        w_u32(&mut buf, 0x46475547); // "GGUF"
        w_u32(&mut buf, 3); // version
        w_u64(&mut buf, 0); // tensor count
        w_u64(&mut buf, kv_count); // kv count
        buf
    }

    #[test]
    fn detects_fim_coder_model() {
        let mut buf = header(5);
        w_kv_str(&mut buf, "general.architecture", "qwen2");
        w_kv_u32(&mut buf, "qwen2.context_length", 32768);
        w_kv_u32(&mut buf, "tokenizer.ggml.prefix_token_id", 1);
        w_kv_u32(&mut buf, "tokenizer.ggml.suffix_token_id", 2);
        w_kv_u32(&mut buf, "tokenizer.ggml.middle_token_id", 3);
        let caps = capabilities_from_buffer(&buf).unwrap();
        assert!(caps.has_fim_tokens);
        assert!(!caps.has_tool_template);
        assert_eq!(caps.context_length, Some(32768));
        assert_eq!(caps.architecture.as_deref(), Some("qwen2"));
        assert!(!caps.truncated);
    }

    #[test]
    fn detects_tool_template() {
        let mut buf = header(2);
        w_kv_str(&mut buf, "general.architecture", "llama");
        w_kv_str(
            &mut buf,
            "tokenizer.chat_template",
            "{% if tool_calls %}...{% endif %}",
        );
        let caps = capabilities_from_buffer(&buf).unwrap();
        assert!(caps.has_tool_template);
        assert!(!caps.has_fim_tokens);
    }

    #[test]
    fn detects_thinking_template() {
        let mut buf = header(2);
        w_kv_str(&mut buf, "general.architecture", "qwen3");
        w_kv_str(
            &mut buf,
            "tokenizer.chat_template",
            "render <think> reasoning here",
        );
        let caps = capabilities_from_buffer(&buf).unwrap();
        assert!(caps.has_thinking);
    }

    #[test]
    fn truncated_buffer_is_flagged_not_errored() {
        // Declare 3 KV pairs but only provide 1 fully, then cut off.
        let mut buf = header(3);
        w_kv_str(&mut buf, "general.architecture", "qwen2");
        // Begin a second pair then truncate mid-string.
        w_str(&mut buf, "tokenizer.chat_template");
        w_u32(&mut buf, GGUF_STRING);
        w_u64(&mut buf, 5000); // claims 5000 bytes...
        buf.extend_from_slice(b"short"); // ...but only 5 provided
        let caps = capabilities_from_buffer(&buf).unwrap();
        assert!(caps.truncated);
        assert_eq!(caps.architecture.as_deref(), Some("qwen2"));
    }

    #[test]
    fn large_vocab_array_does_not_prevent_later_keys() {
        // Architecture, a big token array, then the FIM ids after it — all
        // within one buffer (proves we parse past large arrays).
        let mut buf = header(5);
        w_kv_str(&mut buf, "general.architecture", "qwen2");
        w_kv_big_array(&mut buf, "tokenizer.ggml.tokens", 2000);
        w_kv_u32(&mut buf, "tokenizer.ggml.prefix_token_id", 1);
        w_kv_u32(&mut buf, "tokenizer.ggml.suffix_token_id", 2);
        w_kv_u32(&mut buf, "tokenizer.ggml.middle_token_id", 3);
        let caps = capabilities_from_buffer(&buf).unwrap();
        assert!(caps.has_fim_tokens);
        assert!(!caps.truncated);
    }
}
