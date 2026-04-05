use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Public types
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

// ---------------------------------------------------------------------------
// Internal HF API response types
// ---------------------------------------------------------------------------

/// Raw HF API model response fields we care about.
#[derive(Deserialize, Debug)]
struct HfApiModel {
    #[serde(rename = "modelId")]
    model_id: Option<String>,
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
    #[serde(default)]
    total: Option<u64>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Derive quantization label from GGUF filename (e.g. "Q4_K_M" from "model-Q4_K_M.gguf").
pub fn extract_quantization(filename: &str) -> String {
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

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

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
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

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
}
