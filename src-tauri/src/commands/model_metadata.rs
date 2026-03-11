use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;

use super::gguf_parser;
use super::local_inference::LocalInferenceState;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Merged metadata returned to the frontend.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ModelMetadata {
    // Identity
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantized_by: Option<String>,

    // Technical
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters_raw: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub architecture: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_length: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantization: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_length: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vocab_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub languages: Option<Vec<String>>,

    // Provenance
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hf_repo_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hf_repo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloads: Option<u64>,

    // Source tracking
    #[serde(default)]
    pub _sources: Vec<String>,
}

/// Raw HF API response fields we care about.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct HfModelMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub architecture: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_length: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloads: Option<u64>,
    // Cache metadata
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cached_at: Option<String>,
}

/// Runtime metadata from llama-server `/v1/models`.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct RuntimeModelMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_length: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding_length: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vocab_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

fn cache_base_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".notesage")
        .join("cache")
        .join("model-metadata")
}

fn hf_cache_path(repo_id: &str) -> PathBuf {
    let safe_name = repo_id.replace('/', "--");
    cache_base_dir().join("hf").join(format!("{}.json", safe_name))
}

fn gguf_cache_path(model_id: &str) -> PathBuf {
    cache_base_dir().join("gguf").join(format!("{}.json", model_id))
}

fn runtime_cache_path() -> PathBuf {
    cache_base_dir().join("runtime").join("active-model.json")
}

