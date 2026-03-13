use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::SystemTime;

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

#[tauri::command]
pub async fn scan_actions(
    paths: Vec<String>,
    since: Option<u64>,
) -> Result<Vec<ActionItem>, String> {
    let mut items: Vec<ActionItem> = Vec::new();

    for root_path in &paths {
        let root = Path::new(root_path);
        if !root.is_dir() {
            continue;
        }

        // Read project name from .notesage/project.json if present
        let project_name = read_project_name(root);

        // Scan markdown files for task lists and goal frontmatter
        scan_markdown_files(root, root_path, &project_name, since, &mut items);

        // Scan .notesage/comments/ for open/delegated comments
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

fn file_modified_since(path: &Path, since: Option<u64>) -> bool {
    if let Some(since_ts) = since {
        if let Ok(metadata) = fs::metadata(path) {
            if let Ok(modified) = metadata.modified() {
                let mtime = modified
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                return mtime > since_ts;
            }
        }
        false
    } else {
        true // No filter — include all
    }
}

fn scan_markdown_files(
    dir: &Path,
    project_root: &str,
    project_name: &Option<String>,
    since: Option<u64>,
    items: &mut Vec<ActionItem>,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        // Skip hidden files/dirs
        if name_str.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            // Skip node_modules, target, etc.
            if matches!(name_str.as_ref(), "node_modules" | "target" | "dist" | "build" | ".git") {
                continue;
            }
            scan_markdown_files(&path, project_root, project_name, since, items);
        } else if name_str.ends_with(".md") || name_str.ends_with(".markdown") {
            if !file_modified_since(&path, since) {
                continue;
            }

            let path_str = path.to_string_lossy().to_string();
            if let Ok(content) = fs::read_to_string(&path) {
                // Parse task lists
                parse_task_items(&content, &path_str, project_root, project_name, items);

                // Parse goal frontmatter
                parse_goal_items(&content, &path_str, project_root, project_name, items);
            }
        }
    }
}

fn parse_task_items(
    content: &str,
    file_path: &str,
    project_root: &str,
    project_name: &Option<String>,
    items: &mut Vec<ActionItem>,
) {
    let task_re = Regex::new(r"^(\s*)([-*]|\d+\.)\s+\[([ xX])\]\s+(.+)$").unwrap();

    for (line_idx, line) in content.lines().enumerate() {
        if let Some(caps) = task_re.captures(line) {
            let checkbox = caps.get(3).unwrap().as_str();
            let text = caps.get(4).unwrap().as_str().trim().to_string();
            let is_done = checkbox == "x" || checkbox == "X";
            let line_number = (line_idx + 1) as u32;

            items.push(ActionItem {
                id: format!("task:{}:{}", file_path, line_number),
                source_type: "task".to_string(),
                status: if is_done { "done".to_string() } else { "open".to_string() },
                text,
                file_path: file_path.to_string(),
                line_number: Some(line_number),
                project_name: project_name.clone(),
                project_root: Some(project_root.to_string()),
                created_at: None,
                updated_at: None,
                metadata: None,
            });
        }
    }
}

fn parse_goal_items(
    content: &str,
    file_path: &str,
    project_root: &str,
    project_name: &Option<String>,
    items: &mut Vec<ActionItem>,
) {
    // Check if file has type: goal in frontmatter
    if !content.starts_with("---") {
        return;
    }

    let end = content[3..].find("---");
    if end.is_none() {
        return;
    }
    let frontmatter = &content[3..3 + end.unwrap()];

    let is_goal = frontmatter.lines().any(|line| {
        let trimmed = line.trim();
        trimmed == "type: goal" || trimmed == "type: \"goal\"" || trimmed == "type: 'goal'"
    });

    if !is_goal {
        return;
    }

    // Parse checklist items from body (after frontmatter)
    let body_start = 3 + end.unwrap() + 3;
    let body = if body_start < content.len() { &content[body_start..] } else { return };

    let task_re = Regex::new(r"^(\s*)([-*]|\d+\.)\s+\[([ xX])\]\s+(.+)$").unwrap();
    let frontmatter_lines = content[..body_start].lines().count();

    for (line_idx, line) in body.lines().enumerate() {
        if let Some(caps) = task_re.captures(line) {
            let checkbox = caps.get(3).unwrap().as_str();
            let text = caps.get(4).unwrap().as_str().trim().to_string();
            let is_done = checkbox == "x" || checkbox == "X";
            let line_number = (frontmatter_lines + line_idx + 1) as u32;

            items.push(ActionItem {
                id: format!("goal:{}:{}", file_path, line_number),
                source_type: "goal".to_string(),
                status: if is_done { "done".to_string() } else { "open".to_string() },
                text,
                file_path: file_path.to_string(),
                line_number: Some(line_number),
                project_name: project_name.clone(),
                project_root: Some(project_root.to_string()),
                created_at: None,
                updated_at: None,
                metadata: None,
            });
        }
    }
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

        for comment in &comments {
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

            // Find the source file for this comment (document ID is the json filename without .json)
            let document_id = name_str.trim_end_matches(".json");

            // Map status
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

            items.push(ActionItem {
                id: format!("comment:{}:{}", document_id, comment_id),
                source_type: "comment".to_string(),
                status: mapped_status.to_string(),
                text: display_text,
                file_path: path.to_string_lossy().to_string(),
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
