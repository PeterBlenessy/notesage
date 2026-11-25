//! MCP config-file parsing & import backing helpers.
//!
//! Reads `mcp.json` (Notesage / Cursor), Claude Desktop's wrapped config, and
//! VS Code's `mcp.json` / `settings.json` into `McpServerConfig`s. The
//! `mcp_discover_configs` / `mcp_config_problems` / `mcp_import_configs` /
//! `mcp_check_import_sources` commands (in `mod.rs`) are thin wrappers over
//! these.
//!
//! Files are read tolerantly, because people edit them by hand and copy
//! entries between tools:
//!
//! - every entry is parsed on its own ([`parse_entry`]), so one bad entry is
//!   reported as a [`McpConfigProblem`] and the rest of the file still loads;
//! - the remote spellings other tools write are accepted (`"type"` for
//!   `"transport"`, `"streamable-http"`, `"sse"`, a bare `"url"`);
//! - comments and trailing commas (JSONC, which VS Code writes) are accepted.

use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::types::{
    McpConfigEntry, McpConfigProblem, McpConfigSource, McpEnvValue, McpSecretRef, McpServerConfig,
    McpTransport,
};

pub(crate) fn source_prefix(source: &McpConfigSource) -> &'static str {
    match source {
        McpConfigSource::NotesageGlobal => "global",
        McpConfigSource::NotesageProject => "project",
        McpConfigSource::ClaudeDesktop => "claude",
        McpConfigSource::Cursor => "cursor",
        McpConfigSource::VsCode => "vscode",
    }
}

/// The source as the frontend spells it (`McpServerConfig.source`).
pub(crate) fn source_wire_name(source: &McpConfigSource) -> &'static str {
    match source {
        McpConfigSource::NotesageGlobal => "notesage_global",
        McpConfigSource::NotesageProject => "notesage_project",
        McpConfigSource::ClaudeDesktop => "claude_desktop",
        McpConfigSource::Cursor => "cursor",
        McpConfigSource::VsCode => "vscode",
    }
}

// ---------------------------------------------------------------------------
// JSON with comments
// ---------------------------------------------------------------------------

