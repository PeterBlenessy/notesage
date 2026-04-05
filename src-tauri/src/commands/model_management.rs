use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use super::local_inference::LocalInferenceState;

// Re-export submodule types so existing `use super::model_management::*` paths keep working.
pub use super::model_providers::binary_resolution::{
    DiagnosticFile, LocalAIDiagnostics,
    find_available_port, resolve_llama_server_binary,
    collect_local_ai_diagnostics, check_llama_server_available,
};
pub use super::model_providers::hf_search::{
    extract_quantization, search_huggingface_models, fetch_hf_model_details,
};

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
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

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