fn read_cache<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_cache<T: Serialize>(path: &Path, data: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create cache dir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize cache: {}", e))?;
    std::fs::write(path, json)
        .map_err(|e| format!("Failed to write cache: {}", e))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// HF API repo_id derivation
// ---------------------------------------------------------------------------

/// Extract repo_id from a HuggingFace URL.
/// e.g. "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/file.gguf" → "Qwen/Qwen3-4B-GGUF"
pub fn repo_id_from_url(url: &str) -> Option<String> {
    let url = url.strip_prefix("https://huggingface.co/")?;
    let parts: Vec<&str> = url.splitn(4, '/').collect();
    if parts.len() >= 2 {
        Some(format!("{}/{}", parts[0], parts[1]))
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// HF API fetcher
// ---------------------------------------------------------------------------

async fn fetch_hf_metadata_inner(repo_id: &str) -> Result<HfModelMetadata, String> {
    // Check cache first (24h TTL)
    let cache_path = hf_cache_path(repo_id);
    if let Some(cached) = read_cache::<HfModelMetadata>(&cache_path) {
        if let Some(ref cached_at) = cached.cached_at {
            if let Ok(cached_time) = chrono::DateTime::parse_from_rfc3339(cached_at) {
                let age = chrono::Utc::now().signed_duration_since(cached_time);
                if age.num_hours() < 24 {
                    return Ok(cached);
                }
            }
        }
    }

    let api_url = format!("https://huggingface.co/api/models/{}", repo_id);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client.get(&api_url).send().await;

    let response = match response {
        Ok(r) => r,
        Err(e) => {
            // Network failure: return cached data if available
            log::warn!(target: "notesage::model_metadata", "HF API request failed: {}", e);
            if let Some(cached) = read_cache::<HfModelMetadata>(&cache_path) {
                return Ok(cached);
            }
            return Err(format!("HF API request failed: {}", e));
        }
    };

    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        log::warn!(target: "notesage::model_metadata", "HF API rate limited (429)");
        if let Some(cached) = read_cache::<HfModelMetadata>(&cache_path) {
            return Ok(cached);
        }
        return Err("HF API rate limited".to_string());
    }

    if !response.status().is_success() {
        log::warn!(target: "notesage::model_metadata", "HF API returned {}", response.status());
        if let Some(cached) = read_cache::<HfModelMetadata>(&cache_path) {
            return Ok(cached);
        }
        return Err(format!("HF API error: {}", response.status()));
    }

    let json: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse HF API response: {}", e))?;

    let mut meta = HfModelMetadata::default();

    meta.author = json.get("author").and_then(|v| v.as_str()).map(|s| s.to_string());
    meta.last_modified = json.get("lastModified").and_then(|v| v.as_str()).map(|s| s.to_string());
    meta.downloads = json.get("downloads").and_then(|v| v.as_u64());

    // cardData fields
    if let Some(card) = json.get("cardData") {
        if meta.license.is_none() {
            meta.license = card.get("license").and_then(|v| v.as_str()).map(|s| s.to_string());
        }
        // base_model can be a string or array
        if let Some(bm) = card.get("base_model") {
            if let Some(s) = bm.as_str() {
                meta.base_model = Some(s.to_string());
            } else if let Some(arr) = bm.as_array() {
                meta.base_model = arr.first().and_then(|v| v.as_str()).map(|s| s.to_string());
            }
        }
    }

    // gguf fields (for GGUF repos)
    if let Some(gguf) = json.get("gguf") {
        meta.parameters = gguf.get("total").and_then(|v| v.as_u64());
        meta.architecture = gguf.get("architecture").and_then(|v| v.as_str()).map(|s| s.to_string());
        meta.context_length = gguf.get("context_length").and_then(|v| v.as_u64());
    }

    meta.cached_at = Some(chrono::Utc::now().to_rfc3339());

    // Write to cache
    if let Err(e) = write_cache(&cache_path, &meta) {
        log::warn!(target: "notesage::model_metadata", "Failed to cache HF metadata: {}", e);
    }

    Ok(meta)
}

// ---------------------------------------------------------------------------
// GGUF parsing with cache
// ---------------------------------------------------------------------------

fn parse_and_cache_gguf(model_id: &str, file_path: &Path) -> Result<gguf_parser::GgufMetadata, String> {
    let cache_path = gguf_cache_path(model_id);

    // Check if cache is fresh (mtime-based)
    if cache_path.exists() {
        if let (Ok(file_meta), Ok(cache_meta)) = (
            std::fs::metadata(file_path),
            std::fs::metadata(&cache_path),
        ) {
            if let (Ok(file_mtime), Ok(cache_mtime)) = (
                file_meta.modified(),
                cache_meta.modified(),
            ) {
                if cache_mtime > file_mtime {
                    if let Some(cached) = read_cache::<gguf_parser::GgufMetadata>(&cache_path) {
                        return Ok(cached);
                    }
                }
            }
        }
    }

    let meta = gguf_parser::parse_gguf_header(file_path)?;

    if let Err(e) = write_cache(&cache_path, &meta) {
        log::warn!(target: "notesage::model_metadata", "Failed to cache GGUF metadata: {}", e);
    }

    Ok(meta)
}

/// Public function for post-download GGUF parsing (Task 9).
pub fn parse_and_cache_gguf_for_model(model_id: &str, file_path: &Path) {
    match parse_and_cache_gguf(model_id, file_path) {
        Ok(_) => log::info!(target: "notesage::model_metadata", "Cached GGUF metadata for '{}'", model_id),
        Err(e) => log::warn!(target: "notesage::model_metadata", "Failed to parse GGUF for '{}': {}", model_id, e),
    }
}

// ---------------------------------------------------------------------------
// Runtime metadata fetcher
// ---------------------------------------------------------------------------

async fn fetch_runtime_metadata(port: u16) -> Result<RuntimeModelMetadata, String> {
    let url = format!("http://localhost:{}/v1/models", port);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client.get(&url).send().await
        .map_err(|e| format!("Runtime API request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Runtime API error: {}", response.status()));
    }

    let json: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse runtime response: {}", e))?;

    let mut meta = RuntimeModelMetadata::default();

    if let Some(data) = json.get("data").and_then(|v| v.as_array()) {
        if let Some(model) = data.first() {
            if let Some(model_meta) = model.get("meta") {
                meta.parameters = model_meta.get("n_params").and_then(|v| v.as_u64());
                meta.context_length = model_meta.get("n_ctx_train").and_then(|v| v.as_u64());
                meta.embedding_length = model_meta.get("n_embd").and_then(|v| v.as_u64());
                meta.vocab_size = model_meta.get("n_vocab").and_then(|v| v.as_u64());
                meta.file_size = model_meta.get("size").and_then(|v| v.as_u64());
            }
        }
    }

    // Cache for later use when server is stopped
    if let Err(e) = write_cache(&runtime_cache_path(), &meta) {
        log::warn!(target: "notesage::model_metadata", "Failed to cache runtime metadata: {}", e);
    }

    Ok(meta)
}

// ---------------------------------------------------------------------------
// Helper: format parameter count
// ---------------------------------------------------------------------------

fn format_params(raw: u64) -> String {
    if raw >= 1_000_000_000 {
        let b = raw as f64 / 1_000_000_000.0;
        if b == b.floor() {
            format!("{}B", b as u64)
        } else {
            format!("{:.1}B", b)
        }
    } else if raw >= 1_000_000 {
        let m = raw as f64 / 1_000_000.0;
        if m == m.floor() {
            format!("{}M", m as u64)
        } else {
            format!("{:.0}M", m)
        }
    } else {
        format!("{}", raw)
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn fetch_hf_metadata(repo_id: String) -> Result<HfModelMetadata, String> {
    fetch_hf_metadata_inner(&repo_id).await
}

#[tauri::command]
pub async fn parse_gguf_metadata(file_path: String) -> Result<gguf_parser::GgufMetadata, String> {
    let path = Path::new(&file_path);
    gguf_parser::parse_gguf_header(path)
}

#[tauri::command]
pub async fn get_runtime_model_metadata(port: u16) -> Result<RuntimeModelMetadata, String> {
    fetch_runtime_metadata(port).await
}

#[tauri::command]
pub async fn get_model_metadata(
    model_id: String,
    model_type: String,
    state: State<'_, LocalInferenceState>,
) -> Result<ModelMetadata, String> {
    let mut merged = ModelMetadata::default();

    // Source 1: Catalog defaults
    match model_type.as_str() {
        "llm" => {
            // Load from catalog via LocalInferenceState
            let models_dir = &state.models_dir;
            let all = super::local_inference::get_all_models_pub(models_dir);
            if let Some((entry, _)) = all.into_iter().find(|(e, _)| e.id == model_id) {
                merged.author = entry.author;
                merged.organization = entry.organization;
                merged.license = entry.license;
                merged.parameters = entry.parameters;
                merged.architecture = entry.architecture;
                merged.context_length = entry.context_length;
                merged.quantization = entry.quantization;
                merged.hf_repo_id = entry.hf_repo_id.clone();
                if let Some(ref repo_id) = entry.hf_repo_id {
                    merged.hf_repo_url = Some(format!("https://huggingface.co/{}", repo_id));
                }
                merged._sources.push("catalog".to_string());

                // Source 2: HF API cache
                if let Some(ref repo_id) = entry.hf_repo_id {
                    match fetch_hf_metadata_inner(repo_id).await {
                        Ok(hf) => {
                            if let Some(v) = hf.author { merged.author = Some(v); }
                            if let Some(v) = hf.license { merged.license = Some(v); }
                            if let Some(v) = hf.base_model { merged.base_model = Some(v); }
                            if let Some(v) = hf.architecture { merged.architecture = Some(v); }
                            if let Some(v) = hf.context_length { merged.context_length = Some(v); }
                            if let Some(v) = hf.last_modified { merged.last_modified = Some(v); }
                            if let Some(v) = hf.downloads { merged.downloads = Some(v); }
                            if let Some(raw) = hf.parameters {
                                merged.parameters_raw = Some(raw);
                                merged.parameters = Some(format_params(raw));
                            }
                            merged._sources.push("hf_api".to_string());
                        }
                        Err(e) => {
                            log::debug!(target: "notesage::model_metadata", "HF metadata unavailable for {}: {}", model_id, e);
                        }
                    }
                }

                // Source 3: GGUF header cache (if downloaded)
                let model_path = models_dir.join(&entry.filename);
                if model_path.exists() {
                    match parse_and_cache_gguf(&model_id, &model_path) {
                        Ok(gguf) => {
                            if let Some(v) = gguf.general_author { merged.author = Some(v); }
                            if let Some(v) = gguf.general_organization { merged.organization = Some(v); }
                            if let Some(v) = gguf.general_license { merged.license = Some(v); }
                            if let Some(v) = gguf.general_size_label { merged.parameters = Some(v); }
                            if let Some(v) = gguf.general_quantized_by { merged.quantized_by = Some(v); }
                            if let Some(v) = gguf.general_architecture { merged.architecture = Some(v); }
                            if let Some(v) = gguf.general_base_model_name { merged.base_model = Some(v); }
                            if let Some(v) = gguf.general_languages { merged.languages = Some(v); }
                            if let Some(v) = gguf.context_length { merged.context_length = Some(v); }
                            if let Some(v) = gguf.block_count { merged.block_count = Some(v); }
                            if let Some(v) = gguf.embedding_length { merged.embedding_length = Some(v); }
                            if let Some(ft) = gguf.general_file_type {
                                if let Some(q) = gguf_parser::file_type_to_quantization(ft) {
                                    merged.quantization = Some(q.to_string());
                                }
                            }
                            merged._sources.push("gguf_header".to_string());
                        }
                        Err(e) => {
                            log::debug!(target: "notesage::model_metadata", "GGUF parse unavailable for {}: {}", model_id, e);
                        }
                    }
                }

                // Source 4: Runtime cache (check if available)
                if let Some(cached) = read_cache::<RuntimeModelMetadata>(&runtime_cache_path()) {
                    if let Some(v) = cached.parameters {
                        merged.parameters_raw = Some(v);
                        merged.parameters = Some(format_params(v));
                    }
                    if let Some(v) = cached.context_length { merged.context_length = Some(v); }
                    if let Some(v) = cached.embedding_length { merged.embedding_length = Some(v); }
                    if let Some(v) = cached.vocab_size { merged.vocab_size = Some(v); }
                    merged._sources.push("runtime".to_string());
                }
            }
        }
        "whisper" => {
            // Whisper catalog defaults
            merged.author = Some("OpenAI".to_string());
            merged.license = Some("MIT".to_string());
            merged.hf_repo_id = Some("ggerganov/whisper.cpp".to_string());
            merged.hf_repo_url = Some("https://huggingface.co/ggerganov/whisper.cpp".to_string());
            merged._sources.push("catalog".to_string());

            // Map model_id to known parameters
            let params = match model_id.as_str() {
                "tiny" => Some("39M"),
                "base" => Some("74M"),
                "small" => Some("244M"),
                "medium" => Some("769M"),
                "large-v3" => Some("1550M"),
                _ => None,
            };
            if let Some(p) = params {
                merged.parameters = Some(p.to_string());
            }

            // HF API for whisper.cpp repo
            match fetch_hf_metadata_inner("ggerganov/whisper.cpp").await {
                Ok(hf) => {
                    if let Some(v) = hf.last_modified { merged.last_modified = Some(v); }
                    if let Some(v) = hf.downloads { merged.downloads = Some(v); }
                    merged._sources.push("hf_api".to_string());
                }
                Err(e) => {
                    log::debug!(target: "notesage::model_metadata", "HF metadata unavailable for whisper: {}", e);
                }
            }
        }
        _ => {
            return Err(format!("Unknown model type: {}", model_type));
        }
    }

    Ok(merged)
}