/// Remove `//` and `/* */` comments and trailing commas from JSONC, leaving
/// string contents untouched (a `//` inside a URL string is not a comment).
/// The result is handed to `serde_json`, which reports anything else that is
/// wrong, so this does not need to validate.
pub(crate) fn strip_jsonc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;
    while let Some(c) = chars.next() {
        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match c {
            '"' => {
                in_string = true;
                out.push(c);
            }
            '/' if chars.peek() == Some(&'/') => {
                // Line comment: drop up to, not including, the newline.
                while let Some(&next) = chars.peek() {
                    if next == '\n' {
                        break;
                    }
                    chars.next();
                }
            }
            '/' if chars.peek() == Some(&'*') => {
                chars.next();
                let mut previous = '\0';
                for next in chars.by_ref() {
                    if previous == '*' && next == '/' {
                        break;
                    }
                    previous = next;
                }
                // A comment separates tokens, as whitespace does.
                out.push(' ');
            }
            '}' | ']' => {
                // A trailing comma: the last thing before this bracket, other
                // than whitespace, is a `,`. It cannot be inside a string,
                // because a string would end in `"`.
                let kept = out.trim_end().len();
                if out[..kept].ends_with(',') {
                    out.replace_range(kept - 1..kept, "");
                }
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

/// Parse JSON, falling back to JSONC (comments, trailing commas) and
/// tolerating a leading byte order mark. Strict JSON is tried first so a
/// well-formed file never goes through the stripper.
pub(crate) fn parse_json_lenient(text: &str) -> Result<Value, String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    match serde_json::from_str::<Value>(text) {
        Ok(value) => Ok(value),
        Err(strict) => {
            serde_json::from_str::<Value>(&strip_jsonc(text)).map_err(|_| strict.to_string())
        }
    }
}

// ---------------------------------------------------------------------------
// One entry
// ---------------------------------------------------------------------------

/// A transport name as written in a config file. `streamable-http` and `sse`
/// are what other tools call a remote server; both are `http` here.
fn parse_transport_name(name: &str) -> Option<McpTransport> {
    match name.trim().to_ascii_lowercase().replace('_', "-").as_str() {
        "stdio" => Some(McpTransport::Stdio),
        "http" | "streamable-http" | "streamablehttp" | "sse" => Some(McpTransport::Http),
        _ => None,
    }
}

fn optional_string(obj: &Map<String, Value>, key: &str) -> Result<Option<String>, String> {
    match obj.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(format!("\"{}\" must be a string", key)),
    }
}

/// A scalar a person would reasonably write where a string is expected
/// (`"PORT": 8080`, `"DEBUG": true`), as the string a process would receive.
fn scalar_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

/// `env` / `headers`: an object whose values are strings (numbers and
/// booleans are taken as their text) or `{ "secret": true }` references.
/// The error names the key, never the value.
fn string_map(obj: &Map<String, Value>, key: &str) -> Result<HashMap<String, McpEnvValue>, String> {
    let map = match obj.get(key) {
        None | Some(Value::Null) => return Ok(HashMap::new()),
        Some(Value::Object(map)) => map,
        Some(_) => return Err(format!("\"{}\" must be an object", key)),
    };
    let mut out = HashMap::with_capacity(map.len());
    for (name, value) in map {
        let parsed = match value {
            Value::Null => continue,
            Value::Object(inner) => match inner.get("secret") {
                Some(Value::Bool(secret)) => McpEnvValue::Secret(McpSecretRef { secret: *secret }),
                _ => {
                    return Err(format!(
                        "\"{}\".\"{}\" must be a string or {{\"secret\": true}}",
                        key, name
                    ))
                }
            },
            other => match scalar_to_string(other) {
                Some(text) => McpEnvValue::Plain(text),
                None => {
                    return Err(format!(
                        "\"{}\".\"{}\" must be a string or {{\"secret\": true}}",
                        key, name
                    ))
                }
            },
        };
        out.insert(name.clone(), parsed);
    }
    Ok(out)
}

/// Read one server entry, or say what is wrong with it.
///
/// Transport: an explicit `"transport"` wins; otherwise `"type"` (the
/// spelling Claude Code, Cursor and VS Code use); otherwise an entry with a
/// `"url"` and no `"command"` is remote. An entry that could not be started
/// (stdio without a command, remote without an http(s) URL) is an error here
/// rather than a server that fails at spawn with "No such file or directory".
pub(crate) fn parse_entry(value: &Value) -> Result<McpConfigEntry, String> {
    let obj = value
        .as_object()
        .ok_or_else(|| "the entry is not a JSON object".to_string())?;

    let command = optional_string(obj, "command")?.unwrap_or_default();
    let url = optional_string(obj, "url")?.filter(|u| !u.trim().is_empty());

    let named = match optional_string(obj, "transport")? {
        Some(name) => Some(("transport", name)),
        None => optional_string(obj, "type")?.map(|name| ("type", name)),
    };
    let transport = match named {
        Some((key, name)) => parse_transport_name(&name).ok_or_else(|| {
            format!(
                "\"{}\" is \"{}\"; expected \"stdio\" or \"http\" (\"streamable-http\" and \"sse\" are also read as http)",
                key, name
            )
        })?,
        None if command.trim().is_empty() && url.is_some() => McpTransport::Http,
        None => McpTransport::Stdio,
    };

    let args = match obj.get("args") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| {
                scalar_to_string(item)
                    .ok_or_else(|| "\"args\" must be an array of strings".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?,
        Some(_) => return Err("\"args\" must be an array of strings".to_string()),
    };

    let disabled = match obj.get("disabled") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(_) => return Err("\"disabled\" must be true or false".to_string()),
    };

    let entry = McpConfigEntry {
        command,
        args,
        env: string_map(obj, "env")?,
        disabled,
        transport,
        url,
        headers: string_map(obj, "headers")?,
        cwd: optional_string(obj, "cwd")?.filter(|c| !c.trim().is_empty()),
    };

    match entry.transport {
        McpTransport::Stdio if entry.command.trim().is_empty() => {
            if entry.url.is_some() {
                Err("a stdio server needs a \"command\"; for a remote server set \"type\": \"http\"".to_string())
            } else {
                Err("the entry has neither a \"command\" (local server) nor a \"url\" (remote server)".to_string())
            }
        }
        McpTransport::Http => match entry.url.as_deref() {
            None => Err("a remote server needs a \"url\"".to_string()),
            Some(u) if !(u.starts_with("http://") || u.starts_with("https://")) => {
                Err("\"url\" must start with http:// or https://".to_string())
            }
            Some(_) => Ok(entry),
        },
        McpTransport::Stdio => Ok(entry),
    }
}

// ---------------------------------------------------------------------------
// A file
// ---------------------------------------------------------------------------

/// What a config file yielded: the servers that could be read, and the
/// entries (or the file) that could not.
#[derive(Debug, Default)]
pub(crate) struct LoadedConfig {
    pub(crate) configs: Vec<McpServerConfig>,
    pub(crate) problems: Vec<McpConfigProblem>,
}

fn entry_to_config(name: String, entry: McpConfigEntry, source: &McpConfigSource) -> McpServerConfig {
    // All discovered MCP servers default to disabled for security,
    // regardless of source. A sandboxed agent can write its own entry
    // into ~/.notesage/mcp.json (the one $HOME dir it is always allowed
    // to write), and MCP servers are spawned UNSANDBOXED — so an
    // enabled-by-default global/external entry would be a kernel-sandbox
    // escape. Requiring an explicit user toggle (persisted as an
    // enabledOverride in mcp-store) before the first spawn closes that
    // path. The frontend merge in mcp-store applies the user's override
    // on top of this default, so previously user-enabled servers are
    // preserved while never-toggled ones stay off. `disabled: true` in the
    // file is therefore already "off unless the user overrides it".
    let McpConfigEntry {
        command,
        args,
        env,
        disabled: _,
        transport,
        url,
        headers,
        cwd,
    } = entry;
    McpServerConfig {
        id: format!("{}:{}", source_prefix(source), name),
        name,
        command,
        args,
        env,
        source: source.clone(),
        enabled: false,
        transport,
        url,
        headers,
        cwd,
    }
}

#[cfg(test)]
pub(crate) fn map_config_entries(
    entries: HashMap<String, McpConfigEntry>,
    source: McpConfigSource,
) -> Vec<McpServerConfig> {
    let mut configs: Vec<McpServerConfig> = entries
        .into_iter()
        .map(|(name, entry)| entry_to_config(name, entry, &source))
        .collect();
    configs.sort_by(|a, b| a.name.cmp(&b.name));
    configs
}

/// Find the servers object under the first of `key_paths` that exists
/// (`["mcpServers"]`, or `["mcp", "servers"]` for a nested one).
fn find_servers<'a>(root: &'a Value, key_paths: &[&[&str]]) -> Option<&'a Value> {
    key_paths.iter().find_map(|path| {
        let mut node = root;
        for key in *path {
            node = node.get(*key)?;
        }
        Some(node)
    })
}

/// Read every server out of a parsed config document. A missing servers key
/// is an empty file, not a problem; a servers key that is not an object is.
pub(crate) fn load_servers(
    root: &Value,
    label: &str,
    source: &McpConfigSource,
    key_paths: &[&[&str]],
) -> LoadedConfig {
    let mut loaded = LoadedConfig::default();
    let problem = |name: &str, reason: String| McpConfigProblem {
        name: name.to_string(),
        source: source_wire_name(source).to_string(),
        reason,
    };
    let servers = match find_servers(root, key_paths) {
        None | Some(Value::Null) => return loaded,
        Some(Value::Object(servers)) => servers,
        Some(_) => {
            let key = key_paths.first().map(|p| p.join(".")).unwrap_or_default();
            loaded
                .problems
                .push(problem(label, format!("\"{}\" must be an object of servers", key)));
            return loaded;
        }
    };
    for (name, value) in servers {
        match parse_entry(value) {
            Ok(entry) => loaded.configs.push(entry_to_config(name.clone(), entry, source)),
            Err(reason) => loaded.problems.push(problem(name, reason)),
        }
    }
    loaded.configs.sort_by(|a, b| a.name.cmp(&b.name));
    loaded.problems.sort_by(|a, b| a.name.cmp(&b.name));
    loaded
}

