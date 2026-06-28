// Automations — scheduled & event-triggered task definitions.
//
// An Automation is a single trigger bound to a linear pipeline of steps,
// stored as a portable YAML file under `~/.notesage/automations/` (global) and
// `<project>/.notesage/automations/` (per-project). This module owns discovery,
// parse, validation, and CRUD. Step EXECUTION lives in the frontend runner
// (`useAutomationRunner`) — the backend never runs steps.
//
// PRD: docs/prds/2026-06-28-automations.md  ·  Tasks: docs/tasks/2026-06-28-automations-tasks.md
// Phase 1 supports the `agent` / `document` / `notify` step types; `skill`
// steps arrive in Phase 2 with the `execute_skill_script` integration.

use chrono::{DateTime, Utc};
use log::warn;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

// ----------------------------------------------------------------------------
// Data model — `rename_all = "camelCase"` keeps on-disk YAML and IPC JSON
// identical to the TypeScript interfaces in `src/lib/automations/types.ts`.
// ----------------------------------------------------------------------------

/// Overlap policy when a run is already active (R3, Home-Assistant style).
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RunMode {
    /// Drop a new fire while a run is active (safest, default).
    #[default]
    Single,
    /// Cancel the in-flight run and start over.
    Restart,
    /// Serialize — the new run waits for the prior to finish.
    Queued,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TriggerType {
    Schedule,
    File,
    Workflow,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Trigger {
    #[serde(rename = "type")]
    pub kind: TriggerType,
    /// schedule: canonical 5-field cron (`"0 8 * * *"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cron: Option<String>,
    /// schedule: include in missed-run reconciliation (default true).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catch_up: Option<bool>,
    /// file / workflow: the event name (e.g. `file-created`, `document-saved`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
    /// file: watched root (defaults to the automation's scope).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// Trigger-level gate (R1, was `filter`). Phase 1 ships `weekdays`; `glob` and
/// `frontmatter` are honored from Phase 2 (file triggers).
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Condition {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glob: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weekdays: Option<Vec<u32>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frontmatter: Option<HashMap<String, String>>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Guardrails {
    #[serde(default = "default_max_runs")]
    pub max_runs_per_day: u32,
    #[serde(default)]
    pub debounce_ms: u64,
    #[serde(default = "default_max_steps")]
    pub max_steps_per_run: u32,
}

impl Default for Guardrails {
    fn default() -> Self {
        Self {
            max_runs_per_day: default_max_runs(),
            debounce_ms: 0,
            max_steps_per_run: default_max_steps(),
        }
    }
}

fn default_max_runs() -> u32 {
    24
}
fn default_max_steps() -> u32 {
    25
}
fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DocOp {
    Create,
    Append,
}

/// A pipeline step, internally tagged by `type`. Phase 1: agent / document / notify.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum AutomationStep {
    Agent {
        id: String,
        prompt: String,
    },
    Document {
        id: String,
        op: DocOp,
        path: String,
        content: String,
    },
    Notify {
        id: String,
        title: String,
        body: String,
    },
}

impl AutomationStep {
    pub fn id(&self) -> &str {
        match self {
            AutomationStep::Agent { id, .. }
            | AutomationStep::Document { id, .. }
            | AutomationStep::Notify { id, .. } => id,
        }
    }

    pub fn type_name(&self) -> &'static str {
        match self {
            AutomationStep::Agent { .. } => "agent",
            AutomationStep::Document { .. } => "document",
            AutomationStep::Notify { .. } => "notify",
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    /// Slug derived from the filename — filled by the loader, not the YAML.
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// `false` until reviewed when the automation contains a write/script step.
    #[serde(default)]
    pub armed: bool,
    /// `"global"` or a project root path — filled by the loader from the file location.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(default)]
    pub mode: RunMode,
    pub trigger: Trigger,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub condition: Option<Condition>,
    #[serde(default)]
    pub guardrails: Guardrails,
    pub steps: Vec<AutomationStep>,
    /// Absolute path to the YAML — filled by the loader.
    #[serde(default)]
    pub source_path: String,
}

/// One discovered file: the parsed automation, or the parse/validation error.
/// A single malformed file never breaks the whole list.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AutomationFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation: Option<Automation>,
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AutomationValidation {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Next fire time (RFC3339, schedule triggers only) — a preview for the form builder.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_run: Option<String>,
}

// ----------------------------------------------------------------------------
// Parse + validation
// ----------------------------------------------------------------------------

fn parse_automation(yaml: &str) -> Result<Automation, String> {
    serde_norway::from_str::<Automation>(yaml).map_err(|e| format!("YAML parse error: {}", e))
}

/// Compute the next fire time strictly after `after`. Uses the `saffron` crate
/// (5-field standard cron, chrono-native). Returns `Ok(None)` if the expression
/// is valid but has no upcoming match.
fn cron_next_after(expr: &str, after: DateTime<Utc>) -> Result<Option<DateTime<Utc>>, String> {
    use saffron::Cron;
    let cron: Cron = expr
        .parse()
        .map_err(|e| format!("{}", e))?;
    if !cron.any() {
        return Err("expression never matches".to_string());
    }
    Ok(cron.next_after(after))
}

/// Validate a parsed automation. Returns the next scheduled run (RFC3339) on
/// success, or a human-readable error describing the first problem found.
fn validate_automation_struct(a: &Automation) -> Result<Option<String>, String> {
    if a.name.trim().is_empty() {
        return Err("Automation `name` is required".to_string());
    }
    if a.steps.is_empty() {
        return Err("Automation must have at least one step".to_string());
    }

    let mut seen: HashSet<&str> = HashSet::new();
    for step in &a.steps {
        let id = step.id();
        if id.trim().is_empty() {
            return Err("Every step needs a non-empty `id`".to_string());
        }
        if !seen.insert(id) {
            return Err(format!("Duplicate step id `{}`", id));
        }
    }

    let mut next_run: Option<String> = None;
    match a.trigger.kind {
        TriggerType::Schedule => {
            let cron = a
                .trigger
                .cron
                .as_deref()
                .ok_or("Schedule trigger requires a `cron` expression")?;
            let next = cron_next_after(cron, Utc::now())
                .map_err(|e| format!("Invalid cron `{}`: {}", cron, e))?;
            next_run = next.map(|t| t.to_rfc3339());
        }
        TriggerType::File => {
            // Phase 1: nothing strictly required (path defaults to scope).
        }
        TriggerType::Workflow => {
            if a.trigger.event.is_none() {
                return Err("Workflow trigger requires an `event`".to_string());
            }
        }
    }

    Ok(next_run)
}

/// `"global"` if the base dir is the global automations dir, else the project
/// root (`<project>/.notesage/automations` → `<project>`).
fn scope_for(base_dir: &str) -> String {
    if let Some(home) = dirs::home_dir() {
        let global = home.join(".notesage").join("automations");
        if Path::new(base_dir) == global {
            return "global".to_string();
        }
    }
    let p = Path::new(base_dir);
    if let Some(project_root) = p.parent().and_then(|notesage| notesage.parent()) {
        return project_root.to_string_lossy().to_string();
    }
    base_dir.to_string()
}

// ----------------------------------------------------------------------------
// Commands
// ----------------------------------------------------------------------------

/// Discover automations across the given base directories (one level deep,
/// `*.yaml` / `*.yml` files). The frontend passes `~/.notesage/automations` plus
/// each `<project>/.notesage/automations` (scope → dir mapping lives in the store,
/// mirroring `discover_skills`).
#[tauri::command]
pub async fn list_automations(base_dirs: Vec<String>) -> Result<Vec<AutomationFile>, String> {
    let mut out = Vec::new();

    for base in &base_dirs {
        let base_path = Path::new(base);
        if !base_path.is_dir() {
            continue;
        }
        let scope = scope_for(base);

        let entries = match fs::read_dir(base_path) {
            Ok(e) => e,
            Err(e) => {
                warn!("automations: cannot read {}: {}", base, e);
                continue;
            }
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let is_yaml = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e == "yaml" || e == "yml")
                .unwrap_or(false);
            if !is_yaml {
                continue;
            }

            let id = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let path_str = path.to_string_lossy().to_string();

            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(e) => {
                    out.push(AutomationFile {
                        path: path_str,
                        automation: None,
                        valid: false,
                        error: Some(format!("read error: {}", e)),
                    });
                    continue;
                }
            };

            match parse_automation(&content) {
                Ok(mut a) => {
                    a.id = id;
                    a.scope = Some(scope.clone());
                    a.source_path = path_str.clone();
                    let (valid, error) = match validate_automation_struct(&a) {
                        Ok(_) => (true, None),
                        Err(msg) => (false, Some(msg)),
                    };
                    out.push(AutomationFile {
                        path: path_str,
                        automation: Some(a),
                        valid,
                        error,
                    });
                }
                Err(msg) => out.push(AutomationFile {
                    path: path_str,
                    automation: None,
                    valid: false,
                    error: Some(msg),
                }),
            }
        }
    }

    Ok(out)
}

/// Write a YAML definition (the form builder serializes to this). Validates
/// before writing so a malformed definition never lands on disk.
#[tauri::command]
pub async fn save_automation(path: String, yaml: String) -> Result<(), String> {
    let a = parse_automation(&yaml)?;
    validate_automation_struct(&a)?;

    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }
    fs::write(&path, yaml).map_err(|e| format!("Failed to write {}: {}", path, e))
}

#[tauri::command]
pub async fn delete_automation(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("Failed to delete {}: {}", path, e))
}

