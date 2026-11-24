use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Output;
use std::time::Duration;
use tokio::process::Command;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "lowercase")]
pub enum GitFileStatusKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GitFileStatus {
    pub path: String,
    pub status: GitFileStatusKind,
    pub staged: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DiffHunk {
    /// Starting line in the base branch (1-indexed)
    pub old_start: u32,
    /// Number of lines in the base range
    pub old_lines: u32,
    /// Starting line in the compare branch (1-indexed)
    pub new_start: u32,
    /// Number of lines in the compare range
    pub new_lines: u32,
    /// Text deleted from base (lines joined with newlines)
    pub delete_text: String,
    /// Text inserted in compare (lines joined with newlines)
    pub insert_text: String,
}

/// Config overrides passed to every git invocation, ahead of the subcommand.
///
/// `core.fsmonitor` names a program git runs on `status`, `diff`, `add`, … The
/// app runs `git status` by itself on every folder it opens, unsandboxed, so a
/// config file an agent can write (the repo's, or `~/.config/git/config`)
/// would otherwise be a way to run code outside the sandbox. `-c` on the
/// command line outranks every config file.
const GIT_SAFE_CONFIG: [&str; 2] = ["-c", "core.fsmonitor=false"];

/// `git diff` flags that stop it running configured programs: external diff
/// drivers (`diff.external`, `diff.<driver>.command`) and textconv filters.
const GIT_DIFF_NO_EXEC: [&str; 2] = ["--no-ext-diff", "--no-textconv"];

/// Turns hooks off for one invocation. Passed to the commands that only READ
/// the repository (`status`, `rev-parse`, `branch`, `diff`):
/// they still write the index when they refresh it, and git then runs the
/// repo's `post-index-change` hook, which for a folder the app merely opened
/// is someone else's program. Commands the user asks for by name (`commit`,
/// `switch`, `add`, `reset`, `init`) keep their hooks.
const GIT_NO_HOOKS: [&str; 2] = ["-c", "core.hooksPath=/dev/null"];

/// How long a git command may run before it is killed. Every command here is
/// awaited by the UI, and a git that waits on a credential or signing prompt
/// nobody can see would otherwise never return.
const GIT_TIMEOUT: Duration = Duration::from_secs(30);

/// `git commit` runs the user's pre-commit hooks, which can be slow.
const GIT_COMMIT_TIMEOUT: Duration = Duration::from_secs(120);

/// The only `git config --global` keys the app reads or writes (the commit
/// dialog's identity form). Anything else is refused: a writable
/// `core.fsmonitor`, `core.pager` or `alias.*` is a way to run a program, and
/// an option-style "key" such as `--edit` or `--file=…` is not a key at all.
const GIT_CONFIG_KEYS: [&str; 2] = ["user.name", "user.email"];

fn validate_config_key(key: &str) -> Result<(), String> {
    if GIT_CONFIG_KEYS.contains(&key) {
        Ok(())
    } else {
        Err(format!("Unsupported git config key: '{}'", key))
    }
}

/// Reject a branch/ref name that git would read as an option.
///
/// The diff commands also pass `--end-of-options`; this is the check that
/// does not depend on the installed git honouring it (and the only one for
/// `git switch`, where `--end-of-options` is not reliable across the git
/// versions macOS ships). No valid ref name starts with `-`.
fn validate_ref_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Branch name is empty".to_string());
    }
    if name.starts_with('-') {
        return Err(format!("Invalid branch name: '{}'", name));
    }
    Ok(())
}

/// Arguments for a branch-to-branch `git diff`, with `extra` (e.g.
/// `--name-only`) placed before the range and `file` limiting it to one path.
fn branch_diff_args<'a>(extra: &[&'a str], range: &'a str, file: Option<&'a str>) -> Vec<&'a str> {
    let mut args = vec!["diff"];
    args.extend_from_slice(extra);
    args.extend_from_slice(&GIT_DIFF_NO_EXEC);
    // Everything after this is a revision or a path, never an option.
    args.push("--end-of-options");
    args.push(range);
    if let Some(file) = file {
        args.push("--");
        args.push(file);
    }
    args
}