/// Read a config file. Never fails: a file that cannot be read or parsed is
/// one problem named after the file.
pub(crate) fn load_config_file(
    path: &Path,
    source: &McpConfigSource,
    key_paths: &[&[&str]],
) -> LoadedConfig {
    let label = path.display().to_string();
    let file_problem = |reason: String| LoadedConfig {
        configs: Vec::new(),
        problems: vec![McpConfigProblem {
            name: label.clone(),
            source: source_wire_name(source).to_string(),
            reason,
        }],
    };
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(e) => return file_problem(format!("The file could not be read: {}", e)),
    };
    if content.trim().is_empty() {
        return LoadedConfig::default();
    }
    match parse_json_lenient(&content) {
        Ok(root) => load_servers(&root, &label, source, key_paths),
        Err(e) => file_problem(format!("The file is not valid JSON: {}", e)),
    }
}

const MCP_SERVERS_KEY: &[&[&str]] = &[&["mcpServers"]];

/// Read a Notesage / Cursor style `mcp.json` (`{ "mcpServers": { … } }`).
pub(crate) fn load_mcp_json(path: &Path, source: &McpConfigSource) -> LoadedConfig {
    load_config_file(path, source, MCP_SERVERS_KEY)
}

/// Turn a load into the `Result` the import commands return: a file that
/// could not be read at all is an error; invalid entries are logged (by name)
/// and left out.
fn into_import_result(loaded: LoadedConfig, path: &Path) -> Result<Vec<McpServerConfig>, String> {
    let file_label = path.display().to_string();
    if loaded.configs.is_empty() {
        if let Some(problem) = loaded.problems.iter().find(|p| p.name == file_label) {
            return Err(format!("Failed to parse {}: {}", file_label, problem.reason));
        }
    }
    for problem in &loaded.problems {
        log::warn!(target: "notesage::mcp", "Skipping MCP server '{}' in {}: {}", problem.name, file_label, problem.reason);
    }
    Ok(loaded.configs)
}

pub(crate) fn parse_config_file(
    path: &Path,
    source: McpConfigSource,
) -> Result<Vec<McpServerConfig>, String> {
    if !path.exists() {
        return Err(format!("Failed to read {}: file not found", path.display()));
    }
    into_import_result(load_mcp_json(path, &source), path)
}

/// Everything Notesage's own config files define: each project's
/// `.notesage/mcp.json`, then the global `~/.notesage/mcp.json` (a global
/// server whose id a project already produced is left out, as before).
/// Problems are collected from every file; none of them hides a valid entry.
pub(crate) fn discover_notesage_configs(project_dirs: &[String], home: Option<&Path>) -> LoadedConfig {
    let mut all = LoadedConfig::default();

    for dir in project_dirs {
        let path = PathBuf::from(dir).join(".notesage").join("mcp.json");
        if path.exists() {
            let loaded = load_mcp_json(&path, &McpConfigSource::NotesageProject);
            all.configs.extend(loaded.configs);
            all.problems.extend(loaded.problems);
        }
    }

    if let Some(home) = home {
        let global_path = home.join(".notesage").join("mcp.json");
        if global_path.exists() {
            let loaded = load_mcp_json(&global_path, &McpConfigSource::NotesageGlobal);
            for config in loaded.configs {
                if !all.configs.iter().any(|c| c.id == config.id) {
                    all.configs.push(config);
                }
            }
            all.problems.extend(loaded.problems);
        }
    }

    all
}

/// The text to write for a config file whose servers are `servers`.
///
/// Entries are written VERBATIM: an entry the app could not parse, or a key
/// it does not know, is kept exactly as it was handed in, so saving one server
/// never destroys another (the typed save used to reject the whole file with
/// a raw serde error on the first unknown `transport`). Other top-level keys
/// of the existing file are kept as well.
pub(crate) fn render_config_file(
    existing: Option<&str>,
    servers: Map<String, Value>,
) -> Result<String, String> {
    for (name, entry) in &servers {
        if !entry.is_object() {
            return Err(format!("Server '{}' is not a JSON object", name));
        }
    }
    let mut root = existing
        .and_then(|text| parse_json_lenient(text).ok())
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default();
    root.insert("mcpServers".to_string(), Value::Object(servers));
    serde_json::to_string_pretty(&Value::Object(root))
        .map_err(|e| format!("Failed to serialize config: {}", e))
}

// ---------------------------------------------------------------------------
// Claude Desktop
// ---------------------------------------------------------------------------

/// Where Claude Desktop keeps its config, most likely first. `os` is
/// `std::env::consts::OS`, a parameter so every platform's answer is testable.
///
/// The last candidate, `~/.claude/claude_desktop_config.json`, is where this
/// app used to look. Claude Desktop never wrote there, but a file somebody
/// placed there to make the import work is still honoured.
pub(crate) fn claude_desktop_config_candidates(home: &Path, os: &str) -> Vec<PathBuf> {
    let file = "claude_desktop_config.json";
    let primary = match os {
        "macos" => home
            .join("Library")
            .join("Application Support")
            .join("Claude")
            .join(file),
        "windows" => home.join("AppData").join("Roaming").join("Claude").join(file),
        _ => home.join(".config").join("Claude").join(file),
    };
    vec![primary, home.join(".claude").join(file)]
}

/// The first Claude Desktop config that exists.
pub(crate) fn find_claude_desktop_config(home: &Path, os: &str) -> Option<PathBuf> {
    claude_desktop_config_candidates(home, os)
        .into_iter()
        .find(|p| p.exists())
}

/// Parse Claude Desktop config which wraps mcpServers inside a larger config
pub(crate) fn parse_claude_desktop_config(path: &Path) -> Result<Vec<McpServerConfig>, String> {
    into_import_result(
        load_config_file(path, &McpConfigSource::ClaudeDesktop, MCP_SERVERS_KEY),
        path,
    )
}

// ---------------------------------------------------------------------------
// VS Code
// ---------------------------------------------------------------------------

