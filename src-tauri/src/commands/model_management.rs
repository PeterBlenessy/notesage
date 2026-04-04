use serde::{Deserialize, Serialize};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use super::local_inference::LocalInferenceState;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LocalModelInfo {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub size_bytes: u64,
    pub ram_required_bytes: u64,
    pub downloaded: bool,
    pub description: String,
    pub huggingface_url: String,
    #[serde(default)]
    pub is_custom: bool,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub supports_fim: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub architecture: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_length: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantization: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hf_repo_id: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub supports_tool_calling: bool,
    #[serde(default)]
    pub supports_thinking: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_tags: Option<ThinkingTags>,
    #[serde(default)]
    pub supports_vision: bool,
    #[serde(default)]
    pub multilingual: bool,
    #[serde(default)]
    pub recommended_for: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ThinkingTags {
    pub open: String,
    pub close: String,
}

/// A model entry in the catalog (curated or custom).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CatalogEntry {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub size_bytes: u64,
    pub ram_required_bytes: u64,
    pub description: String,
    pub huggingface_url: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub supports_fim: bool,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub organization: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub parameters: Option<String>,
    #[serde(default)]
    pub architecture: Option<String>,
    #[serde(default)]
    pub context_length: Option<u64>,
    #[serde(default)]
    pub quantization: Option<String>,
    #[serde(default)]
    pub hf_repo_id: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub supports_tool_calling: bool,
    #[serde(default)]
    pub supports_thinking: bool,
    #[serde(default)]
    pub thinking_tags: Option<ThinkingTags>,
    #[serde(default)]
    pub supports_vision: bool,
    #[serde(default)]
    pub multilingual: bool,
    #[serde(default)]
    pub recommended_for: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SystemMemoryInfo {
    pub total_bytes: u64,
    pub available_bytes: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct BinaryStatus {
    pub available: bool,
    pub location: String,  // "bundled", "managed", "system", "not_found"
    pub path: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct DiagnosticFile {
    pub name: String,
    pub size_bytes: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct LocalAIDiagnostics {
    pub binary_available: bool,
    pub binary_location: String,
    pub binary_path: Option<String>,
    pub models_dir: String,
    pub models_dir_exists: bool,
    pub models_on_disk: Vec<DiagnosticFile>,
    pub stale_files: Vec<DiagnosticFile>,
}

// ---------------------------------------------------------------------------
// Model registry — loaded from JSON catalog + user custom models
// ---------------------------------------------------------------------------

/// Bundled catalog embedded at compile time.
static BUNDLED_CATALOG: &str = include_str!("../../model-catalog.json");

/// Load the curated model catalog.
fn load_curated_catalog() -> Vec<CatalogEntry> {
    serde_json::from_str(BUNDLED_CATALOG).unwrap_or_default()
}

/// Load user custom models from `~/.notesage/models/llm/custom-models.json`.
fn load_custom_models(models_dir: &std::path::Path) -> Vec<CatalogEntry> {
    let path = models_dir.join("custom-models.json");
    if let Ok(content) = std::fs::read_to_string(&path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    }
}

/// Save user custom models.
fn save_custom_models(models_dir: &std::path::Path, models: &[CatalogEntry]) -> Result<(), String> {
    let path = models_dir.join("custom-models.json");
    let json = serde_json::to_string_pretty(models)
        .map_err(|e| format!("Failed to serialize custom models: {}", e))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write custom models: {}", e))?;
    Ok(())
}

/// Get all models (curated + custom), marking custom entries. Public for model_metadata module.
pub fn get_all_models_pub(models_dir: &std::path::Path) -> Vec<(CatalogEntry, bool)> {
    get_all_models(models_dir)
}

/// Get all models (curated + custom), marking custom entries.
fn get_all_models(models_dir: &std::path::Path) -> Vec<(CatalogEntry, bool)> {
    let mut all: Vec<(CatalogEntry, bool)> = load_curated_catalog()
        .into_iter()
        .map(|e| (e, false))
        .collect();
    let custom = load_custom_models(models_dir);
    for entry in custom {
        // Skip duplicates (custom with same id as curated)
        if all.iter().any(|(e, _)| e.id == entry.id) {
            continue;
        }
        all.push((entry, true));
    }
    all
}

/// Find a model entry by ID across curated + custom catalogs.
pub fn find_model_entry(models_dir: &std::path::Path, model_id: &str) -> Option<CatalogEntry> {
    get_all_models(models_dir)
        .into_iter()
        .find(|(e, _)| e.id == model_id)
        .map(|(e, _)| e)
}

// ---------------------------------------------------------------------------
// System memory
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_system_memory() -> Result<SystemMemoryInfo, String> {
    use sysinfo::System;
    let sys = System::new_with_specifics(
        sysinfo::RefreshKind::nothing().with_memory(sysinfo::MemoryRefreshKind::everything()),
    );
    Ok(SystemMemoryInfo {
        total_bytes: sys.total_memory(),
        available_bytes: sys.available_memory(),
    })
}

// ---------------------------------------------------------------------------
// Model listing
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_local_models(
    state: State<'_, LocalInferenceState>,
) -> Result<Vec<LocalModelInfo>, String> {
    let models_dir = state.models_dir();
    std::fs::create_dir_all(models_dir)
        .map_err(|e| format!("Failed to create models directory: {}", e))?;

    let models = get_all_models(models_dir)
        .into_iter()
        .map(|(entry, is_custom)| {
            let path = models_dir.join(&entry.filename);
            LocalModelInfo {
                id: entry.id,
                name: entry.name,
                filename: entry.filename,
                size_bytes: entry.size_bytes,
                ram_required_bytes: entry.ram_required_bytes,
                downloaded: path.exists(),
                description: entry.description,
                huggingface_url: entry.huggingface_url,
                is_custom,
                source: if is_custom { "Custom".to_string() } else { entry.source },
                supports_fim: entry.supports_fim,
                author: entry.author,
                organization: entry.organization,
                license: entry.license,
                parameters: entry.parameters,
                architecture: entry.architecture,
                context_length: entry.context_length,
                quantization: entry.quantization,
                hf_repo_id: entry.hf_repo_id,
                category: entry.category,
                supports_tool_calling: entry.supports_tool_calling,
                supports_thinking: entry.supports_thinking,
                thinking_tags: entry.thinking_tags,
                supports_vision: entry.supports_vision,
                multilingual: entry.multilingual,
                recommended_for: entry.recommended_for,
            }
        })
        .collect();

    Ok(models)
}

// ---------------------------------------------------------------------------
// Model download
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn download_local_model(
    app: AppHandle,
    state: State<'_, LocalInferenceState>,
    model_id: String,
) -> Result<(), String> {
    let models_dir = state.models_dir();
    let entry = find_model_entry(models_dir, &model_id)
        .ok_or_else(|| format!("Unknown model: {}", model_id))?;

    let cancel = Arc::new(AtomicBool::new(false));
    if !state.register_download(&model_id, cancel.clone()) {
        return Err(format!("Model '{}' is already being downloaded", model_id));
    }

    let result = download_model_inner(&app, models_dir, &entry, &cancel).await;

    state.unregister_download(&model_id);

    result
}

async fn download_model_inner(
    app: &AppHandle,
    models_dir: &std::path::Path,
    entry: &CatalogEntry,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    use futures::StreamExt;

    std::fs::create_dir_all(models_dir)
        .map_err(|e| format!("Failed to create models directory: {}", e))?;

    let final_path = models_dir.join(&entry.filename);
    let temp_path = models_dir.join(format!("{}.downloading", &entry.filename));

    let _ = std::fs::remove_file(&temp_path);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&entry.huggingface_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let total = response.content_length().unwrap_or(entry.size_bytes);
    let mut downloaded: u64 = 0;
    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    let mut stream = response.bytes_stream();
    let mut last_percent: u64 = 0;

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            drop(file);
            let _ = std::fs::remove_file(&temp_path);
            return Err("Download cancelled".to_string());
        }

        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        use std::io::Write;
        file.write_all(&chunk)
            .map_err(|e| format!("Write error: {}", e))?;

        downloaded += chunk.len() as u64;

        let percent = if total > 0 { (downloaded * 100) / total } else { 0 };
        if percent != last_percent {
            last_percent = percent;
            let _ = app.emit(
                "local-model-download-progress",
                serde_json::json!({
                    "model": entry.id,
                    "downloaded": downloaded,
                    "total": total
                }),
            );
        }
    }

    drop(file);
    std::fs::rename(&temp_path, &final_path)
        .map_err(|e| format!("Failed to finalize download: {}", e))?;

    log::info!(target: "notesage::local_ai", "Downloaded model '{}' ({} bytes)", entry.id, downloaded);

    // Auto-parse GGUF header and cache metadata (Task 9)
    if entry.filename.ends_with(".gguf") {
        super::model_metadata::parse_and_cache_gguf_for_model(&entry.id, &final_path);
    }

    Ok(())
}

#[tauri::command]
pub async fn cancel_local_model_download(
    state: State<'_, LocalInferenceState>,
    model_id: String,
) -> Result<(), String> {
    if state.cancel_download(&model_id) {
        Ok(())
    } else {
        Err(format!("No active download for model '{}'", model_id))
    }
}

#[tauri::command]
pub async fn delete_local_model(
    state: State<'_, LocalInferenceState>,
    model_id: String,
) -> Result<(), String> {
    if state.is_active_model(&model_id).await {
        return Err("Cannot delete the currently active model. Stop the server first.".to_string());
    }

    let models_dir = state.models_dir();
    let entry = find_model_entry(models_dir, &model_id)
        .ok_or_else(|| format!("Unknown model: {}", model_id))?;

    let path = models_dir.join(&entry.filename);
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete model: {}", e))?;
        log::info!(target: "notesage::local_ai", "Deleted model '{}'", model_id);
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Custom model management
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn add_custom_local_model(
    state: State<'_, LocalInferenceState>,
    name: String,
    url: String,
    supports_tool_calling: Option<bool>,
    supports_thinking: Option<bool>,
    supports_vision: Option<bool>,
    multilingual: Option<bool>,
    supports_fim: Option<bool>,
    author: Option<String>,
    architecture: Option<String>,
    context_length: Option<u64>,
    license: Option<String>,
    base_model: Option<String>,
) -> Result<LocalModelInfo, String> {
    // Validate URL
    if !url.contains("huggingface.co") && !url.ends_with(".gguf") {
        return Err("URL must point to a .gguf file (Hugging Face recommended)".to_string());
    }

    // Derive filename from URL
    let filename = url
        .split('/')
        .next_back()
        .unwrap_or("custom-model.gguf")
        .to_string();

    // Derive ID from filename (lowercase, stripped of extension)
    let id = filename
        .replace(".gguf", "")
        .to_lowercase()
        .replace(' ', "-");

    let models_dir = state.models_dir();

    // Check for duplicate IDs
    if find_model_entry(models_dir, &id).is_some() {
        return Err(format!("A model with ID '{}' already exists", id));
    }

    std::fs::create_dir_all(models_dir)
        .map_err(|e| format!("Failed to create models directory: {}", e))?;

    // Probe the URL to get file size (HEAD request)
    let size_bytes = match reqwest::Client::new().head(&url).send().await {
        Ok(resp) => resp.content_length().unwrap_or(0),
        Err(_) => 0,
    };

    // Try to derive hf_repo_id from URL
    let hf_repo_id = super::model_metadata::repo_id_from_url(&url);

    // Build a useful description from capabilities and metadata
    let mut desc_parts: Vec<&str> = Vec::new();
    if let Some(ref bm) = base_model {
        // Extract org from base_model like "google/gemma-4-E4B-it" → "Google"
        if let Some(org) = bm.split('/').next() {
            let capitalized = org.chars().next().map(|c| c.to_uppercase().to_string()).unwrap_or_default()
                + &org[1..];
            desc_parts.push(Box::leak(capitalized.into_boxed_str()));
        }
    } else if let Some(ref a) = author {
        desc_parts.push(Box::leak(a.clone().into_boxed_str()));
    }
    let mut caps: Vec<&str> = Vec::new();
    if supports_vision.unwrap_or(false) { caps.push("vision"); }
    if supports_thinking.unwrap_or(false) { caps.push("thinking"); }
    if supports_tool_calling.unwrap_or(false) { caps.push("tool calling"); }
    if supports_fim.unwrap_or(false) { caps.push("code completion"); }
    if !caps.is_empty() {
        let joined = caps.join(", ");
        desc_parts.push(Box::leak(format!("with {}", joined).into_boxed_str()));
    }
    let description = if desc_parts.is_empty() {
        "Custom model".to_string()
    } else {
        format!("{}.", desc_parts.join(". ").trim_end_matches('.'))
    };

    let quant = extract_quantization(&filename);

    let entry = CatalogEntry {
        id: id.clone(),
        name: name.clone(),
        filename: filename.clone(),
        size_bytes,
        ram_required_bytes: (size_bytes as f64 * 1.3) as u64,
        description,
        huggingface_url: url,
        source: "Custom".to_string(),
        supports_fim: supports_fim.unwrap_or(false),
        author,
        organization: base_model.as_ref().and_then(|bm| bm.split('/').next().map(|s| s.to_string())),
        license,
        parameters: None,
        architecture,
        context_length,
        quantization: if quant != "Unknown" { Some(quant) } else { None },
        hf_repo_id,
        category: None,
        supports_tool_calling: supports_tool_calling.unwrap_or(false),
        supports_thinking: supports_thinking.unwrap_or(false),
        thinking_tags: None,
        supports_vision: supports_vision.unwrap_or(false),
        multilingual: multilingual.unwrap_or(false),
        recommended_for: vec![],
    };

    let mut custom = load_custom_models(models_dir);
    custom.push(entry.clone());
    save_custom_models(models_dir, &custom)?;

    log::info!(target: "notesage::local_ai", "Added custom model '{}' ({})", name, id);

    Ok(LocalModelInfo {
        id: entry.id,
        name: entry.name,
        filename: entry.filename,
        size_bytes: entry.size_bytes,
        ram_required_bytes: entry.ram_required_bytes,
        downloaded: false,
        description: entry.description,
        huggingface_url: entry.huggingface_url,
        is_custom: true,
        source: "Custom".to_string(),
        supports_fim: false,
        author: entry.author,
        organization: entry.organization,
        license: entry.license,
        parameters: entry.parameters,
        architecture: entry.architecture,
        context_length: entry.context_length,
        quantization: entry.quantization,
        hf_repo_id: entry.hf_repo_id,
        category: entry.category,
        supports_tool_calling: entry.supports_tool_calling,
        supports_thinking: entry.supports_thinking,
        thinking_tags: entry.thinking_tags,
        supports_vision: entry.supports_vision,
        multilingual: entry.multilingual,
        recommended_for: entry.recommended_for,
    })
}

#[tauri::command]
pub async fn remove_custom_local_model(
    state: State<'_, LocalInferenceState>,
    model_id: String,
) -> Result<(), String> {
    // Don't allow removing curated models
    let curated = load_curated_catalog();
    if curated.iter().any(|e| e.id == model_id) {
        return Err("Cannot remove a built-in model".to_string());
    }

    // Check if it's the active model
    if state.is_active_model(&model_id).await {
        return Err("Cannot remove the currently active model. Stop the server first.".to_string());
    }

    let models_dir = state.models_dir();

    // Delete the model file if downloaded
    if let Some(entry) = find_model_entry(models_dir, &model_id) {
        let path = models_dir.join(&entry.filename);
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to delete model file: {}", e))?;
        }
    }

    // Remove from custom-models.json
    let mut custom = load_custom_models(models_dir);
    custom.retain(|e| e.id != model_id);
    save_custom_models(models_dir, &custom)?;

    log::info!(target: "notesage::local_ai", "Removed custom model '{}'", model_id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Hugging Face GGUF model search
// ---------------------------------------------------------------------------

/// A search result from the Hugging Face API for GGUF models.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HfModelSearchResult {
    pub repo_id: String,
    pub model_name: String,
    pub author: String,
    pub base_model: Option<String>,
    pub license: Option<String>,
    pub architecture: Option<String>,
    pub context_length: Option<u64>,
    pub total_size: Option<u64>,
    pub downloads: u64,
    pub likes: u64,
    pub tags: Vec<String>,
    pub supports_tool_calling: bool,
    pub supports_thinking: bool,
    pub supports_vision: bool,
    pub files: Vec<HfModelFile>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HfModelFile {
    pub filename: String,
    pub size_bytes: u64,
    pub download_url: String,
    pub quantization: String,
}

/// Raw HF API model response fields we care about.
#[derive(Deserialize, Debug)]
struct HfApiModel {
    #[serde(rename = "modelId")]
    model_id: Option<String>,
    #[serde(default)]
    id: String,
    #[allow(dead_code)]
    #[serde(default)]
    author: String,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    likes: u64,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    siblings: Vec<HfApiSibling>,
    #[serde(default)]
    config: Option<HfApiConfig>,
    #[serde(default)]
    gguf: Option<HfApiGguf>,
    #[serde(default, rename = "cardData")]
    card_data: Option<HfApiCardData>,
}

#[derive(Deserialize, Debug, Default)]
struct HfApiConfig {
    #[serde(default)]
    model_type: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
struct HfApiGguf {
    #[serde(default)]
    architecture: Option<String>,
    #[serde(default)]
    context_length: Option<u64>,
    #[serde(default)]
    total: Option<u64>,
    #[serde(default)]
    chat_template: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
struct HfApiCardData {
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    base_model: Option<serde_json::Value>,
    #[serde(default)]
    quantized_by: Option<String>,
}

#[derive(Deserialize, Debug)]
struct HfApiSibling {
    rfilename: String,
    #[serde(default)]
    size: Option<u64>,
}

/// Derive quantization label from GGUF filename (e.g. "Q4_K_M" from "model-Q4_K_M.gguf").
fn extract_quantization(filename: &str) -> String {
    // Common GGUF quant patterns: Q4_K_M, Q8_0, IQ4_XS, F16, etc.
    let name = filename.trim_end_matches(".gguf");
    // Try to find the last segment that looks like a quantization
    if let Some(pos) = name.rfind('-') {
        let suffix = &name[pos + 1..];
        if suffix.starts_with('Q') || suffix.starts_with('F') || suffix.starts_with("IQ") || suffix.starts_with("BF") {
            return suffix.to_string();
        }
    }
    if let Some(pos) = name.rfind('_') {
        // Could be like model_Q4_K_M — check the rest
        let rest = &name[pos + 1..];
        if rest.starts_with('Q') || rest.starts_with('F') || rest.starts_with("IQ") {
            return rest.to_string();
        }
    }
    // Fallback: scan for known patterns with underscores (e.g. "model-name-Q4_K_M")
    for part in name.rsplitn(4, '-') {
        if part.starts_with('Q') || part.starts_with('F') || part.starts_with("IQ") || part.starts_with("BF") {
            return part.to_string();
        }
    }
    "Unknown".to_string()
}

/// Search Hugging Face for GGUF model repos.
#[tauri::command]
pub async fn search_huggingface_models(
    query: String,
    limit: Option<usize>,
    author: Option<String>,
) -> Result<Vec<HfModelSearchResult>, String> {
    let limit = limit.unwrap_or(20).min(30);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    // HF API search: filter for GGUF models
    let author_param = author.map(|a| format!("&author={a}")).unwrap_or_default();
    let search_url = format!(
        "https://huggingface.co/api/models?search={query}+GGUF&filter=gguf&sort=downloads&direction=-1&limit={limit}{author_param}&expand[]=siblings&expand[]=tags&expand[]=config&expand[]=gguf&expand[]=cardData"
    );

    let resp = client
        .get(&search_url)
        .header("User-Agent", "Notesage/1.0")
        .send()
        .await
        .map_err(|e| format!("HF API request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HF API returned status {}", resp.status()));
    }

    let models: Vec<HfApiModel> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse HF API response: {}", e))?;

    let results: Vec<HfModelSearchResult> = models
        .into_iter()
        .map(|m| {
            let repo_id = m.model_id.unwrap_or(m.id.clone());
            // Filter to only .gguf files
            let files: Vec<HfModelFile> = m
                .siblings
                .into_iter()
                .filter(|s| s.rfilename.ends_with(".gguf"))
                .map(|s| {
                    let quant = extract_quantization(&s.rfilename);
                    let url = format!(
                        "https://huggingface.co/{}/resolve/main/{}",
                        repo_id, s.rfilename
                    );
                    HfModelFile {
                        filename: s.rfilename,
                        size_bytes: s.size.unwrap_or(0),
                        download_url: url,
                        quantization: quant,
                    }
                })
                .collect();

            // Derive a friendly model name — prefer base_model for pretty names
            let base_model = m.card_data.as_ref().and_then(|c| {
                match &c.base_model {
                    Some(serde_json::Value::String(s)) => Some(s.clone()),
                    Some(serde_json::Value::Array(arr)) => arr.first().and_then(|v| v.as_str().map(|s| s.to_string())),
                    _ => None,
                }
            });
            let model_name = base_model.as_ref()
                .and_then(|bm| bm.split('/').last().map(|s| s.replace('-', " ").replace('_', " ")))
                .unwrap_or_else(|| {
                    repo_id.split('/').last().unwrap_or(&repo_id)
                        .replace("-GGUF", "").replace("_", " ")
                });

            let gguf = m.gguf.unwrap_or_default();
            let chat_template = gguf.chat_template.unwrap_or_default();
            let supports_tool_calling = chat_template.contains("tool_call") || chat_template.contains("tool_response");
            let supports_thinking = chat_template.contains("thinking") || chat_template.contains("enable_thinking");
            let supports_vision = m.tags.iter().any(|t| t == "image-text-to-text");

            HfModelSearchResult {
                repo_id: repo_id.clone(),
                model_name,
                author: m.card_data.as_ref()
                    .and_then(|c| c.quantized_by.clone())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| repo_id.split('/').next().unwrap_or("").to_string()),
                base_model,
                license: m.card_data.as_ref().and_then(|c| c.license.clone()),
                architecture: gguf.architecture.or_else(|| m.config.and_then(|c| c.model_type)),
                context_length: gguf.context_length,
                total_size: gguf.total,
                downloads: m.downloads,
                likes: m.likes,
                tags: m.tags,
                supports_tool_calling,
                supports_thinking,
                supports_vision,
                files,
            }
        })
        .filter(|r| !r.files.is_empty())
        .collect();

    Ok(results)
}

/// Rich model details fetched from the individual HF model endpoint.
#[derive(Serialize, Clone, Debug)]
pub struct HfModelDetails {
    pub repo_id: String,
    pub model_name: String,
    pub author: String,
    pub base_model: Option<String>,
    pub license: Option<String>,
    pub architecture: Option<String>,
    pub context_length: Option<u64>,
    pub pipeline_tag: Option<String>,
    pub downloads: u64,
    pub likes: u64,
    pub supports_tool_calling: bool,
    pub supports_thinking: bool,
    pub supports_vision: bool,
    pub supports_fim: bool,
    pub multilingual: bool,
    pub files: Vec<HfModelFile>,
}

/// Raw HF API individual model response.
#[derive(Deserialize, Debug)]
struct HfApiModelDetail {
    #[serde(default)]
    id: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    likes: u64,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    siblings: Vec<HfApiSibling>,
    #[serde(default)]
    pipeline_tag: Option<String>,
    #[serde(default, rename = "cardData")]
    card_data: Option<HfCardData>,
    #[serde(default)]
    gguf: Option<HfGgufData>,
}

#[derive(Deserialize, Debug, Default)]
struct HfCardData {
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    base_model: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
struct HfGgufData {
    #[serde(default)]
    architecture: Option<String>,
    #[serde(default)]
    context_length: Option<u64>,
    #[serde(default)]
    chat_template: Option<String>,
    #[allow(dead_code)]
    #[serde(default)]
    total: Option<u64>,
}

/// Fetch rich details for a specific HF model repo.
#[tauri::command]
pub async fn fetch_hf_model_details(
    repo_id: String,
) -> Result<HfModelDetails, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let url = format!("https://huggingface.co/api/models/{repo_id}");
    let resp = client
        .get(&url)
        .header("User-Agent", "Notesage/1.0")
        .send()
        .await
        .map_err(|e| format!("HF API request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("HF API returned status {}", resp.status()));
    }

    let model: HfApiModelDetail = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse HF model response: {}", e))?;

    let repo = model.id.clone();
    let gguf = model.gguf.unwrap_or_default();
    let card = model.card_data.unwrap_or_default();
    let chat_template = gguf.chat_template.unwrap_or_default();

    // Derive capabilities from chat template and tags
    let supports_tool_calling = chat_template.contains("tool_call") || chat_template.contains("tool_response");
    let supports_thinking = chat_template.contains("thinking") || chat_template.contains("enable_thinking");
    let supports_vision = model.pipeline_tag.as_deref() == Some("image-text-to-text")
        || model.tags.iter().any(|t| t == "image-text-to-text");
    let supports_fim = chat_template.contains("fim_prefix") || chat_template.contains("<|fim");
    let lang_codes = model.tags.iter().filter(|t| t.len() == 2 && t.chars().all(|c| c.is_ascii_lowercase())).count();
    let multilingual = lang_codes > 3;

    // Derive model name
    let model_name = repo
        .split('/')
        .last()
        .unwrap_or(&repo)
        .replace("-GGUF", "")
        .replace("_", " ");

    // Build file list with sizes from tree endpoint
    let tree_url = format!("https://huggingface.co/api/models/{repo}/tree/main");
    let tree_files: Vec<HfModelFile> = match client
        .get(&tree_url)
        .header("User-Agent", "Notesage/1.0")
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => {
            #[derive(Deserialize)]
            struct TreeEntry {
                #[serde(default)]
                path: String,
                #[serde(default)]
                size: Option<u64>,
            }
            let entries: Vec<TreeEntry> = resp.json().await.unwrap_or_default();
            entries
                .into_iter()
                .filter(|e| e.path.ends_with(".gguf") && !e.path.contains("mmproj"))
                .map(|e| {
                    let quant = extract_quantization(&e.path);
                    let download_url = format!(
                        "https://huggingface.co/{}/resolve/main/{}",
                        repo, e.path
                    );
                    HfModelFile {
                        filename: e.path,
                        size_bytes: e.size.unwrap_or(0),
                        download_url,
                        quantization: quant,
                    }
                })
                .collect()
        }
        _ => {
            // Fallback to siblings (no sizes)
            model.siblings
                .into_iter()
                .filter(|s| s.rfilename.ends_with(".gguf") && !s.rfilename.contains("mmproj"))
                .map(|s| {
                    let quant = extract_quantization(&s.rfilename);
                    let download_url = format!(
                        "https://huggingface.co/{}/resolve/main/{}",
                        repo, s.rfilename
                    );
                    HfModelFile {
                        filename: s.rfilename,
                        size_bytes: s.size.unwrap_or(0),
                        download_url,
                        quantization: quant,
                    }
                })
                .collect()
        }
    };

    Ok(HfModelDetails {
        repo_id: repo,
        model_name,
        author: model.author,
        base_model: card.base_model,
        license: card.license,
        architecture: gguf.architecture,
        context_length: gguf.context_length,
        pipeline_tag: model.pipeline_tag,
        downloads: model.downloads,
        likes: model.likes,
        supports_tool_calling,
        supports_thinking,
        supports_vision,
        supports_fim,
        multilingual,
        files: tree_files,
    })
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

/// Find an available TCP port starting from `start`.
pub fn find_available_port(start: u16) -> Option<u16> {
    for port in start..start + 100 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Some(port);
        }
    }
    None
}

/// Get the Tauri sidecar binary name (with target triple suffix for prod builds).
fn sidecar_binary_name() -> String {
    let triple = format!("{}-{}", std::env::consts::ARCH, match std::env::consts::OS {
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-gnu",
        "windows" => "pc-windows-msvc",
        _ => "unknown",
    });
    format!("llama-server-{}", triple)
}

/// Resolve the llama-server binary path.
/// Checks: 1) next to the app executable (bundled sidecar), 2) dev source dir, 3) PATH
pub fn resolve_llama_server_binary() -> Result<PathBuf, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.to_path_buf()));

    if let Some(ref dir) = exe_dir {
        // 1. Bundled sidecar — next to the app executable
        if let Some(path) = resolve_bundled_sidecar(dir) {
            return Ok(path);
        }

        // 2. Dev mode fallback — source binaries directory (survives cargo clean)
        if let Some(path) = resolve_dev_binary(dir) {
            return Ok(path);
        }
    }

    // 3. System PATH
    if let Some(path) = resolve_system_path() {
        return Ok(path);
    }

    log::warn!(target: "notesage::local_ai", "llama-server binary not found at any resolution path");
    Err(
        "llama-server binary not found. It should be bundled with the app or available in PATH."
            .to_string(),
    )
}

