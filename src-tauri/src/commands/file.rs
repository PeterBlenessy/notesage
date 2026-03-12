use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Option<Vec<FileEntry>>,
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_binary_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(&path);

    if !dir_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(dir_path).map_err(|e| e.to_string())?;

    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files (starting with .)
        if file_name.starts_with('.') {
            continue;
        }

        let is_directory = entry_path.is_dir();
        let path_str = entry_path.to_string_lossy().to_string();

        let children = if is_directory {
            // Recursively list children using Box::pin for async recursion
            match Box::pin(list_directory(path_str.clone())).await {
                Ok(children) => Some(children),
                Err(_) => Some(Vec::new()),
            }
        } else {
            None
        };

        entries.push(FileEntry {
            name: file_name,
            path: path_str,
            is_directory,
            children,
        });
    }

    // Sort: directories first, then alphabetically
    entries.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

/// List only files (not directories) at the top level of a directory.
/// No recursive descent — much faster than list_directory for flat file listings.
#[tauri::command]
pub async fn list_files_shallow(path: String) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(&path);

    if !dir_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(dir_path).map_err(|e| e.to_string())?;

    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files and directories
        if file_name.starts_with('.') {
            continue;
        }

        // Skip directories entirely
        if entry_path.is_dir() {
            continue;
        }

        entries.push(FileEntry {
            name: file_name,
            path: entry_path.to_string_lossy().to_string(),
            is_directory: false,
            children: None,
        });
    }

    // Sort alphabetically
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(entries)
}

#[tauri::command]
pub async fn create_file(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err(format!("File already exists: {}", path));
    }

    fs::write(&path, "").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_directory(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err(format!("Directory already exists: {}", path));
    }

    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rename_path(old_path: String, new_path: String) -> Result<(), String> {
    if !Path::new(&old_path).exists() {
        return Err(format!("Source path does not exist: {}", old_path));
    }

    if Path::new(&new_path).exists() {
        return Err(format!("Destination path already exists: {}", new_path));
    }

    fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_path(path: String) -> Result<(), String> {
    let file_path = Path::new(&path);

    if !file_path.exists() {
        return Err(format!("Path does not exist: {}", path));
    }

    if file_path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn path_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[tauri::command]
pub async fn copy_file(source: String, destination: String) -> Result<(), String> {
    let src = Path::new(&source);
    if !src.exists() {
        return Err(format!("Source file does not exist: {}", source));
    }
    if !src.is_file() {
        return Err(format!("Source is not a file: {}", source));
    }
    // Ensure destination parent directory exists
    if let Some(parent) = Path::new(&destination).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }
    }
    fs::copy(&source, &destination)
        .map(|_| ())
        .map_err(|e| format!("Failed to copy file: {}", e))
}

