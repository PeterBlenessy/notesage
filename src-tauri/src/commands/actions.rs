use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Convert millisecond timestamp to ISO 8601 string.
fn millis_to_iso(ms: i64) -> String {
    let secs = ms / 1000;
    let nanos = ((ms % 1000) * 1_000_000) as u32;
    if let Some(dt) = chrono::DateTime::from_timestamp(secs, nanos) {
        dt.to_rfc3339()
    } else {
        String::new()
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ActionItem {
    pub id: String,
    pub source_type: String,
    pub status: String,
    pub text: String,
    pub file_path: String,
    pub line_number: Option<u32>,
    pub project_name: Option<String>,
    pub project_root: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

/// Scan for action items. Currently only scans comments (JSON sidecar files).
/// Task and goal scanning is handled by the SQLite document index
/// (index_tasks, index_goals commands).
#[tauri::command]
pub async fn scan_actions(
    paths: Vec<String>,
    #[allow(unused)] since: Option<u64>,
) -> Result<Vec<ActionItem>, String> {
    let mut items: Vec<ActionItem> = Vec::new();

    for root_path in &paths {
        let root = Path::new(root_path);
        if !root.is_dir() {
            continue;
        }

        let project_name = read_project_name(root);
        scan_comments(root, root_path, &project_name, &mut items);
    }

    Ok(items)
}

fn read_project_name(root: &Path) -> Option<String> {
    let meta_path = root.join(".notesage/project.json");
    if let Ok(content) = fs::read_to_string(&meta_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            return json.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());
        }
    }
    None
}

/// Load the doc-index.json for a project root, returning UUID → file path map.
fn load_doc_index(root: &Path) -> std::collections::HashMap<String, String> {
    let index_path = root.join(".notesage/doc-index.json");
    if let Ok(content) = fs::read_to_string(&index_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(entries) = json.get("entries").and_then(|v| v.as_object()) {
                return entries.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect();
            }
        }
    }
    std::collections::HashMap::new()
}

fn scan_comments(
    root: &Path,
    project_root: &str,
    project_name: &Option<String>,
    items: &mut Vec<ActionItem>,
) {
    let comments_dir = root.join(".notesage/comments");
    if !comments_dir.is_dir() {
        return;
    }

    let entries = match fs::read_dir(&comments_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    // Load document index to resolve UUIDs → file paths
    let doc_index = load_doc_index(root);

    for entry in entries.flatten() {
        let path = entry.path();
        let name_str = entry.file_name().to_string_lossy().to_string();

        if !name_str.ends_with(".json") {
            continue;
        }

        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let comments: Vec<serde_json::Value> = match serde_json::from_str(&content) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let document_id = name_str.trim_end_matches(".json");

        // Resolve the document's actual file path from the index
        let resolved_file_path = doc_index.get(document_id).cloned();

        // If the referenced file no longer exists, clean up the orphaned comment sidecar
        if let Some(ref resolved) = resolved_file_path {
            if !Path::new(resolved).exists() {
                let _ = fs::remove_file(&path);
                continue;
            }
        }

        // Read the document content to check if comment anchors still exist
        let doc_content = resolved_file_path.as_ref()
            .and_then(|p| fs::read_to_string(p).ok());

        // Filter out comments whose anchor text is no longer in the file
        let mut needs_cleanup = false;
        let mut surviving_comments: Vec<&serde_json::Value> = Vec::new();
        for comment in &comments {
            let anchor_text = comment.get("anchorText")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            // If we have the doc content and a non-empty anchor, check it still exists
            if let Some(ref content) = doc_content {
                if !anchor_text.is_empty() && !content.contains(anchor_text) {
                    needs_cleanup = true;
                    continue; // skip this orphaned comment
                }
            }
            surviving_comments.push(comment);
        }

        // Write back the cleaned-up comment list if any were removed
        if needs_cleanup {
            if surviving_comments.is_empty() {
                let _ = fs::remove_file(&path);
                continue;
            } else {
                let cleaned: Vec<&serde_json::Value> = surviving_comments.iter().copied().collect();
                if let Ok(json) = serde_json::to_string_pretty(&cleaned) {
                    let _ = fs::write(&path, json);
                }
            }
        }

        for comment in &surviving_comments {
            let status_str = comment.get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("open");

            // Skip resolved comments
            if status_str == "resolved" {
                continue;
            }

            let comment_id = comment.get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let body = comment.get("body")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let anchor_text = comment.get("anchorText")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let display_text = if !body.is_empty() {
                body.chars().take(120).collect::<String>()
            } else {
                anchor_text.chars().take(120).collect::<String>()
            };

            let reply_count = comment.get("replies")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);

            let created_at = comment.get("createdAt")
                .and_then(|v| v.as_i64())
                .map(millis_to_iso);

            let mapped_status = match status_str {
                "open" => "open",
                "delegated" => "delegated",
                "done" => "done",
                _ => "open",
            };

            let mut metadata = serde_json::Map::new();
            metadata.insert("commentId".to_string(), serde_json::Value::String(comment_id.to_string()));
            metadata.insert("documentId".to_string(), serde_json::Value::String(document_id.to_string()));
            if reply_count > 0 {
                metadata.insert("replyCount".to_string(), serde_json::Value::Number(serde_json::Number::from(reply_count)));
            }

            // Use the resolved file path (from doc-index.json) instead of the JSON sidecar path
            let file_path = resolved_file_path.clone()
                .unwrap_or_else(|| path.to_string_lossy().to_string());

            items.push(ActionItem {
                id: format!("comment:{}:{}", document_id, comment_id),
                source_type: "comment".to_string(),
                status: mapped_status.to_string(),
                text: display_text,
                file_path,
                line_number: None,
                project_name: project_name.clone(),
                project_root: Some(project_root.to_string()),
                created_at,
                updated_at: None,
                metadata: Some(serde_json::Value::Object(metadata)),
            });
        }
    }
}