/// Check for bundled sidecar next to the executable directory.
fn resolve_bundled_sidecar(exe_dir: &std::path::Path) -> Option<PathBuf> {
    let candidates = [sidecar_binary_name(), "llama-server".to_string()];
    for name in &candidates {
        let binary = exe_dir.join(name);
        let exists = binary.exists();
        log::debug!(target: "notesage::local_ai", "Binary check: {} exists={}", binary.display(), exists);
        if exists {
            let is_dev = exe_dir.to_string_lossy().contains("/target/");
            if !is_dev || exe_dir.join("lib").exists() {
                log::info!(target: "notesage::local_ai", "Resolved binary: {} ({})", binary.display(), if is_dev { "dev" } else { "bundled" });
                return Some(binary);
            }
            log::debug!(target: "notesage::local_ai", "Skipping {} — dev mode and lib/ not found", binary.display());
        }
    }
    None
}

/// Check dev source binaries directory (survives cargo clean).
fn resolve_dev_binary(exe_dir: &std::path::Path) -> Option<PathBuf> {
    let triple = format!("{}-{}", std::env::consts::ARCH, match std::env::consts::OS {
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-gnu",
        _ => "",
    });
    // Walk up from target/debug/ to src-tauri/binaries/
    let src_tauri = exe_dir.parent()?.parent()?;
    let dev_binary = src_tauri.join("binaries").join(format!("llama-server-{}", triple));
    let exists = dev_binary.exists();
    log::debug!(target: "notesage::local_ai", "Dev fallback check: {} exists={}", dev_binary.display(), exists);
    if exists {
        log::info!(target: "notesage::local_ai", "Resolved binary: {} (dev fallback)", dev_binary.display());
        return Some(dev_binary);
    }
    None
}