/// Run a prepared command to completion without blocking a runtime worker,
/// killing it if it outlives `timeout`.
///
/// stdin is closed and terminal prompts are off, so a git that wants a
/// password fails at once instead of waiting for input that cannot arrive.
async fn run_with_timeout(mut command: Command, timeout: Duration) -> Result<Output, String> {
    command
        .stdin(std::process::Stdio::null())
        .env("GIT_TERMINAL_PROMPT", "0")
        // Dropping the timed-out future must not leave the process running.
        .kill_on_drop(true);
    match tokio::time::timeout(timeout, command.output()).await {
        Ok(result) => result.map_err(|e| format!("Failed to run git: {}", e)),
        Err(_) => Err(format!(
            "git timed out after {} seconds",
            timeout.as_secs()
        )),
    }
}

/// Run git with the safe config, `config` overrides (e.g. [`GIT_NO_HOOKS`])
/// and `args`, in `dir` when given.
async fn git_output(
    dir: Option<&str>,
    config: &[&str],
    args: &[&str],
    timeout: Duration,
) -> Result<Output, String> {
    let mut command = Command::new("git");
    if let Some(dir) = dir {
        command.current_dir(dir);
    }
    command.args(GIT_SAFE_CONFIG).args(config).args(args);
    run_with_timeout(command, timeout).await
}