/// Dry-run validation for the form builder. Always returns `Ok` — the verdict
/// (and any error / next-run preview) is carried in `AutomationValidation`.
#[tauri::command]
pub async fn validate_automation(yaml: String) -> Result<AutomationValidation, String> {
    match parse_automation(&yaml) {
        Ok(a) => match validate_automation_struct(&a) {
            Ok(next_run) => Ok(AutomationValidation {
                ok: true,
                error: None,
                next_run,
            }),
            Err(msg) => Ok(AutomationValidation {
                ok: false,
                error: Some(msg),
                next_run: None,
            }),
        },
        Err(msg) => Ok(AutomationValidation {
            ok: false,
            error: Some(msg),
            next_run: None,
        }),
    }
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    // Extra-hash raw-string delimiter: the `content` below contains `"##`
    // (a markdown heading inside a quoted string), which would close `r#"…"#`.
    const DAILY_DIGEST: &str = r####"
name: Morning Digest
enabled: true
mode: single
trigger:
  type: schedule
  cron: "0 8 * * *"
  catchUp: true
condition:
  weekdays: [1, 2, 3, 4, 5]
guardrails:
  maxRunsPerDay: 1
  debounceMs: 0
  maxStepsPerRun: 15
steps:
  - id: summary
    type: agent
    prompt: "Summarize my notes edited since yesterday."
  - id: write
    type: document
    op: append
    path: "Daily/{{today}}.md"
    content: "## {{today}}\n\n{{steps.summary.output}}\n"
  - id: ping
    type: notify
    title: "Daily digest ready"
    body: "Written to Daily/{{today}}.md"
"####;

    #[test]
    fn parses_daily_digest() {
        let a = parse_automation(DAILY_DIGEST).expect("daily digest should parse");
        assert_eq!(a.name, "Morning Digest");
        assert_eq!(a.mode, RunMode::Single);
        assert_eq!(a.trigger.kind, TriggerType::Schedule);
        assert_eq!(a.trigger.cron.as_deref(), Some("0 8 * * *"));
        assert_eq!(a.trigger.catch_up, Some(true));
        assert_eq!(a.guardrails.max_runs_per_day, 1);
        assert_eq!(a.steps.len(), 3);
        assert_eq!(a.steps[0].id(), "summary");
        assert_eq!(a.steps[0].type_name(), "agent");
        assert!(matches!(a.steps[1], AutomationStep::Document { op: DocOp::Append, .. }));
        assert!(validate_automation_struct(&a).expect("valid").is_some());
    }

    #[test]
    fn mode_and_enabled_default() {
        let yaml = r#"
name: X
trigger: { type: schedule, cron: "0 8 * * *" }
steps:
  - { id: a, type: notify, title: t, body: b }
"#;
        let a = parse_automation(yaml).unwrap();
        assert_eq!(a.mode, RunMode::Single);
        assert!(a.enabled);
        assert_eq!(a.guardrails.max_runs_per_day, default_max_runs());
    }

    #[test]
    fn rejects_invalid_cron() {
        let yaml = r#"
name: X
trigger: { type: schedule, cron: "not a cron" }
steps:
  - { id: a, type: notify, title: t, body: b }
"#;
        let a = parse_automation(yaml).unwrap();
        assert!(validate_automation_struct(&a).is_err());
    }

    #[test]
    fn rejects_unknown_step_type() {
        let yaml = r#"
name: X
trigger: { type: schedule, cron: "0 8 * * *" }
steps:
  - { id: a, type: telepathy, foo: bar }
"#;
        assert!(parse_automation(yaml).is_err());
    }

    #[test]
    fn rejects_duplicate_step_ids() {
        let yaml = r#"
name: X
trigger: { type: schedule, cron: "0 8 * * *" }
steps:
  - { id: a, type: notify, title: t, body: b }
  - { id: a, type: notify, title: t2, body: b2 }
"#;
        let a = parse_automation(yaml).unwrap();
        assert!(validate_automation_struct(&a).is_err());
    }

    #[test]
    fn schedule_requires_cron() {
        let yaml = r#"
name: X
trigger: { type: schedule }
steps:
  - { id: a, type: notify, title: t, body: b }
"#;
        let a = parse_automation(yaml).unwrap();
        assert!(validate_automation_struct(&a).is_err());
    }

    #[test]
    fn workflow_requires_event() {
        let yaml = r#"
name: X
trigger: { type: workflow }
steps:
  - { id: a, type: notify, title: t, body: b }
"#;
        let a = parse_automation(yaml).unwrap();
        assert!(validate_automation_struct(&a).is_err());
    }

    #[test]
    fn cron_next_after_is_deterministic() {
        let after = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        let next = cron_next_after("0 8 * * *", after).unwrap().unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 1, 1, 8, 0, 0).unwrap());
    }
}