/// Check system PATH via `which`.
fn resolve_system_path() -> Option<PathBuf> {
    let output = std::process::Command::new("which")
        .arg("llama-server")
        .output()
        .ok()?;
    if output.status.success() {
        let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path_str.is_empty() {
            log::info!(target: "notesage::local_ai", "Resolved binary: {} (system PATH)", path_str);
            return Some(PathBuf::from(path_str));
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Binary availability check
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn check_llama_server_available() -> Result<BinaryStatus, String> {
    // Check for stale ~/.notesage/bin/ leftovers from legacy download feature
    if let Some(home) = dirs::home_dir() {
        let stale_bin_dir = home.join(".notesage").join("bin");
        if stale_bin_dir.exists() {
            let stale_size = dir_total_size(&stale_bin_dir);
            log::warn!(
                target: "notesage::local_ai",
                "Stale ~/.notesage/bin/ directory found ({} bytes) — this is a leftover from a previous version and can be safely deleted",
                stale_size
            );
        }
    }

    // Use the same resolution logic as start_local_server
    match resolve_llama_server_binary() {
        Ok(path) => {
            let location = if path.to_string_lossy().contains("/target/") || path.to_string_lossy().contains("/binaries/") {
                "dev"
            } else if path.to_string_lossy().contains("/usr/") || path.to_string_lossy().contains("/bin/") {
                "system"
            } else {
                "bundled"
            };
            Ok(BinaryStatus {
                available: true,
                location: location.to_string(),
                path: Some(path.to_string_lossy().to_string()),
            })
        }
        Err(_) => Ok(BinaryStatus {
            available: false,
            location: "not_found".to_string(),
            path: None,
        }),
    }
}

/// Calculate total size of a directory recursively.
pub fn dir_total_size(dir: &std::path::Path) -> u64 {
    let mut total: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    total += meta.len();
                } else if meta.is_dir() {
                    total += dir_total_size(&entry.path());
                }
            }
        }
    }
    total
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/// Collect Local AI diagnostic info for the diagnostics export.
pub fn collect_local_ai_diagnostics() -> LocalAIDiagnostics {
    let binary = resolve_llama_server_binary();
    let (binary_available, binary_location, binary_path) = match &binary {
        Ok(path) => {
            let loc = if path.to_string_lossy().contains("/target/") || path.to_string_lossy().contains("/binaries/") {
                "dev"
            } else if path.to_string_lossy().contains("/usr/") || path.to_string_lossy().contains("/bin/") {
                "system"
            } else {
                "bundled"
            };
            (true, loc.to_string(), Some(path.to_string_lossy().to_string()))
        }
        Err(_) => (false, "not_found".to_string(), None),
    };

    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let models_dir = home.join(".notesage").join("models").join("llm");
    let bin_dir = home.join(".notesage").join("bin");

    // Scan for model files on disk
    let models_on_disk = if models_dir.exists() {
        std::fs::read_dir(&models_dir)
            .map(|entries| {
                entries
                    .flatten()
                    .filter_map(|e| {
                        let meta = e.metadata().ok()?;
                        if meta.is_file() {
                            Some(DiagnosticFile {
                                name: e.file_name().to_string_lossy().to_string(),
                                size_bytes: meta.len(),
                            })
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    } else {
        vec![]
    };

    // Detect stale files
    let mut stale_files: Vec<DiagnosticFile> = vec![];

    // Stale ~/.notesage/bin/ leftovers
    if bin_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&bin_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    stale_files.push(DiagnosticFile {
                        name: format!("~/.notesage/bin/{}", entry.file_name().to_string_lossy()),
                        size_bytes: if meta.is_dir() { dir_total_size(&entry.path()) } else { meta.len() },
                    });
                }
            }
        }
    }

    // Stale .tmp / .part files in models dir
    if models_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&models_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".tmp") || name.ends_with(".part") {
                    if let Ok(meta) = entry.metadata() {
                        stale_files.push(DiagnosticFile {
                            name: format!("~/.notesage/models/llm/{}", name),
                            size_bytes: meta.len(),
                        });
                    }
                }
            }
        }
    }

    LocalAIDiagnostics {
        binary_available,
        binary_location,
        binary_path,
        models_dir: models_dir.to_string_lossy().to_string(),
        models_dir_exists: models_dir.exists(),
        models_on_disk,
        stale_files,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_resolve_bundled_sidecar_prod() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();

        // Create a binary with the sidecar name (simulating prod)
        let binary_name = sidecar_binary_name();
        fs::write(dir.join(&binary_name), b"fake binary").unwrap();

        let result = resolve_bundled_sidecar(dir);
        assert!(result.is_some(), "Should find bundled sidecar in prod-like dir");
        assert!(result.unwrap().ends_with(&binary_name));
    }

    #[test]
    fn test_resolve_bundled_sidecar_dev_with_lib() {
        // Dev mode: dir contains /target/, but lib/ exists → should resolve
        let tmp = tempfile::tempdir().unwrap();
        let target_dir = tmp.path().join("some").join("target").join("debug");
        fs::create_dir_all(&target_dir).unwrap();
        fs::write(target_dir.join("llama-server"), b"fake binary").unwrap();
        fs::create_dir_all(target_dir.join("lib")).unwrap();

        let result = resolve_bundled_sidecar(&target_dir);
        assert!(result.is_some(), "Should find binary in dev mode when lib/ exists");
    }

    #[test]
    fn test_resolve_bundled_sidecar_dev_without_lib() {
        // Dev mode: dir contains /target/, no lib/ → should skip
        let tmp = tempfile::tempdir().unwrap();
        let target_dir = tmp.path().join("some").join("target").join("debug");
        fs::create_dir_all(&target_dir).unwrap();
        fs::write(target_dir.join("llama-server"), b"fake binary").unwrap();

        let result = resolve_bundled_sidecar(&target_dir);
        assert!(result.is_none(), "Should skip dev binary when lib/ is missing");
    }

    #[test]
    fn test_resolve_bundled_sidecar_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let result = resolve_bundled_sidecar(tmp.path());
        assert!(result.is_none(), "Should return None when no binary exists");
    }

    #[test]
    fn test_resolve_dev_binary() {
        let tmp = tempfile::tempdir().unwrap();
        // Simulate: exe at src-tauri/target/debug/notesage
        let target_dir = tmp.path().join("target").join("debug");
        fs::create_dir_all(&target_dir).unwrap();

        let triple = format!("{}-{}", std::env::consts::ARCH, match std::env::consts::OS {
            "macos" => "apple-darwin",
            "linux" => "unknown-linux-gnu",
            _ => "",
        });
        let binaries_dir = tmp.path().join("binaries");
        fs::create_dir_all(&binaries_dir).unwrap();
        fs::write(binaries_dir.join(format!("llama-server-{}", triple)), b"fake binary").unwrap();

        let result = resolve_dev_binary(&target_dir);
        assert!(result.is_some(), "Should find dev binary in binaries/ relative to src-tauri");
    }

    #[test]
    fn test_resolve_dev_binary_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let target_dir = tmp.path().join("target").join("debug");
        fs::create_dir_all(&target_dir).unwrap();

        let result = resolve_dev_binary(&target_dir);
        assert!(result.is_none(), "Should return None when dev binary doesn't exist");
    }

    #[test]
    fn test_dir_total_size() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), b"hello").unwrap(); // 5 bytes
        fs::write(tmp.path().join("b.txt"), b"world!").unwrap(); // 6 bytes
        let sub = tmp.path().join("sub");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("c.txt"), b"test").unwrap(); // 4 bytes

        assert_eq!(dir_total_size(tmp.path()), 15);
    }

    #[test]
    fn test_jinja_flag_added_when_tool_calling_supported() {
        let args = super::super::local_inference::build_server_args(
            "/path/to/model.gguf", 8090, 4096, -1, true,
        );
        assert!(
            args.contains(&"--jinja".to_string()),
            "Args should contain --jinja when supports_tool_calling is true"
        );
    }

    #[test]
    fn test_jinja_flag_omitted_when_tool_calling_not_supported() {
        let args = super::super::local_inference::build_server_args(
            "/path/to/model.gguf", 8090, 4096, -1, false,
        );
        assert!(
            !args.contains(&"--jinja".to_string()),
            "Args should NOT contain --jinja when supports_tool_calling is false"
        );
    }

    #[test]
    fn test_build_server_args_base_always_present() {
        for supports_tc in [true, false] {
            let args = super::super::local_inference::build_server_args(
                "/model.gguf", 8091, 2048, 32, supports_tc,
            );
            assert!(args.contains(&"--model".to_string()));
            assert!(args.contains(&"/model.gguf".to_string()));
            assert!(args.contains(&"--port".to_string()));
            assert!(args.contains(&"8091".to_string()));
            assert!(args.contains(&"--ctx-size".to_string()));
            assert!(args.contains(&"2048".to_string()));
            assert!(args.contains(&"--n-gpu-layers".to_string()));
            assert!(args.contains(&"32".to_string()));
            assert!(args.contains(&"--host".to_string()));
            assert!(args.contains(&"127.0.0.1".to_string()));
        }
    }

    #[test]
    fn test_catalog_entry_supports_tool_calling_field() {
        // Verify that CatalogEntry correctly deserializes supports_tool_calling
        let json_with = r#"{
            "id": "test-model",
            "name": "Test Model",
            "filename": "test.gguf",
            "size_bytes": 1000,
            "ram_required_bytes": 2000,
            "description": "A test model",
            "huggingface_url": "https://example.com/test.gguf",
            "supports_tool_calling": true
        }"#;
        let entry: CatalogEntry = serde_json::from_str(json_with).unwrap();
        assert!(entry.supports_tool_calling);

        let json_without = r#"{
            "id": "test-model",
            "name": "Test Model",
            "filename": "test.gguf",
            "size_bytes": 1000,
            "ram_required_bytes": 2000,
            "description": "A test model",
            "huggingface_url": "https://example.com/test.gguf"
        }"#;
        let entry: CatalogEntry = serde_json::from_str(json_without).unwrap();
        assert!(!entry.supports_tool_calling, "supports_tool_calling should default to false");
    }

    // -----------------------------------------------------------------------
    // HF search helper tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_extract_quantization_standard_patterns() {
        assert_eq!(extract_quantization("model-Q4_K_M.gguf"), "Q4_K_M");
        assert_eq!(extract_quantization("model-Q8_0.gguf"), "Q8_0");
        assert_eq!(extract_quantization("model-F16.gguf"), "F16");
        assert_eq!(extract_quantization("model-BF16.gguf"), "BF16");
        assert_eq!(extract_quantization("model-IQ4_XS.gguf"), "IQ4_XS");
    }

    #[test]
    fn test_extract_quantization_real_filenames() {
        assert_eq!(
            extract_quantization("google_gemma-4-E4B-it-Q4_K_M.gguf"),
            "Q4_K_M"
        );
        assert_eq!(
            extract_quantization("gemma-4-26B-A4B-it-Q4_K_M.gguf"),
            "Q4_K_M"
        );
        assert_eq!(
            extract_quantization("Qwen3-8B-Q4_K_M.gguf"),
            "Q4_K_M"
        );
        assert_eq!(
            extract_quantization("Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"),
            "Q4_K_M"
        );
        assert_eq!(
            extract_quantization("DeepSeek-R1-Distill-Qwen-7B-Q4_K_M.gguf"),
            "Q4_K_M"
        );
    }

    #[test]
    fn test_extract_quantization_fallback() {
        assert_eq!(extract_quantization("some-model.gguf"), "Unknown");
    }

    #[test]
    fn test_hf_api_model_deserialization() {
        let json = r#"{
            "id": "bartowski/google_gemma-4-E4B-it-GGUF",
            "modelId": "bartowski/google_gemma-4-E4B-it-GGUF",
            "author": "bartowski",
            "downloads": 12345,
            "likes": 42,
            "tags": ["gguf", "gemma4"],
            "siblings": [
                {"rfilename": "README.md"},
                {"rfilename": "google_gemma-4-E4B-it-Q4_K_M.gguf", "size": 5340000000},
                {"rfilename": "google_gemma-4-E4B-it-Q8_0.gguf", "size": 9000000000},
                {"rfilename": "config.json"}
            ]
        }"#;
        let model: HfApiModel = serde_json::from_str(json).unwrap();
        assert_eq!(model.author, "bartowski");
        assert_eq!(model.downloads, 12345);
        assert_eq!(model.likes, 42);
        assert_eq!(model.siblings.len(), 4);

        // Filter to GGUF only
        let gguf_files: Vec<_> = model
            .siblings
            .iter()
            .filter(|s| s.rfilename.ends_with(".gguf"))
            .collect();
        assert_eq!(gguf_files.len(), 2);
        assert_eq!(gguf_files[0].rfilename, "google_gemma-4-E4B-it-Q4_K_M.gguf");
        assert_eq!(gguf_files[0].size, Some(5340000000));
    }

    #[test]
    fn test_hf_api_model_missing_optional_fields() {
        // Minimal response: only id, no modelId, no siblings
        let json = r#"{
            "id": "some-org/some-model-GGUF"
        }"#;
        let model: HfApiModel = serde_json::from_str(json).unwrap();
        assert_eq!(model.id, "some-org/some-model-GGUF");
        assert!(model.model_id.is_none());
        assert_eq!(model.downloads, 0);
        assert!(model.siblings.is_empty());
    }

    #[test]
    fn test_hf_search_result_model_name_derivation() {
        // Simulate the model_name derivation from search results
        let repo_id = "bartowski/google_gemma-4-E4B-it-GGUF";
        let model_name = repo_id
            .split('/')
            .last()
            .unwrap_or(repo_id)
            .replace("-GGUF", "")
            .replace('_', " ");
        assert_eq!(model_name, "google gemma-4-E4B-it");
    }

    #[test]
    fn test_hf_model_file_download_url_construction() {
        let repo_id = "ggml-org/gemma-4-26B-A4B-it-GGUF";
        let filename = "gemma-4-26B-A4B-it-Q4_K_M.gguf";
        let url = format!(
            "https://huggingface.co/{}/resolve/main/{}",
            repo_id, filename
        );
        assert_eq!(
            url,
            "https://huggingface.co/ggml-org/gemma-4-26B-A4B-it-GGUF/resolve/main/gemma-4-26B-A4B-it-Q4_K_M.gguf"
        );
    }

    #[test]
    fn test_gemma4_entries_in_catalog() {
        let catalog = load_curated_catalog();

        let e4b = catalog.iter().find(|e| e.id == "gemma-4-e4b");
        assert!(e4b.is_some(), "Gemma 4 E4B should exist in catalog");
        let e4b = e4b.unwrap();
        assert!(e4b.supports_tool_calling, "Gemma 4 should support tool calling");
        assert!(e4b.supports_thinking, "Gemma 4 should support thinking");
        assert!(e4b.supports_vision, "Gemma 4 should support vision");
        assert!(e4b.multilingual, "Gemma 4 should be multilingual");
        assert!(e4b.thinking_tags.is_some(), "Gemma 4 should have thinking tags");
        let tags = e4b.thinking_tags.as_ref().unwrap();
        assert!(tags.open.contains("channel"), "Gemma 4 uses channel-based thinking tags");

        let moe = catalog.iter().find(|e| e.id == "gemma-4-27b-a4b");
        assert!(moe.is_some(), "Gemma 4 27B MoE should exist in catalog");
        let moe = moe.unwrap();
        assert_eq!(moe.parameters.as_deref(), Some("27B"));
        assert_eq!(moe.context_length, Some(256000));
    }
}