#[tauri::command]
pub async fn copy_directory(source: String, destination: String) -> Result<(), String> {
    let src = Path::new(&source);
    if !src.exists() {
        return Err(format!("Source directory does not exist: {}", source));
    }
    if !src.is_dir() {
        return Err(format!("Source is not a directory: {}", source));
    }
    if Path::new(&destination).exists() {
        return Err(format!("Destination already exists: {}", destination));
    }
    copy_dir_recursive(src, Path::new(&destination))
        .map_err(|e| format!("Failed to copy directory: {}", e))
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let entry_type = entry.file_type()?;
        let dest_path = dst.join(entry.file_name());
        if entry_type.is_dir() {
            copy_dir_recursive(&entry.path(), &dest_path)?;
        } else {
            fs::copy(entry.path(), &dest_path)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine home directory".to_string())
}

#[tauri::command]
pub async fn reveal_in_finder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

/// Scan all .md files in the given directories (recursively) for #tag patterns.
/// Returns a map of tag name → list of file paths that contain that tag.
/// Tag names are without the `#` prefix, sorted alphabetically.
#[tauri::command]
pub async fn scan_tags_in_directories(
    paths: Vec<String>,
) -> Result<BTreeMap<String, Vec<String>>, String> {
    let tag_re = Regex::new(r"(?:^|(?:\s|[^\w]))#([a-zA-Z][a-zA-Z0-9_-]*)").unwrap();
    let mut tag_files: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();

    for dir_path in &paths {
        let path = Path::new(dir_path);
        if !path.is_dir() {
            continue;
        }
        scan_dir_for_tags(path, &tag_re, &mut tag_files);
    }

    // Convert BTreeSet<String> values to Vec<String>
    Ok(tag_files
        .into_iter()
        .map(|(tag, files)| (tag, files.into_iter().collect()))
        .collect())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TagOccurrence {
    pub path: String,
    pub file_name: String,
    pub line_number: usize,      // 1-based
    pub occurrence_in_file: usize, // 0-based index of this tag match within the file
    pub snippet: String,         // trimmed line content, max ~100 chars
}

/// Find all occurrences of a specific tag across .md files in the given directories.
/// Returns per-line occurrences with context snippets, sorted by file name then line number.
#[tauri::command]
pub async fn find_tag_occurrences(
    tag: String,
    paths: Vec<String>,
) -> Result<Vec<TagOccurrence>, String> {
    let pattern = format!(r"(?:^|(?:\s|[^\w]))#{}(?:[^a-zA-Z0-9_-]|$)", regex::escape(&tag));
    let tag_re = Regex::new(&pattern).map_err(|e| e.to_string())?;
    let mut occurrences: Vec<TagOccurrence> = Vec::new();

    for dir_path in &paths {
        let path = Path::new(dir_path);
        if !path.is_dir() {
            continue;
        }
        scan_dir_for_tag_occurrences(path, &tag_re, &mut occurrences);
    }

    // Sort by file name then line number
    occurrences.sort_by(|a, b| {
        a.file_name
            .to_lowercase()
            .cmp(&b.file_name.to_lowercase())
            .then(a.line_number.cmp(&b.line_number))
    });

    Ok(occurrences)
}

fn scan_dir_for_tag_occurrences(
    dir: &Path,
    tag_re: &Regex,
    occurrences: &mut Vec<TagOccurrence>,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        if name_str.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            scan_dir_for_tag_occurrences(&path, tag_re, occurrences);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Ok(content) = fs::read_to_string(&path) {
                let file_path = path.to_string_lossy().to_string();
                let file_name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                let mut occ_count: usize = 0;
                for (idx, line) in content.lines().enumerate() {
                    if tag_re.is_match(line) {
                        let trimmed = line.trim();
                        let snippet = if trimmed.chars().count() > 100 {
                            let end = trimmed.char_indices().nth(97).map(|(i, _)| i).unwrap_or(trimmed.len());
                            format!("{}...", &trimmed[..end])
                        } else {
                            trimmed.to_string()
                        };
                        occurrences.push(TagOccurrence {
                            path: file_path.clone(),
                            file_name: file_name.clone(),
                            line_number: idx + 1,
                            occurrence_in_file: occ_count,
                            snippet,
                        });
                        occ_count += 1;
                    }
                }
            }
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ContentMatch {
    pub path: String,
    pub file_name: String,
    pub line_number: usize,
    pub snippet: String,
}

const TEXT_EXTENSIONS: &[&str] = &[
    "md", "txt", "json", "yaml", "yml", "toml", "csv", "xml", "html", "htm",
    "css", "js", "ts", "jsx", "tsx", "rs", "py", "rb", "go", "java", "c",
    "cpp", "h", "hpp", "sh", "bash", "zsh", "fish", "sql", "graphql", "svg",
    "ini", "cfg", "conf", "env", "log", "tex", "typ", "lua", "swift",
];

const MAX_FILE_SIZE: u64 = 1_048_576; // 1 MB
const MAX_CONTENT_RESULTS: usize = 100;

/// Search file contents across the given directories for a case-insensitive substring match.
/// Returns per-line matches with context snippets, capped at MAX_CONTENT_RESULTS.
#[tauri::command]
pub async fn search_file_content(
    query: String,
    paths: Vec<String>,
) -> Result<Vec<ContentMatch>, String> {
    let q = query.to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    let mut results: Vec<ContentMatch> = Vec::new();

    for dir_path in &paths {
        let path = Path::new(dir_path);
        if !path.is_dir() {
            continue;
        }
        scan_dir_for_content(path, &q, &mut results);
        if results.len() >= MAX_CONTENT_RESULTS {
            break;
        }
    }

    results.sort_by(|a, b| {
        a.file_name
            .to_lowercase()
            .cmp(&b.file_name.to_lowercase())
            .then(a.line_number.cmp(&b.line_number))
    });

    results.truncate(MAX_CONTENT_RESULTS);
    Ok(results)
}

fn scan_dir_for_content(
    dir: &Path,
    query: &str,
    results: &mut Vec<ContentMatch>,
) {
    if results.len() >= MAX_CONTENT_RESULTS {
        return;
    }

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        if results.len() >= MAX_CONTENT_RESULTS {
            return;
        }

        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        if name_str.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            scan_dir_for_content(&path, query, results);
        } else {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !TEXT_EXTENSIONS.contains(&ext) {
                continue;
            }

            // Skip files larger than 1 MB
            if let Ok(meta) = fs::metadata(&path) {
                if meta.len() > MAX_FILE_SIZE {
                    continue;
                }
            }

            if let Ok(content) = fs::read_to_string(&path) {
                let file_path = path.to_string_lossy().to_string();
                let file_name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                for (idx, line) in content.lines().enumerate() {
                    if results.len() >= MAX_CONTENT_RESULTS {
                        return;
                    }
                    if line.to_lowercase().contains(query) {
                        let trimmed = line.trim();
                        let snippet = if trimmed.chars().count() > 120 {
                            let end = trimmed
                                .char_indices()
                                .nth(117)
                                .map(|(i, _)| i)
                                .unwrap_or(trimmed.len());
                            format!("{}...", &trimmed[..end])
                        } else {
                            trimmed.to_string()
                        };
                        results.push(ContentMatch {
                            path: file_path.clone(),
                            file_name: file_name.clone(),
                            line_number: idx + 1,
                            snippet,
                        });
                    }
                }
            }
        }
    }
}

fn scan_dir_for_tags(
    dir: &Path,
    tag_re: &Regex,
    tag_files: &mut BTreeMap<String, BTreeSet<String>>,
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
            scan_dir_for_tags(&path, tag_re, tag_files);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Ok(content) = fs::read_to_string(&path) {
                let file_path = path.to_string_lossy().to_string();
                for cap in tag_re.captures_iter(&content) {
                    if let Some(m) = cap.get(1) {
                        tag_files
                            .entry(m.as_str().to_string())
                            .or_default()
                            .insert(file_path.clone());
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// @mention scanning
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
pub struct MentionOccurrence {
    pub path: String,
    pub file_name: String,
    pub line_number: usize,
    pub occurrence_in_file: usize,
    pub snippet: String,
}

/// Scan all .md files in the given directories (recursively) for @mention patterns.
/// Returns a map of mention name → list of file paths that contain that mention.
/// Mention names are without the `@` prefix, sorted alphabetically.
#[tauri::command]
pub async fn scan_mentions_in_directories(
    paths: Vec<String>,
) -> Result<BTreeMap<String, Vec<String>>, String> {
    let mention_re = Regex::new(r"(?:^|(?:\s|[^\w]))@([a-zA-Z][a-zA-Z0-9_-]*)").unwrap();
    let mut mention_files: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();

    for dir_path in &paths {
        let path = Path::new(dir_path);
        if !path.is_dir() {
            continue;
        }
        scan_dir_for_mentions(path, &mention_re, &mut mention_files);
    }

    Ok(mention_files
        .into_iter()
        .map(|(mention, files)| (mention, files.into_iter().collect()))
        .collect())
}

/// Find all occurrences of a specific mention across .md files in the given directories.
/// Returns per-line occurrences with context snippets, sorted by file name then line number.
#[tauri::command]
pub async fn find_mention_occurrences(
    mention: String,
    paths: Vec<String>,
) -> Result<Vec<MentionOccurrence>, String> {
    let pattern = format!(
        r"(?:^|(?:\s|[^\w]))@{}(?:[^a-zA-Z0-9_-]|$)",
        regex::escape(&mention)
    );
    let mention_re = Regex::new(&pattern).map_err(|e| e.to_string())?;
    let mut occurrences: Vec<MentionOccurrence> = Vec::new();

    for dir_path in &paths {
        let path = Path::new(dir_path);
        if !path.is_dir() {
            continue;
        }
        scan_dir_for_mention_occurrences(path, &mention_re, &mut occurrences);
    }

    occurrences.sort_by(|a, b| {
        a.file_name
            .to_lowercase()
            .cmp(&b.file_name.to_lowercase())
            .then(a.line_number.cmp(&b.line_number))
    });

    Ok(occurrences)
}

fn scan_dir_for_mentions(
    dir: &Path,
    mention_re: &Regex,
    mention_files: &mut BTreeMap<String, BTreeSet<String>>,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        if name_str.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            scan_dir_for_mentions(&path, mention_re, mention_files);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Ok(content) = fs::read_to_string(&path) {
                let file_path = path.to_string_lossy().to_string();
                for cap in mention_re.captures_iter(&content) {
                    if let Some(m) = cap.get(1) {
                        mention_files
                            .entry(m.as_str().to_string())
                            .or_default()
                            .insert(file_path.clone());
                    }
                }
            }
        }
    }
}

fn scan_dir_for_mention_occurrences(
    dir: &Path,
    mention_re: &Regex,
    occurrences: &mut Vec<MentionOccurrence>,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        if name_str.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            scan_dir_for_mention_occurrences(&path, mention_re, occurrences);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Ok(content) = fs::read_to_string(&path) {
                let file_path = path.to_string_lossy().to_string();
                let file_name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                let mut occ_count: usize = 0;
                for (idx, line) in content.lines().enumerate() {
                    if mention_re.is_match(line) {
                        let trimmed = line.trim();
                        let snippet = if trimmed.chars().count() > 100 {
                            let end = trimmed
                                .char_indices()
                                .nth(97)
                                .map(|(i, _)| i)
                                .unwrap_or(trimmed.len());
                            format!("{}...", &trimmed[..end])
                        } else {
                            trimmed.to_string()
                        };
                        occurrences.push(MentionOccurrence {
                            path: file_path.clone(),
                            file_name: file_name.clone(),
                            line_number: idx + 1,
                            occurrence_in_file: occ_count,
                            snippet,
                        });
                        occ_count += 1;
                    }
                }
            }
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ResearchSearchResult {
    pub file: String,
    pub title: String,
    pub tags: Vec<String>,
    pub source_url: String,
    pub snippet: String,
    pub relevance: f32,
    pub date_saved: String,
    pub word_count: usize,
}

/// Search research files (.md) in the given directories for matching content.
/// Parses YAML frontmatter for metadata, matches against query/tag.
/// Returns results sorted by relevance, limited to `limit` (default 50).
#[tauri::command]
pub async fn search_research(
    dirs: Vec<String>,
    query: Option<String>,
    tag: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ResearchSearchResult>, String> {
    let max_results = limit.unwrap_or(50);
    let query_lower = query.as_ref().map(|q| q.to_lowercase());
    let tag_lower = tag.as_ref().map(|t| t.to_lowercase());
    let mut results: Vec<ResearchSearchResult> = Vec::new();

    for dir_path in &dirs {
        let path = Path::new(dir_path);
        if !path.is_dir() {
            continue;
        }
        scan_dir_for_research(path, &query_lower, &tag_lower, &mut results);
    }

    // Sort by relevance descending, then by date_saved descending
    results.sort_by(|a, b| {
        b.relevance
            .partial_cmp(&a.relevance)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.date_saved.cmp(&a.date_saved))
    });

    results.truncate(max_results);
    Ok(results)
}

fn scan_dir_for_research(
    dir: &Path,
    query_lower: &Option<String>,
    tag_lower: &Option<String>,
    results: &mut Vec<ResearchSearchResult>,
) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        if name_str.starts_with('.') {
            continue;
        }

        if path.is_dir() {
            scan_dir_for_research(&path, query_lower, tag_lower, results);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            if let Some(result) = parse_research_file(&path, query_lower, tag_lower) {
                results.push(result);
            }
        }
    }
}

fn parse_research_file(
    path: &Path,
    query_lower: &Option<String>,
    tag_lower: &Option<String>,
) -> Option<ResearchSearchResult> {
    let content = fs::read_to_string(path).ok()?;
    let file_path = path.to_string_lossy().to_string();

    // Parse YAML frontmatter
    if !content.starts_with("---") {
        return None;
    }
    let end = content[3..].find("\n---")?;
    let frontmatter = &content[3..3 + end];
    let body = &content[3 + end + 4..]; // skip closing ---\n

    // Extract fields from frontmatter using simple line parsing
    let mut title = String::new();
    let mut source_url = String::new();
    let mut date_saved = String::new();
    let mut word_count: usize = 0;
    let mut tags: Vec<String> = Vec::new();

    for line in frontmatter.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("title:") {
            title = strip_yaml_quotes(val);
        } else if let Some(val) = line.strip_prefix("source_url:") {
            source_url = strip_yaml_quotes(val);
        } else if let Some(val) = line.strip_prefix("date_saved:") {
            date_saved = strip_yaml_quotes(val);
        } else if let Some(val) = line.strip_prefix("word_count:") {
            word_count = val.trim().parse().unwrap_or(0);
        } else if let Some(val) = line.strip_prefix("tags:") {
            tags = parse_yaml_array(val);
        }
    }

    // Must have at least a title or source_url to be a valid research file
    if title.is_empty() && source_url.is_empty() {
        return None;
    }

    // Apply filters and compute relevance
    let mut relevance: f32 = 0.0;
    let title_lower = title.to_lowercase();
    let body_lower = body.to_lowercase();
    let url_lower = source_url.to_lowercase();

    // Tag filter (exact match)
    if let Some(ref tag_q) = tag_lower {
        let tag_match = tags.iter().any(|t| t.to_lowercase() == *tag_q);
        if !tag_match {
            return None; // tag filter is strict
        }
        relevance = relevance.max(0.8);
    }

    // Query filter (substring match)
    if let Some(ref q) = query_lower {
        let mut matched = false;
        if title_lower.contains(q.as_str()) {
            relevance = relevance.max(1.0);
            matched = true;
        }
        if url_lower.contains(q.as_str()) {
            relevance = relevance.max(0.6);
            matched = true;
        }
        if body_lower.contains(q.as_str()) {
            relevance = relevance.max(0.5);
            matched = true;
        }
        // Also check tags for query match
        if tags.iter().any(|t| t.to_lowercase().contains(q.as_str())) {
            relevance = relevance.max(0.8);
            matched = true;
        }
        if !matched {
            return None;
        }
    }

    // If no query and no tag, include all files with base relevance
    if query_lower.is_none() && tag_lower.is_none() {
        relevance = 0.5;
    }

    // Generate snippet
    let snippet = if let Some(ref q) = query_lower {
        generate_snippet_around_match(body, q)
    } else {
        body.chars().take(200).collect::<String>().trim().to_string()
    };

    Some(ResearchSearchResult {
        file: file_path,
        title,
        tags,
        source_url,
        snippet,
        relevance,
        date_saved,
        word_count,
    })
}

fn strip_yaml_quotes(val: &str) -> String {
    let trimmed = val.trim();
    if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

fn parse_yaml_array(val: &str) -> Vec<String> {
    let trimmed = val.trim();
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        // Inline array: [tag1, tag2, "tag3"]
        trimmed[1..trimmed.len() - 1]
            .split(',')
            .map(|s| strip_yaml_quotes(s))
            .filter(|s| !s.is_empty())
            .collect()
    } else {
        Vec::new()
    }
}

fn generate_snippet_around_match(body: &str, query: &str) -> String {
    let body_lower = body.to_lowercase();
    if let Some(pos) = body_lower.find(query) {
        let start = if pos > 80 { pos - 80 } else { 0 };
        let end = (pos + query.len() + 120).min(body.len());
        // Find safe UTF-8 boundaries
        let safe_start = (0..=start)
            .rev()
            .find(|&i| body.is_char_boundary(i))
            .unwrap_or(0);
        let safe_end = (end..=body.len())
            .find(|&i| body.is_char_boundary(i))
            .unwrap_or(body.len());
        let slice = &body[safe_start..safe_end];
        let trimmed = slice.trim();
        if safe_start > 0 {
            format!("...{}", trimmed)
        } else {
            trimmed.to_string()
        }
    } else {
        body.chars().take(200).collect::<String>().trim().to_string()
    }
}