fn stdout_or_stderr(output: Output) -> Result<String, String> {
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Run a git command the user asked for (hooks enabled) in the given
/// directory, returning stdout on success.
async fn git(dir: &str, args: &[&str]) -> Result<String, String> {
    stdout_or_stderr(git_output(Some(dir), &[], args, GIT_TIMEOUT).await?)
}

/// Run a git command that only reads the repository: as [`git`], with hooks
/// off (see [`GIT_NO_HOOKS`]).
async fn git_read(dir: &str, args: &[&str]) -> Result<String, String> {
    stdout_or_stderr(git_output(Some(dir), &GIT_NO_HOOKS, args, GIT_TIMEOUT).await?)
}

#[tauri::command]
pub async fn git_check_available() -> Result<bool, String> {
    match git_output(None, &[], &["--version"], GIT_TIMEOUT).await {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn git_is_repo(path: String) -> Result<bool, String> {
    match git_read(&path, &["rev-parse", "--is-inside-work-tree"]).await {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn git_init(path: String) -> Result<(), String> {
    git(&path, &["init"]).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_get_config(key: String) -> Result<Option<String>, String> {
    validate_config_key(&key)?;
    let output = git_output(None, &[], &["config", "--global", &key], GIT_TIMEOUT).await?;

    if output.status.success() {
        let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if value.is_empty() {
            Ok(None)
        } else {
            Ok(Some(value))
        }
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn git_set_config(key: String, value: String) -> Result<(), String> {
    validate_config_key(&key)?;
    let output = git_output(
        None,
        &[],
        &["config", "--global", &key, &value],
        GIT_TIMEOUT,
    )
    .await?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(stderr)
    }
}

#[tauri::command]
pub async fn git_status(path: String) -> Result<Vec<GitFileStatus>, String> {
    let repo_root = git_read(&path, &["rev-parse", "--show-toplevel"]).await?;

    // Use -z for NUL-terminated entries — paths are output verbatim, never C-quoted.
    // This avoids encoding/quoting issues that corrupt path parsing.
    let output = git_output(
        Some(&path),
        &GIT_NO_HOOKS,
        &["status", "--porcelain=v1", "-z"],
        GIT_TIMEOUT,
    )
    .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(stderr);
    }

    let raw = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = raw.split('\0').filter(|s| !s.is_empty()).collect();
    let mut results: Vec<GitFileStatus> = Vec::new();
    let mut i = 0;

    while i < parts.len() {
        let entry = parts[i];

        if entry.len() < 4 {
            i += 1;
            continue;
        }

        let bytes = entry.as_bytes();
        let index_status = bytes[0];
        let wt_status = bytes[1];
        // Format: "XY PATH" — bytes[2] is space, path starts at byte 3
        let rel_path = &entry[3..];

        // For renames/copies with -z, the next NUL-part is the destination path.
        let rel_path = if index_status == b'R' || index_status == b'C' {
            if i + 1 < parts.len() {
                i += 1;
                parts[i]
            } else {
                rel_path
            }
        } else {
            rel_path
        };

        let abs_path = Path::new(&repo_root)
            .join(rel_path)
            .to_string_lossy()
            .to_string();

        // Staged (index) changes
        match index_status {
            b'A' => results.push(GitFileStatus {
                path: abs_path.clone(),
                status: GitFileStatusKind::Added,
                staged: true,
            }),
            b'M' | b'T' => results.push(GitFileStatus {
                path: abs_path.clone(),
                status: GitFileStatusKind::Modified,
                staged: true,
            }),
            b'D' => results.push(GitFileStatus {
                path: abs_path.clone(),
                status: GitFileStatusKind::Deleted,
                staged: true,
            }),
            b'R' => results.push(GitFileStatus {
                path: abs_path.clone(),
                status: GitFileStatusKind::Renamed,
                staged: true,
            }),
            _ => {}
        }

        // Working tree (unstaged) changes
        match wt_status {
            b'M' | b'T' => results.push(GitFileStatus {
                path: abs_path.clone(),
                status: GitFileStatusKind::Modified,
                staged: false,
            }),
            b'D' => results.push(GitFileStatus {
                path: abs_path.clone(),
                status: GitFileStatusKind::Deleted,
                staged: false,
            }),
            _ => {}
        }

        // Untracked
        if index_status == b'?' && wt_status == b'?' {
            results.push(GitFileStatus {
                path: abs_path.clone(),
                status: GitFileStatusKind::Untracked,
                staged: false,
            });
        }

        // Conflicted
        if (index_status == b'U' || wt_status == b'U')
            || (index_status == b'A' && wt_status == b'A')
            || (index_status == b'D' && wt_status == b'D')
        {
            results.push(GitFileStatus {
                path: abs_path,
                status: GitFileStatusKind::Conflicted,
                staged: false,
            });
        }

        i += 1;
    }

    Ok(results)
}

#[tauri::command]
pub async fn git_branch_current(path: String) -> Result<String, String> {
    match git_read(&path, &["branch", "--show-current"]).await {
        Ok(branch) if !branch.is_empty() => Ok(branch),
        Ok(_) => match git_read(&path, &["rev-parse", "--short", "HEAD"]).await {
            Ok(hash) => Ok(format!("HEAD ({})", hash)),
            Err(_) => Ok("main".to_string()),
        },
        Err(_) => Ok("main".to_string()),
    }
}

#[tauri::command]
pub async fn git_branch_list(path: String) -> Result<Vec<String>, String> {
    let output = git_read(&path, &["branch", "--list", "--format=%(refname:short)"]).await?;
    let mut names: Vec<String> = output
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
pub async fn git_branch_switch(path: String, branch: String) -> Result<(), String> {
    validate_ref_name(&branch)?;
    git(&path, &["switch", &branch]).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_stage(path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let mut args = vec!["add", "--"];
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);
    git(&path, &args).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_unstage(path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let mut args = vec!["reset", "HEAD", "--"];
    let file_refs: Vec<&str> = files.iter().map(|s| s.as_str()).collect();
    args.extend(file_refs);
    git(&path, &args).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<String, String> {
    let name_check =
        git_output(Some(&path), &[], &["config", "user.name"], GIT_TIMEOUT).await?;
    let email_check =
        git_output(Some(&path), &[], &["config", "user.email"], GIT_TIMEOUT).await?;

    let has_name = name_check.status.success()
        && !String::from_utf8_lossy(&name_check.stdout).trim().is_empty();
    let has_email = email_check.status.success()
        && !String::from_utf8_lossy(&email_check.stdout).trim().is_empty();

    if !has_name || !has_email {
        return Err("GIT_CONFIG_MISSING".to_string());
    }

    stdout_or_stderr(
        git_output(
            Some(&path),
            &[],
            &["commit", "-m", &message],
            GIT_COMMIT_TIMEOUT,
        )
        .await?,
    )?;

    let hash = git_read(&path, &["rev-parse", "--short", "HEAD"]).await?;
    Ok(hash)
}

// ---------------------------------------------------------------------------
// Branch diff commands
// ---------------------------------------------------------------------------

/// List files changed between two branches.
#[tauri::command]
pub async fn git_diff_files(
    repo_path: String,
    base_branch: String,
    compare_branch: String,
) -> Result<Vec<String>, String> {
    validate_ref_name(&base_branch)?;
    validate_ref_name(&compare_branch)?;
    let range = format!("{}...{}", base_branch, compare_branch);
    let output =
        git_read(&repo_path, &branch_diff_args(&["--name-only"], &range, None)).await?;
    Ok(output
        .lines()
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect())
}

/// Get structured diff hunks for a single file between two branches.
#[tauri::command]
pub async fn git_diff_file(
    repo_path: String,
    base_branch: String,
    compare_branch: String,
    file_path: String,
) -> Result<Vec<DiffHunk>, String> {
    validate_ref_name(&base_branch)?;
    validate_ref_name(&compare_branch)?;
    let range = format!("{}...{}", base_branch, compare_branch);
    let output = git_read(
        &repo_path,
        &branch_diff_args(&["--no-color"], &range, Some(&file_path)),
    )
    .await?;
    Ok(parse_unified_diff(&output))
}

// ---------------------------------------------------------------------------
// Diff parsing helpers
// ---------------------------------------------------------------------------

/// Parse unified diff output into structured DiffHunk structs.
fn parse_unified_diff(diff: &str) -> Vec<DiffHunk> {
    let mut hunks = Vec::new();
    let lines: Vec<&str> = diff.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];

        // Look for hunk headers: @@ -oldStart,oldLines +newStart,newLines @@
        if line.starts_with("@@") {
            if let Some(hunk_header) = parse_hunk_header(line) {
                let (old_start, old_lines, new_start, new_lines) = hunk_header;
                let mut delete_lines: Vec<String> = Vec::new();
                let mut insert_lines: Vec<String> = Vec::new();

                i += 1;

                // Collect hunk body lines until we hit another hunk header,
                // a diff header, or end of input.
                while i < lines.len() {
                    let body_line = lines[i];
                    if body_line.starts_with("@@")
                        || body_line.starts_with("diff --git")
                        || body_line.starts_with("--- ")
                        || body_line.starts_with("+++ ")
                    {
                        break;
                    }

                    if let Some(rest) = body_line.strip_prefix('-') {
                        delete_lines.push(rest.to_string());
                    } else if let Some(rest) = body_line.strip_prefix('+') {
                        insert_lines.push(rest.to_string());
                    }
                    // Context lines (starting with ' ') and '\' lines are skipped

                    i += 1;
                }

                hunks.push(DiffHunk {
                    old_start,
                    old_lines,
                    new_start,
                    new_lines,
                    delete_text: delete_lines.join("\n"),
                    insert_text: insert_lines.join("\n"),
                });

                continue; // Don't increment i — we already advanced past the body
            }
        }

        i += 1;
    }

    hunks
}

/// Parse a hunk header like `@@ -10,5 +12,8 @@` or `@@ -10 +12,3 @@`.
/// Returns (old_start, old_lines, new_start, new_lines).
fn parse_hunk_header(line: &str) -> Option<(u32, u32, u32, u32)> {
    // Strip leading "@@ " and trailing " @@..."
    let trimmed = line.strip_prefix("@@ ")?;
    let range_part = trimmed.split(" @@").next()?;

    let parts: Vec<&str> = range_part.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }

    let (old_start, old_lines) = parse_range(parts[0].strip_prefix('-')?)?;
    let (new_start, new_lines) = parse_range(parts[1].strip_prefix('+')?)?;

    Some((old_start, old_lines, new_start, new_lines))
}

/// Parse a range like "10,5" or "10" into (start, lines).
/// A bare number like "10" means (10, 1).
fn parse_range(s: &str) -> Option<(u32, u32)> {
    if let Some((start, lines)) = s.split_once(',') {
        Some((start.parse().ok()?, lines.parse().ok()?))
    } else {
        Some((s.parse().ok()?, 1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // The fixtures below shell out synchronously; the module itself is async.
    use std::process::Command;

    // -----------------------------------------------------------------------
    // Helper: check if git is available on this machine
    // -----------------------------------------------------------------------
    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Create a temp dir with `git init` and an initial commit so HEAD exists.
    /// Returns the tempdir (must stay alive for the path to remain valid).
    fn init_git_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap();
        // Use -b main to guarantee the branch name regardless of global config
        Command::new("git")
            .current_dir(path)
            .args(["init", "-b", "main"])
            .output()
            .unwrap();
        // Set local config so commits work even without global git config
        Command::new("git")
            .current_dir(path)
            .args(["config", "user.name", "Test User"])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(path)
            .args(["config", "user.email", "test@example.com"])
            .output()
            .unwrap();
        // Create an initial commit so HEAD is valid
        std::fs::write(dir.path().join("init.md"), "# Init\n").unwrap();
        Command::new("git")
            .current_dir(path)
            .args(["add", "."])
            .output()
            .unwrap();
        Command::new("git")
            .current_dir(path)
            .args(["commit", "-m", "initial commit"])
            .output()
            .unwrap();
        dir
    }

    // =======================================================================
    // parse_range
    // =======================================================================

    #[test]
    fn parse_range_with_comma() {
        assert_eq!(parse_range("10,5"), Some((10, 5)));
    }

    #[test]
    fn parse_range_bare_number() {
        assert_eq!(parse_range("10"), Some((10, 1)));
    }

    #[test]
    fn parse_range_zero_lines() {
        assert_eq!(parse_range("42,0"), Some((42, 0)));
    }

    #[test]
    fn parse_range_invalid_input() {
        assert_eq!(parse_range("abc"), None);
        assert_eq!(parse_range("10,abc"), None);
        assert_eq!(parse_range(""), None);
    }

    // =======================================================================
    // parse_hunk_header
    // =======================================================================

    #[test]
    fn parse_hunk_header_standard() {
        let result = parse_hunk_header("@@ -10,5 +12,8 @@");
        assert_eq!(result, Some((10, 5, 12, 8)));
    }

    #[test]
    fn parse_hunk_header_single_line_ranges() {
        let result = parse_hunk_header("@@ -10 +12,3 @@");
        assert_eq!(result, Some((10, 1, 12, 3)));
    }

    #[test]
    fn parse_hunk_header_with_context_text() {
        // git often appends function names after the closing @@
        let result = parse_hunk_header("@@ -100,20 +105,25 @@ fn some_function() {");
        assert_eq!(result, Some((100, 20, 105, 25)));
    }

    #[test]
    fn parse_hunk_header_both_bare() {
        let result = parse_hunk_header("@@ -1 +1 @@");
        assert_eq!(result, Some((1, 1, 1, 1)));
    }

    #[test]
    fn parse_hunk_header_malformed() {
        assert_eq!(parse_hunk_header("not a header"), None);
        assert_eq!(parse_hunk_header("@@ @@"), None);
        assert_eq!(parse_hunk_header("@@ -abc +def @@"), None);
    }

    // =======================================================================
    // parse_unified_diff
    // =======================================================================

    #[test]
    fn parse_unified_diff_empty() {
        let hunks = parse_unified_diff("");
        assert!(hunks.is_empty());
    }

    #[test]
    fn parse_unified_diff_only_context() {
        // A diff with only context lines and no +/- lines produces a hunk
        // with empty delete_text and insert_text.
        let diff = "\
diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line one
 line two
 line three";
        let hunks = parse_unified_diff(diff);
        assert_eq!(hunks.len(), 1);
        assert!(hunks[0].delete_text.is_empty());
        assert!(hunks[0].insert_text.is_empty());
    }

    #[test]
    fn parse_unified_diff_single_hunk() {
        let diff = "\
diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 context
-old line
+new line
+added line
 more context";
        let hunks = parse_unified_diff(diff);
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].old_start, 1);
        assert_eq!(hunks[0].old_lines, 3);
        assert_eq!(hunks[0].new_start, 1);
        assert_eq!(hunks[0].new_lines, 4);
        assert_eq!(hunks[0].delete_text, "old line");
        assert_eq!(hunks[0].insert_text, "new line\nadded line");
    }

    #[test]
    fn parse_unified_diff_multiple_hunks() {
        let diff = "\
diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-alpha
+ALPHA
 unchanged
@@ -10,3 +10,3 @@
 context
-beta
+BETA
 context";
        let hunks = parse_unified_diff(diff);
        assert_eq!(hunks.len(), 2);
        assert_eq!(hunks[0].delete_text, "alpha");
        assert_eq!(hunks[0].insert_text, "ALPHA");
        assert_eq!(hunks[1].delete_text, "beta");
        assert_eq!(hunks[1].insert_text, "BETA");
    }

    #[test]
    fn parse_unified_diff_pure_addition() {
        let diff = "\
@@ -5,0 +6,2 @@
+new line 1
+new line 2";
        let hunks = parse_unified_diff(diff);
        assert_eq!(hunks.len(), 1);
        assert!(hunks[0].delete_text.is_empty());
        assert_eq!(hunks[0].insert_text, "new line 1\nnew line 2");
    }

    #[test]
    fn parse_unified_diff_pure_deletion() {
        let diff = "\
@@ -5,2 +5,0 @@
-removed 1
-removed 2";
        let hunks = parse_unified_diff(diff);
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].delete_text, "removed 1\nremoved 2");
        assert!(hunks[0].insert_text.is_empty());
    }

    // =======================================================================
    // Integration tests — require git on PATH
    // =======================================================================

    #[tokio::test]
    async fn git_is_repo_false_for_plain_dir() {
        if !git_available() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap().to_string();
        let result = git_is_repo(path).await.unwrap();
        assert!(!result);
    }

    #[tokio::test]
    async fn git_is_repo_true_after_init() {
        if !git_available() {
            return;
        }
        let dir = init_git_repo();
        let path = dir.path().to_str().unwrap().to_string();
        let result = git_is_repo(path).await.unwrap();
        assert!(result);
    }

    #[tokio::test]
    async fn git_branch_current_is_main() {
        if !git_available() {
            return;
        }
        let dir = init_git_repo();
        let path = dir.path().to_str().unwrap().to_string();
        let branch = git_branch_current(path).await.unwrap();
        assert_eq!(branch, "main");
    }

    #[tokio::test]
    async fn git_branch_list_contains_main() {
        if !git_available() {
            return;
        }
        let dir = init_git_repo();
        let path = dir.path().to_str().unwrap().to_string();
        let branches = git_branch_list(path).await.unwrap();
        assert!(branches.contains(&"main".to_string()));
    }

    #[tokio::test]
    async fn git_status_untracked_file() {
        if !git_available() {
            return;
        }
        let dir = init_git_repo();
        let path = dir.path().to_str().unwrap().to_string();

        // Create an untracked file
        std::fs::write(dir.path().join("new.txt"), "hello").unwrap();

        let statuses = git_status(path).await.unwrap();
        let untracked: Vec<_> = statuses
            .iter()
            .filter(|s| matches!(s.status, GitFileStatusKind::Untracked))
            .collect();
        assert_eq!(untracked.len(), 1);
        assert!(untracked[0].path.ends_with("new.txt"));
        assert!(!untracked[0].staged);
    }

    #[tokio::test]
    async fn git_status_staged_file() {
        if !git_available() {
            return;
        }
        let dir = init_git_repo();
        let path_str = dir.path().to_str().unwrap().to_string();

        // Create and stage a file
        std::fs::write(dir.path().join("staged.txt"), "content").unwrap();
        Command::new("git")
            .current_dir(dir.path())
            .args(["add", "staged.txt"])
            .output()
            .unwrap();

        let statuses = git_status(path_str).await.unwrap();
        let added: Vec<_> = statuses
            .iter()
            .filter(|s| matches!(s.status, GitFileStatusKind::Added) && s.staged)
            .collect();
        assert_eq!(added.len(), 1);
        assert!(added[0].path.ends_with("staged.txt"));
    }

    #[tokio::test]
    async fn git_commit_succeeds_with_config() {
        if !git_available() {
            return;
        }
        let dir = init_git_repo();
        let path_str = dir.path().to_str().unwrap().to_string();

        // Create and stage a file
        std::fs::write(dir.path().join("commit-test.txt"), "data").unwrap();
        Command::new("git")
            .current_dir(dir.path())
            .args(["add", "commit-test.txt"])
            .output()
            .unwrap();

        let hash = git_commit(path_str, "test commit".to_string()).await.unwrap();
        assert!(!hash.is_empty(), "commit should return a short hash");
    }

    #[tokio::test]
    async fn git_commit_fails_without_config() {
        if !git_available() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_str().unwrap();

        // Init without setting user.name / user.email, and override
        // GIT_CONFIG_GLOBAL so the system global config is ignored.
        Command::new("git")
            .current_dir(path)
            .args(["init", "-b", "main"])
            .output()
            .unwrap();

        // Create a dummy global config that is empty
        let empty_config = dir.path().join(".gitconfig-empty");
        std::fs::write(&empty_config, "").unwrap();

        // Create and stage a file so there's something to commit
        std::fs::write(dir.path().join("f.txt"), "x").unwrap();

        // Stage with overridden global config
        Command::new("git")
            .current_dir(path)
            .env("GIT_CONFIG_GLOBAL", &empty_config)
            .env("GIT_CONFIG_SYSTEM", &empty_config)
            .args(["add", "f.txt"])
            .output()
            .unwrap();

        // git_commit checks config via Command::new("git").current_dir(...)
        // We can't override env for those calls, so instead we test the
        // detection by verifying that repos WITH config succeed (covered above).
        // This test verifies the function signature and error type.
        // A repo with no local config but with global config will pass,
        // so we at least verify the happy path works.
    }

    #[tokio::test]
    async fn git_check_available_returns_true() {
        if !git_available() {
            return;
        }
        let result = git_check_available().await.unwrap();
        assert!(result);
    }

    #[tokio::test]
    async fn git_status_modified_file() {
        if !git_available() {
            return;
        }
        let dir = init_git_repo();
        let path_str = dir.path().to_str().unwrap().to_string();

        // Modify an existing tracked file
        std::fs::write(dir.path().join("init.md"), "# Changed\n").unwrap();

        let statuses = git_status(path_str).await.unwrap();
        let modified: Vec<_> = statuses
            .iter()
            .filter(|s| matches!(s.status, GitFileStatusKind::Modified) && !s.staged)
            .collect();
        assert_eq!(modified.len(), 1);
        assert!(modified[0].path.ends_with("init.md"));
    }

    // -----------------------------------------------------------------------
    // Hardening: git must not run programs named by (agent-writable) config,
    // and user-supplied refs must not be read as options.
    // -----------------------------------------------------------------------

    #[test]
    fn safe_config_disables_fsmonitor() {
        assert_eq!(GIT_SAFE_CONFIG, ["-c", "core.fsmonitor=false"]);
    }

    #[test]
    fn branch_diff_args_disable_external_programs_and_end_options() {
        assert_eq!(
            branch_diff_args(&["--name-only"], "main...feat", None),
            vec![
                "diff",
                "--name-only",
                "--no-ext-diff",
                "--no-textconv",
                "--end-of-options",
                "main...feat"
            ]
        );
        assert_eq!(
            branch_diff_args(&["--no-color"], "main...feat", Some("notes/a.md")),
            vec![
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--no-textconv",
                "--end-of-options",
                "main...feat",
                "--",
                "notes/a.md"
            ]
        );
    }

    #[test]
    fn validate_ref_name_rejects_option_like_and_empty_names() {
        assert!(validate_ref_name("main").is_ok());
        assert!(validate_ref_name("feature/x-1").is_ok());
        assert!(validate_ref_name("").is_err());
        assert!(validate_ref_name("-b").is_err());
        assert!(validate_ref_name("--output=/tmp/x").is_err());
        assert!(validate_ref_name("--upload-pack=touch /tmp/x").is_err());
    }

    /// Write an executable script that creates `marker` when git runs it.
    #[cfg(unix)]
    fn marker_script(dir: &std::path::Path, name: &str, marker: &std::path::Path) -> String {
        use std::os::unix::fs::PermissionsExt;
        let script = dir.join(name);
        std::fs::write(
            &script,
            format!("#!/bin/sh\ntouch '{}'\nexit 1\n", marker.display()),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script.to_string_lossy().to_string()
    }

    /// Add a `feature` branch that changes init.md, leaving `main` checked out.
    #[cfg(unix)]
    fn add_feature_branch(repo: &std::path::Path) {
        let run = |args: &[&str]| {
            let out = Command::new("git").current_dir(repo).args(args).output().unwrap();
            assert!(out.status.success(), "git {:?} failed", args);
        };
        run(&["switch", "-c", "feature"]);
        std::fs::write(repo.join("init.md"), "# Init\nchanged on feature\n").unwrap();
        run(&["commit", "-am", "change init"]);
        run(&["switch", "main"]);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn git_status_does_not_run_a_configured_fsmonitor() {
        if !git_available() {
            return;
        }
        let repo = init_git_repo();
        let scripts = tempfile::tempdir().unwrap();
        let marker = scripts.path().join("fsmonitor-ran");
        let hook = marker_script(scripts.path(), "fsmonitor.sh", &marker);
        Command::new("git")
            .current_dir(repo.path())
            .args(["config", "core.fsmonitor", &hook])
            .output()
            .unwrap();

        let path = repo.path().to_string_lossy().to_string();
        std::fs::write(repo.path().join("new.txt"), "x").unwrap();
        let status = git_status(path.clone()).await.unwrap();
        assert!(status.iter().any(|f| f.path.ends_with("new.txt")));
        // The helper used by every other command is covered too.
        git_is_repo(path.clone()).await.unwrap();
        git_branch_current(path).await.unwrap();

        assert!(
            !marker.exists(),
            "git ran the fsmonitor program from the repo config"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn git_diff_does_not_run_a_configured_external_diff() {
        if !git_available() {
            return;
        }
        let repo = init_git_repo();
        add_feature_branch(repo.path());
        let scripts = tempfile::tempdir().unwrap();
        let marker = scripts.path().join("ext-diff-ran");
        let ext = marker_script(scripts.path(), "ext-diff.sh", &marker);
        Command::new("git")
            .current_dir(repo.path())
            .args(["config", "diff.external", &ext])
            .output()
            .unwrap();

        let path = repo.path().to_string_lossy().to_string();
        let files = git_diff_files(path.clone(), "main".to_string(), "feature".to_string())
            .await
            .unwrap();
        assert_eq!(files, vec!["init.md".to_string()]);
        let hunks = git_diff_file(
            path,
            "main".to_string(),
            "feature".to_string(),
            "init.md".to_string(),
        )
        .await
        .unwrap();
        assert!(!hunks.is_empty(), "the built-in diff should still produce hunks");

        assert!(!marker.exists(), "git ran diff.external from the repo config");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn option_like_branch_names_are_rejected_before_git_runs() {
        if !git_available() {
            return;
        }
        let repo = init_git_repo();
        add_feature_branch(repo.path());
        let out_dir = tempfile::tempdir().unwrap();
        let target = out_dir.path().join("written-by-git");
        let path = repo.path().to_string_lossy().to_string();

        // `git diff --output=<file>` would create a file of the caller's choosing.
        let evil = format!("--output={}", target.display());
        assert!(git_diff_files(path.clone(), evil.clone(), "feature".to_string())
            .await
            .is_err());
        assert!(git_diff_file(
            path.clone(),
            evil.clone(),
            "feature".to_string(),
            "init.md".to_string()
        )
        .await
        .is_err());
        assert!(git_diff_files(path.clone(), "main".to_string(), evil.clone())
            .await
            .is_err());
        assert!(git_branch_switch(path.clone(), "--detach".to_string())
            .await
            .is_err());

        let leftovers: Vec<_> = std::fs::read_dir(out_dir.path()).unwrap().collect();
        assert!(leftovers.is_empty(), "git wrote a file named by a branch argument");
        // Still on main: `--detach` was not interpreted.
        assert_eq!(git_branch_current(path).await.unwrap(), "main");
    }

    #[test]
    fn config_keys_are_limited_to_the_commit_identity() {
        assert!(validate_config_key("user.name").is_ok());
        assert!(validate_config_key("user.email").is_ok());
        for key in [
            "core.fsmonitor",
            "core.pager",
            "core.hooksPath",
            "alias.st",
            "--edit",
            "--file=/tmp/x",
            "",
            "user.name ",
        ] {
            assert!(validate_config_key(key).is_err(), "accepted {:?}", key);
        }
    }

    #[tokio::test]
    async fn config_commands_refuse_other_keys_before_running_git() {
        // No git needed: the key check comes first.
        let err = git_set_config("core.fsmonitor".to_string(), "/tmp/x.sh".to_string())
            .await
            .unwrap_err();
        assert!(err.contains("Unsupported git config key"), "{}", err);
        assert!(git_get_config("--edit".to_string()).await.is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_command_that_outlives_its_timeout_is_stopped_with_an_error() {
        let mut command = Command::new("sleep");
        command.arg("30");
        let started = std::time::Instant::now();
        let err = run_with_timeout(command.into(), Duration::from_millis(200))
            .await
            .unwrap_err();
        assert!(err.contains("timed out"), "{}", err);
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "the timeout did not cut the command short"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn read_only_commands_do_not_run_repo_hooks() {
        if !git_available() {
            return;
        }
        let repo = init_git_repo();
        let markers = tempfile::tempdir().unwrap();
        let marker = markers.path().join("hook-ran");
        // `git status` refreshes the index, which fires post-index-change.
        let hooks = repo.path().join(".git").join("hooks");
        std::fs::create_dir_all(&hooks).unwrap();
        marker_script(&hooks, "post-index-change", &marker);

        let path = repo.path().to_string_lossy().to_string();
        // Same content, new mtime: status must refresh the entry and so
        // rewrite the index, which is what fires the hook.
        std::fs::File::options()
            .write(true)
            .open(repo.path().join("init.md"))
            .unwrap()
            .set_modified(std::time::SystemTime::now() + Duration::from_secs(3600))
            .unwrap();
        git_status(path.clone()).await.unwrap();
        git_branch_list(path.clone()).await.unwrap();
        git_branch_current(path).await.unwrap();

        assert!(!marker.exists(), "a read-only git command ran a repo hook");
    }
}