/// VS Code's per-user settings directory.
pub(crate) fn vscode_user_dir(home: &Path, os: &str) -> PathBuf {
    match os {
        "macos" => home
            .join("Library")
            .join("Application Support")
            .join("Code")
            .join("User"),
        "windows" => home.join("AppData").join("Roaming").join("Code").join("User"),
        _ => home.join(".config").join("Code").join("User"),
    }
}

/// Current VS Code: `User/mcp.json`, top-level key `servers`.
pub(crate) fn vscode_mcp_json_path(home: &Path, os: &str) -> PathBuf {
    vscode_user_dir(home, os).join("mcp.json")
}

/// Older VS Code: `User/settings.json`, key `mcp.servers` (or `mcp` → `servers`).
pub(crate) fn vscode_settings_path(home: &Path, os: &str) -> PathBuf {
    vscode_user_dir(home, os).join("settings.json")
}

/// The VS Code files that exist, `mcp.json` first.
pub(crate) fn find_vscode_configs(home: &Path, os: &str) -> Vec<PathBuf> {
    [vscode_mcp_json_path(home, os), vscode_settings_path(home, os)]
        .into_iter()
        .filter(|p| p.exists())
        .collect()
}

/// Parse a VS Code file: `mcp.json` (`servers`) or `settings.json`
/// (`mcp.servers` / `mcp` → `servers`). Both are JSONC.
pub(crate) fn parse_vscode_config(path: &Path) -> Result<Vec<McpServerConfig>, String> {
    let is_mcp_json = path.file_name().and_then(|n| n.to_str()) == Some("mcp.json");
    let key_paths: &[&[&str]] = if is_mcp_json {
        &[&["servers"], &["mcpServers"]]
    } else {
        &[&["mcp", "servers"], &["mcp.servers"]]
    };
    into_import_result(load_config_file(path, &McpConfigSource::VsCode, key_paths), path)
}

