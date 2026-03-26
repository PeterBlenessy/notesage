use std::path::{Path, PathBuf};

/// Text file extensions for FTS-only indexing (non-markdown files).
const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "text", "log", "json", "yaml", "yml", "toml", "xml", "html", "htm", "css", "js",
    "ts", "tsx", "jsx", "py", "rb", "rs", "go", "java", "c", "cpp", "h", "hpp", "swift",
    "kt", "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd", "sql", "r", "lua", "pl",
    "ini", "cfg", "conf", "env", "csv",
];

/// Directories that contain metadata, config, or non-user-content — never index.
const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", "dist", "build",
    // Skill & agent directories (contain SKILL.md, agent .md, not user notes)
    "bundled-skills", "bundled-agents", "skills", "agents",
    // Source code / build artifacts
    "src-tauri", "src", "public",
    // Package manager / tooling
    ".cargo", ".rustup", "__pycache__", ".venv", "venv",
];

/// Check if a file extension is indexable.
pub(crate) fn is_indexable(path: &str) -> bool {
    if path.ends_with(".md") {
        return true;
    }
    if let Some(ext) = Path::new(path).extension() {
        let ext_str = ext.to_string_lossy().to_lowercase();
        TEXT_EXTENSIONS.contains(&ext_str.as_str())
    } else {
        false
    }
}

/// Recursively scan a directory for indexable files.
/// Only indexes user content — skips metadata, config, skill/agent, and build directories.
pub(crate) fn scan_files(dir: &Path, files: &mut Vec<PathBuf>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        // Skip hidden except .notesage
        if name.starts_with('.') && name != ".notesage" {
            continue;
        }

        if path.is_dir() {
            // Skip non-content directories
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            // For .notesage, only scan research/ subdirectory (user research notes)
            if name == ".notesage" {
                let research_dir = path.join("research");
                if research_dir.is_dir() {
                    scan_files(&research_dir, files);
                }
                continue;
            }
            scan_files(&path, files);
        } else if is_indexable(&path.to_string_lossy()) {
            files.push(path);
        }
    }
}