/// Every VS Code server: `mcp.json` and the legacy settings key, the former
/// winning when both define a name. An unreadable `settings.json` (it is the
/// user's whole editor config) does not hide what `mcp.json` has.
pub(crate) fn parse_vscode_configs(paths: &[PathBuf]) -> Result<Vec<McpServerConfig>, String> {
    let mut all: Vec<McpServerConfig> = Vec::new();
    let mut first_error: Option<String> = None;
    for path in paths {
        match parse_vscode_config(path) {
            Ok(configs) => {
                for config in configs {
                    if !all.iter().any(|c| c.id == config.id) {
                        all.push(config);
                    }
                }
            }
            Err(e) => {
                first_error.get_or_insert(e);
            }
        }
    }
    match first_error {
        Some(e) if all.is_empty() => Err(e),
        _ => Ok(all),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Write;

    fn stdio_entry(command: &str, args: &[&str]) -> McpConfigEntry {
        McpConfigEntry {
            command: command.to_string(),
            args: args.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        }
    }

    fn temp_file(name: &str, content: &str) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("create temp dir");
        let path = dir.path().join(name);
        let mut file = std::fs::File::create(&path).unwrap();
        write!(file, "{}", content).unwrap();
        (dir, path)
    }

    #[test]
    fn source_prefix_covers_all_variants() {
        assert_eq!(source_prefix(&McpConfigSource::NotesageGlobal), "global");
        assert_eq!(source_prefix(&McpConfigSource::NotesageProject), "project");
        assert_eq!(source_prefix(&McpConfigSource::ClaudeDesktop), "claude");
        assert_eq!(source_prefix(&McpConfigSource::Cursor), "cursor");
        assert_eq!(source_prefix(&McpConfigSource::VsCode), "vscode");
    }

    #[test]
    fn source_wire_name_matches_serde() {
        for source in [
            McpConfigSource::NotesageGlobal,
            McpConfigSource::NotesageProject,
            McpConfigSource::ClaudeDesktop,
            McpConfigSource::Cursor,
            McpConfigSource::VsCode,
        ] {
            assert_eq!(
                serde_json::to_value(&source).unwrap(),
                json!(source_wire_name(&source))
            );
        }
    }

    #[test]
    fn map_config_entries_basic() {
        let mut entries = HashMap::new();
        entries.insert("my-server".to_string(), stdio_entry("node", &["server.js"]));

        let result = map_config_entries(entries, McpConfigSource::NotesageGlobal);
        assert_eq!(result.len(), 1);

        let cfg = &result[0];
        assert_eq!(cfg.id, "global:my-server");
        assert_eq!(cfg.name, "my-server");
        assert_eq!(cfg.command, "node");
        assert_eq!(cfg.args, vec!["server.js"]);
        // All discovered servers default to disabled for security, regardless of
        // source — the user re-enables via a persisted override (see map closure).
        assert!(!cfg.enabled);
        assert_eq!(cfg.source, McpConfigSource::NotesageGlobal);
    }

    #[test]
    fn map_config_entries_respects_disabled_flag() {
        let mut entries = HashMap::new();
        entries.insert(
            "disabled-server".to_string(),
            McpConfigEntry { disabled: true, ..stdio_entry("npx", &[]) },
        );

        let result = map_config_entries(entries, McpConfigSource::NotesageGlobal);
        assert_eq!(result.len(), 1);
        assert!(!result[0].enabled);
    }

    #[test]
    fn map_config_entries_project_source_defaults_to_disabled() {
        let mut entries = HashMap::new();
        // Explicitly not disabled, but every discovered server starts off.
        entries.insert("project-server".to_string(), stdio_entry("python", &["mcp.py"]));

        let result = map_config_entries(entries, McpConfigSource::NotesageProject);
        assert_eq!(result.len(), 1);
        assert!(!result[0].enabled, "Project-scoped servers should default to disabled for security");
        assert_eq!(result[0].id, "project:project-server");
    }

    #[test]
    fn map_config_entries_preserves_env_vars() {
        let mut env = HashMap::new();
        env.insert("API_KEY".to_string(), McpEnvValue::Plain("secret".to_string()));
        env.insert("DEBUG".to_string(), McpEnvValue::Plain("true".to_string()));

        let mut entries = HashMap::new();
        entries.insert(
            "env-server".to_string(),
            McpConfigEntry { env, ..stdio_entry("node", &[]) },
        );

        let result = map_config_entries(entries, McpConfigSource::Cursor);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].env.get("API_KEY").unwrap(), &McpEnvValue::Plain("secret".to_string()));
        assert_eq!(result[0].env.get("DEBUG").unwrap(), &McpEnvValue::Plain("true".to_string()));
        assert_eq!(result[0].id, "cursor:env-server");
    }

    // --- one entry ---

    #[test]
    fn entry_transport_is_read_from_transport_type_or_inferred() {
        let cases: &[(Value, McpTransport)] = &[
            (json!({"command": "npx", "args": ["-y", "pkg"]}), McpTransport::Stdio),
            (json!({"type": "stdio", "command": "npx"}), McpTransport::Stdio),
            (json!({"transport": "stdio", "command": "npx"}), McpTransport::Stdio),
            (json!({"transport": "http", "url": "https://x.example/mcp"}), McpTransport::Http),
            // The de-facto standard remote syntax used to be silently ignored
            // and the entry became stdio with an empty command.
            (json!({"type": "http", "url": "https://x.example/mcp"}), McpTransport::Http),
            (json!({"type": "streamable-http", "url": "https://x.example/mcp"}), McpTransport::Http),
            (json!({"type": "streamable_http", "url": "https://x.example/mcp"}), McpTransport::Http),
            (json!({"type": "sse", "url": "https://x.example/sse"}), McpTransport::Http),
            (json!({"type": "HTTP", "url": "http://localhost:3000/mcp"}), McpTransport::Http),
            // Cursor writes a remote server as a bare url.
            (json!({"url": "https://x.example/mcp"}), McpTransport::Http),
            // An explicit transport wins over type.
            (json!({"transport": "stdio", "type": "http", "command": "npx"}), McpTransport::Stdio),
            // A command and a url with no hint: the command is what runs.
            (json!({"command": "npx", "url": "https://x.example/mcp"}), McpTransport::Stdio),
        ];
        for (value, expected) in cases {
            let entry = parse_entry(value).unwrap_or_else(|e| panic!("{value}: {e}"));
            assert_eq!(&entry.transport, expected, "{value}");
        }
    }

    #[test]
    fn entry_reads_headers_cwd_and_disabled() {
        let entry = parse_entry(&json!({
            "type": "http",
            "url": "https://x.example/mcp",
            "headers": { "X-Api-Key": { "secret": true }, "X-Tenant": "acme", "X-Version": 2 },
            "disabled": true
        }))
        .unwrap();
        assert_eq!(entry.headers.get("X-Api-Key"), Some(&McpEnvValue::Secret(McpSecretRef { secret: true })));
        assert_eq!(entry.headers.get("X-Tenant"), Some(&McpEnvValue::Plain("acme".to_string())));
        assert_eq!(entry.headers.get("X-Version"), Some(&McpEnvValue::Plain("2".to_string())));
        assert!(entry.disabled);

        let entry = parse_entry(&json!({"command": "node", "args": ["server.js"], "cwd": "~/src/server"})).unwrap();
        assert_eq!(entry.cwd.as_deref(), Some("~/src/server"));
        assert_eq!(parse_entry(&json!({"command": "node", "cwd": "  "})).unwrap().cwd, None);
    }

    #[test]
    fn entry_takes_scalar_env_values_and_args_as_text() {
        // `"PORT": 8080` used to fail serde for the whole file.
        let entry = parse_entry(&json!({
            "command": "node",
            "args": ["server.js", "--port", 8080, true],
            "env": { "PORT": 8080, "DEBUG": true, "TOKEN": { "secret": true }, "NAME": "x", "GONE": null }
        }))
        .unwrap();
        assert_eq!(entry.args, vec!["server.js", "--port", "8080", "true"]);
        assert_eq!(entry.env.get("PORT"), Some(&McpEnvValue::Plain("8080".to_string())));
        assert_eq!(entry.env.get("DEBUG"), Some(&McpEnvValue::Plain("true".to_string())));
        assert_eq!(entry.env.get("TOKEN"), Some(&McpEnvValue::Secret(McpSecretRef { secret: true })));
        assert!(!entry.env.contains_key("GONE"));
    }

    #[test]
    fn entry_problems_say_what_is_wrong_without_values() {
        let cases: &[(Value, &str)] = &[
            (json!("npx -y pkg"), "not a JSON object"),
            (json!({"transport": "carrier-pigeon", "command": "x"}), "\"transport\" is \"carrier-pigeon\""),
            (json!({"type": "websocket", "url": "wss://x"}), "\"type\" is \"websocket\""),
            (json!({"type": "http"}), "needs a \"url\""),
            (json!({"type": "http", "url": "x.example/mcp"}), "http:// or https://"),
            (json!({"type": "stdio", "url": "https://x.example/mcp"}), "needs a \"command\""),
            (json!({}), "neither a \"command\""),
            (json!({"command": ""}), "neither a \"command\""),
            (json!({"command": ["npx"]}), "\"command\" must be a string"),
            (json!({"command": "npx", "args": "-y pkg"}), "\"args\" must be an array"),
            (json!({"command": "npx", "args": [["nested"]]}), "\"args\" must be an array"),
            (json!({"command": "npx", "env": ["A=1"]}), "\"env\" must be an object"),
            (json!({"command": "npx", "env": {"TOKEN": ["s3cret-value"]}}), "\"env\".\"TOKEN\""),
            (json!({"command": "npx", "env": {"TOKEN": {"value": "s3cret-value"}}}), "\"env\".\"TOKEN\""),
            (json!({"url": "https://x", "headers": {"Authorization": ["s3cret-value"]}}), "\"headers\".\"Authorization\""),
            (json!({"command": "npx", "disabled": "yes"}), "\"disabled\""),
            (json!({"command": "npx", "cwd": 3}), "\"cwd\" must be a string"),
        ];
        for (value, expected) in cases {
            let reason = parse_entry(value).expect_err(&value.to_string());
            assert!(reason.contains(expected), "{value}: {reason}");
            assert!(!reason.contains("s3cret-value"), "a value leaked into: {reason}");
        }
    }

    // --- a file ---

    #[test]
    fn one_bad_entry_does_not_hide_the_good_ones() {
        // The regression: an unknown transport or a non-string env value made
        // serde reject the whole file, and Settings showed "No servers".
        let (_dir, path) = temp_file(
            "mcp.json",
            r#"{
                "mcpServers": {
                    "good-stdio": { "command": "npx", "args": ["-y", "pkg"] },
                    "good-remote": { "type": "http", "url": "https://x.example/mcp", "headers": { "X-Key": "k" } },
                    "bad-transport": { "transport": "carrier-pigeon", "command": "x" },
                    "bad-env": { "command": "node", "env": { "TOKEN": ["a"] } },
                    "empty": {}
                }
            }"#,
        );
        let loaded = load_mcp_json(&path, &McpConfigSource::NotesageGlobal);

        let names: Vec<&str> = loaded.configs.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["good-remote", "good-stdio"]);
        let remote = &loaded.configs[0];
        assert_eq!(remote.id, "global:good-remote");
        assert_eq!(remote.transport, McpTransport::Http);
        assert_eq!(remote.url.as_deref(), Some("https://x.example/mcp"));
        assert_eq!(remote.headers.get("X-Key"), Some(&McpEnvValue::Plain("k".to_string())));
        assert!(!remote.enabled);

        let problems: Vec<(&str, &str)> = loaded
            .problems
            .iter()
            .map(|p| (p.name.as_str(), p.source.as_str()))
            .collect();
        assert_eq!(
            problems,
            vec![
                ("bad-env", "notesage_global"),
                ("bad-transport", "notesage_global"),
                ("empty", "notesage_global"),
            ]
        );
        assert!(loaded.problems[1].reason.contains("carrier-pigeon"));

        // The `Result` flavour keeps the good entries too.
        let configs = parse_config_file(&path, McpConfigSource::NotesageGlobal).unwrap();
        assert_eq!(configs.len(), 2);
    }

    #[test]
    fn a_file_that_is_not_json_is_one_problem_named_after_the_file() {
        let (_dir, path) = temp_file("mcp.json", "{not valid json");
        let loaded = load_mcp_json(&path, &McpConfigSource::NotesageProject);
        assert!(loaded.configs.is_empty());
        assert_eq!(loaded.problems.len(), 1);
        assert_eq!(loaded.problems[0].name, path.display().to_string());
        assert_eq!(loaded.problems[0].source, "notesage_project");
        assert!(loaded.problems[0].reason.contains("not valid JSON"));
    }

    #[test]
    fn a_servers_key_of_the_wrong_type_is_a_problem_and_a_missing_one_is_not() {
        let (_dir, path) = temp_file("mcp.json", r#"{ "mcpServers": ["a", "b"] }"#);
        let loaded = load_mcp_json(&path, &McpConfigSource::NotesageGlobal);
        assert_eq!(loaded.problems.len(), 1);
        assert!(loaded.problems[0].reason.contains("mcpServers"));

        for content in ["{}", "", "  \n", r#"{ "mcpServers": null }"#, r#"{ "other": 1 }"#] {
            let (_dir, path) = temp_file("mcp.json", content);
            let loaded = load_mcp_json(&path, &McpConfigSource::NotesageGlobal);
            assert!(loaded.configs.is_empty() && loaded.problems.is_empty(), "{content:?}");
        }
    }

    #[test]
    fn parse_config_file_with_valid_json() {
        let (_dir, path) = temp_file(
            "mcp.json",
            r#"{
            "mcpServers": {
                "alpha": { "command": "node", "args": ["a.js"] },
                "beta":  { "command": "python", "args": ["-m", "mcp"], "disabled": true }
            }
        }"#,
        );

        let result = parse_config_file(&path, McpConfigSource::NotesageGlobal)
            .expect("should parse valid JSON");

        assert_eq!(result.len(), 2);

        let alpha = result.iter().find(|c| c.name == "alpha").unwrap();
        assert_eq!(alpha.id, "global:alpha");
        assert_eq!(alpha.command, "node");
        assert_eq!(alpha.args, vec!["a.js"]);
        // Disabled by default for all sources (security hardening) even though
        // the entry does not set `disabled`.
        assert!(!alpha.enabled);

        let beta = result.iter().find(|c| c.name == "beta").unwrap();
        assert!(!beta.enabled, "beta has disabled: true");
    }

    #[test]
    fn parse_config_file_with_invalid_json() {
        let (_dir, path) = temp_file("mcp.json", "{not valid json");
        let result = parse_config_file(&path, McpConfigSource::NotesageGlobal);
        assert!(result.is_err());
    }

    #[test]
    fn parse_config_file_with_missing_file() {
        let path = PathBuf::from("/tmp/notesage-test-nonexistent-mcp-config.json");
        let result = parse_config_file(&path, McpConfigSource::NotesageGlobal);
        assert!(result.is_err());
    }

    // --- discovery and saving ---

    #[test]
    fn discovery_reads_projects_then_global_and_collects_every_problem() {
        let home = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".notesage")).unwrap();
        std::fs::create_dir_all(project.path().join(".notesage")).unwrap();
        std::fs::write(
            home.path().join(".notesage").join("mcp.json"),
            r#"{ "mcpServers": {
                "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] },
                "remote": { "type": "streamable-http", "url": "https://x.example/mcp" },
                "broken": { "transport": "pigeon", "command": "x" }
            } }"#,
        )
        .unwrap();
        std::fs::write(
            project.path().join(".notesage").join("mcp.json"),
            r#"{ "mcpServers": { "local": { "command": "node", "args": ["s.js"], "env": { "PORT": 1 } }, "half": { "type": "http" } } }"#,
        )
        .unwrap();
        let no_file = tempfile::tempdir().unwrap();
        let dirs = vec![
            project.path().to_string_lossy().to_string(),
            no_file.path().to_string_lossy().to_string(),
        ];

        let found = discover_notesage_configs(&dirs, Some(home.path()));
        let ids: Vec<&str> = found.configs.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["project:local", "global:memory", "global:remote"]);
        assert!(found.configs.iter().all(|c| !c.enabled));
        let problems: Vec<(&str, &str)> = found.problems.iter().map(|p| (p.name.as_str(), p.source.as_str())).collect();
        assert_eq!(problems, vec![("half", "notesage_project"), ("broken", "notesage_global")]);

        // No files anywhere: nothing, and no problems.
        let empty = discover_notesage_configs(&[], Some(no_file.path()));
        assert!(empty.configs.is_empty() && empty.problems.is_empty());
        let no_home = discover_notesage_configs(&[], None);
        assert!(no_home.configs.is_empty() && no_home.problems.is_empty());
    }

    #[test]
    fn saving_keeps_entries_the_app_cannot_parse_and_keys_it_does_not_know() {
        // The frontend reads the file, adds one entry and saves the lot. The
        // typed save used to fail with a raw serde error on `bad`.
        let existing = r#"{ "note": "kept", "mcpServers": { "old": { "command": "gone" } } }"#;
        let mut servers = Map::new();
        servers.insert("bad".to_string(), json!({ "transport": "pigeon", "command": "x", "futureKey": [1, 2] }));
        servers.insert(
            "new".to_string(),
            json!({ "transport": "http", "url": "https://x.example/mcp", "headers": { "X-Key": { "secret": true } }, "cwd": "~/w" }),
        );
        let text = render_config_file(Some(existing), servers).unwrap();
        let written: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(written["note"], "kept");
        assert_eq!(written["mcpServers"]["bad"], json!({ "transport": "pigeon", "command": "x", "futureKey": [1, 2] }));
        assert_eq!(written["mcpServers"]["new"]["headers"]["X-Key"], json!({ "secret": true }));
        assert_eq!(written["mcpServers"]["new"]["cwd"], "~/w");
        // The servers object is replaced, not merged: removing a server works.
        assert!(written["mcpServers"].get("old").is_none());

        // What was written loads again: the good entry in, the bad one a problem.
        let loaded = load_servers(&written, "mcp.json", &McpConfigSource::NotesageGlobal, MCP_SERVERS_KEY);
        assert_eq!(loaded.configs.len(), 1);
        assert_eq!(loaded.problems.len(), 1);
    }

    #[test]
    fn saving_starts_fresh_without_a_usable_existing_file_and_rejects_non_objects() {
        for existing in [None, Some(""), Some("{not json"), Some("[1, 2]")] {
            let mut servers = Map::new();
            servers.insert("a".to_string(), json!({ "command": "npx" }));
            let text = render_config_file(existing, servers).unwrap();
            assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), json!({ "mcpServers": { "a": { "command": "npx" } } }));
        }
        let mut servers = Map::new();
        servers.insert("a".to_string(), json!("npx -y pkg"));
        assert!(render_config_file(None, servers).unwrap_err().contains("'a'"));
    }

    // --- JSONC ---

    #[test]
    fn strip_jsonc_removes_comments_and_trailing_commas_but_not_string_contents() {
        let cases: &[(&str, Value)] = &[
            ("{ // a comment\n \"a\": 1 }", json!({"a": 1})),
            ("{ /* block */ \"a\": /* inline */ 1 }", json!({"a": 1})),
            ("{ \"a\": [1, 2, 3,], }", json!({"a": [1, 2, 3]})),
            ("{ \"a\": 1, // trailing\n }", json!({"a": 1})),
            ("{ \"a\": 1 /* multi\n line\n comment */ ,\n \"b\": 2,\n}", json!({"a": 1, "b": 2})),
            // A URL's `//` and a comment marker inside a string are content.
            ("{ \"url\": \"https://x.example/mcp\" }", json!({"url": "https://x.example/mcp"})),
            ("{ \"a\": \"/* not a comment */\", \"b\": \"// nor this\" }", json!({"a": "/* not a comment */", "b": "// nor this"})),
            // An escaped quote does not end the string.
            ("{ \"a\": \"say \\\"hi\\\" // still a string\" }", json!({"a": "say \"hi\" // still a string"})),
            ("{ \"a\": \"back\\\\\\\\\" } // comment", json!({"a": "back\\\\"})),
            // A comma inside a string before a bracket stays.
            ("{ \"a\": \"x,\" }", json!({"a": "x,"})),
            ("[\"a,\"]", json!(["a,"])),
            ("// only a comment\n{}", json!({})),
            ("{}\n// trailing comment without newline", json!({})),
            ("{ \"a\": 1 /* unterminated", Value::Null),
        ];
        for (input, expected) in cases {
            let stripped = strip_jsonc(input);
            if expected.is_null() {
                assert!(serde_json::from_str::<Value>(&stripped).is_err(), "{input:?} -> {stripped:?}");
                continue;
            }
            let parsed: Value = serde_json::from_str(&stripped)
                .unwrap_or_else(|e| panic!("{input:?} -> {stripped:?}: {e}"));
            assert_eq!(&parsed, expected, "{input:?}");
        }
    }

    #[test]
    fn strip_jsonc_leaves_plain_json_alone() {
        let plain = r#"{"mcpServers":{"a":{"command":"npx","args":["-y","@scope/pkg"],"env":{"URL":"http://localhost:1//x"}}}}"#;
        assert_eq!(strip_jsonc(plain), plain);
    }

    #[test]
    fn lenient_parse_reports_the_strict_error_when_stripping_does_not_help() {
        assert!(parse_json_lenient("{not valid json").is_err());
        assert_eq!(parse_json_lenient("\u{feff}{\"a\": 1,}").unwrap(), json!({"a": 1}));
    }

    // --- Claude Desktop ---

    #[test]
    fn claude_desktop_config_is_looked_up_where_claude_desktop_writes_it() {
        let home = Path::new("/Users/me");
        assert_eq!(
            claude_desktop_config_candidates(home, "macos")[0],
            PathBuf::from("/Users/me/Library/Application Support/Claude/claude_desktop_config.json")
        );
        assert_eq!(
            claude_desktop_config_candidates(Path::new("/home/me"), "linux")[0],
            PathBuf::from("/home/me/.config/Claude/claude_desktop_config.json")
        );
        assert!(claude_desktop_config_candidates(home, "windows")[0].ends_with("AppData/Roaming/Claude/claude_desktop_config.json"));
        // The old (wrong) location is still honoured, last.
        assert_eq!(
            claude_desktop_config_candidates(home, "macos").last().unwrap(),
            &PathBuf::from("/Users/me/.claude/claude_desktop_config.json")
        );
    }

    #[test]
    fn find_claude_desktop_config_prefers_the_real_location() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(find_claude_desktop_config(home.path(), "macos"), None);

        let legacy = home.path().join(".claude");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::write(legacy.join("claude_desktop_config.json"), "{}").unwrap();
        assert_eq!(
            find_claude_desktop_config(home.path(), "macos"),
            Some(legacy.join("claude_desktop_config.json"))
        );

        let real = home.path().join("Library").join("Application Support").join("Claude");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::write(real.join("claude_desktop_config.json"), "{}").unwrap();
        assert_eq!(
            find_claude_desktop_config(home.path(), "macos"),
            Some(real.join("claude_desktop_config.json"))
        );
    }

    #[test]
    fn parse_claude_desktop_config_valid() {
        let (_dir, path) = temp_file(
            "claude_desktop_config.json",
            r#"{
            "globalShortcut": "Ctrl+Space",
            "mcpServers": {
                "test": { "command": "node", "args": ["server.js"] }
            }
        }"#,
        );

        let result = parse_claude_desktop_config(&path).expect("should parse Claude Desktop config");

        assert_eq!(result.len(), 1);
        let server = &result[0];
        assert_eq!(server.name, "test");
        assert_eq!(server.command, "node");
        assert_eq!(server.args, vec!["server.js"]);
        assert_eq!(server.source, McpConfigSource::ClaudeDesktop);
        assert_eq!(server.id, "claude:test");
        // Disabled by default for all sources (security hardening); user re-enables.
        assert!(!server.enabled);
    }

    // --- VS Code ---

    #[test]
    fn vscode_paths_per_platform() {
        let home = Path::new("/Users/me");
        assert_eq!(
            vscode_mcp_json_path(home, "macos"),
            PathBuf::from("/Users/me/Library/Application Support/Code/User/mcp.json")
        );
        assert_eq!(
            vscode_settings_path(home, "macos"),
            PathBuf::from("/Users/me/Library/Application Support/Code/User/settings.json")
        );
        assert_eq!(
            vscode_mcp_json_path(Path::new("/home/me"), "linux"),
            PathBuf::from("/home/me/.config/Code/User/mcp.json")
        );
    }

    #[test]
    fn parse_vscode_config_valid() {
        let (_dir, path) = temp_file(
            "settings.json",
            r#"{
            "mcp": {
                "servers": {
                    "test": { "command": "npx", "args": ["-y", "@mcp/server"] }
                }
            }
        }"#,
        );

        let result = parse_vscode_config(&path).expect("should parse VS Code config");

        assert_eq!(result.len(), 1);
        let server = &result[0];
        assert_eq!(server.name, "test");
        assert_eq!(server.command, "npx");
        assert_eq!(server.args, vec!["-y", "@mcp/server"]);
        assert_eq!(server.source, McpConfigSource::VsCode);
        assert_eq!(server.id, "vscode:test");
        // Disabled by default for all sources (security hardening); user re-enables.
        assert!(!server.enabled);
    }

    #[test]
    fn parse_vscode_settings_with_the_dotted_key_and_comments() {
        let (_dir, path) = temp_file(
            "settings.json",
            "{\n  // editor\n  \"editor.fontSize\": 13,\n  \"mcp.servers\": {\n    \"dotted\": { \"command\": \"uvx\", \"args\": [\"mcp-server-git\"], },\n  },\n}\n",
        );
        let result = parse_vscode_config(&path).expect("JSONC settings parse");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "vscode:dotted");
    }

    #[test]
    fn parse_vscode_mcp_json_with_servers_key_remote_entries_and_jsonc() {
        // Current VS Code: User/mcp.json, top-level `servers`, with comments.
        let (_dir, path) = temp_file(
            "mcp.json",
            r#"{
  // Added by the MCP: Add Server command
  "servers": {
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "X-Trace": "on" }
    },
    "fs": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/docs"], /* trailing comma next */
    },
  },
  "inputs": []
}"#,
        );
        let result = parse_vscode_config(&path).expect("mcp.json parses");
        assert_eq!(result.len(), 2);
        let fs = result.iter().find(|c| c.name == "fs").unwrap();
        assert_eq!(fs.transport, McpTransport::Stdio);
        assert_eq!(fs.command, "npx");
        let github = result.iter().find(|c| c.name == "github").unwrap();
        // Imported entries keep their transport and url.
        assert_eq!(github.transport, McpTransport::Http);
        assert_eq!(github.url.as_deref(), Some("https://api.githubcopilot.com/mcp/"));
        assert_eq!(github.headers.get("X-Trace"), Some(&McpEnvValue::Plain("on".to_string())));
        assert_eq!(github.id, "vscode:github");
    }

    #[test]
    fn vscode_import_merges_mcp_json_and_settings_and_survives_a_broken_settings_file() {
        let home = tempfile::tempdir().unwrap();
        let user = vscode_user_dir(home.path(), "macos");
        std::fs::create_dir_all(&user).unwrap();
        assert!(find_vscode_configs(home.path(), "macos").is_empty());

        std::fs::write(
            user.join("mcp.json"),
            r#"{ "servers": { "shared": { "command": "new" }, "only-new": { "command": "a" } } }"#,
        )
        .unwrap();
        std::fs::write(
            user.join("settings.json"),
            r#"{ "mcp": { "servers": { "shared": { "command": "old" }, "only-old": { "command": "b" } } } }"#,
        )
        .unwrap();
        let paths = find_vscode_configs(home.path(), "macos");
        assert_eq!(paths.len(), 2);
        let all = parse_vscode_configs(&paths).unwrap();
        let mut names: Vec<(&str, &str)> = all.iter().map(|c| (c.name.as_str(), c.command.as_str())).collect();
        names.sort_unstable();
        assert_eq!(names, vec![("only-new", "a"), ("only-old", "b"), ("shared", "new")]);

        std::fs::write(user.join("settings.json"), "{ this is not json").unwrap();
        let all = parse_vscode_configs(&paths).unwrap();
        assert_eq!(all.len(), 2, "mcp.json still imports when settings.json is broken");

        std::fs::write(user.join("mcp.json"), "{ nor is this").unwrap();
        assert!(parse_vscode_configs(&paths).is_err());
    }
}
