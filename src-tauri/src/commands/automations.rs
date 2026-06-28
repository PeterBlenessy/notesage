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

use chrono::{DateTime, Local, NaiveDateTime, TimeZone, Utc};
use log::warn;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, Runtime};

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

/// Next fire strictly after `after`, interpreting cron fields in `tz` wall-clock.
/// `saffron` is UTC-only, so we feed it a pseudo-UTC whose components equal the
/// local wall-clock, then map the matched result back to a real instant. Returns
/// `Ok(None)` when the expression is valid but has no upcoming match.
fn cron_next_after_tz<Tz: TimeZone>(
    expr: &str,
    after: DateTime<Utc>,
    tz: &Tz,
) -> Result<Option<DateTime<Utc>>, String> {
    use saffron::Cron;
    let cron: Cron = expr.parse().map_err(|e| format!("{}", e))?;
    if !cron.any() {
        return Err("expression never matches".to_string());
    }
    let local_naive = after.with_timezone(tz).naive_local();
    let pseudo = Utc.from_utc_datetime(&local_naive);
    match cron.next_after(pseudo) {
        Some(next_pseudo) => Ok(resolve_wallclock(tz, next_pseudo.naive_utc())),
        None => Ok(None),
    }
}

/// Local-time wrapper used by the runtime + the validation next-run preview.
fn cron_next_after(expr: &str, after: DateTime<Utc>) -> Result<Option<DateTime<Utc>>, String> {
    cron_next_after_tz(expr, after, &Local)
}

/// Map a `tz` wall-clock naive datetime to a real UTC instant: step over
/// spring-forward gaps (+1h) and resolve fall-back ambiguity to the earliest.
fn resolve_wallclock<Tz: TimeZone>(tz: &Tz, naive: NaiveDateTime) -> Option<DateTime<Utc>> {
    use chrono::LocalResult;
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(dt) | LocalResult::Ambiguous(dt, _) => Some(dt.with_timezone(&Utc)),
        LocalResult::None => {
            let bumped = naive + chrono::Duration::hours(1);
            tz.from_local_datetime(&bumped)
                .single()
                .map(|d| d.with_timezone(&Utc))
        }
    }
}

/// All occurrences strictly after `last_fired` and `<= now` (the missed runs of a
/// downtime gap), interpreted in `tz`, capped at `cap` to bound a long absence.
fn missed_occurrences_tz<Tz: TimeZone>(
    cron: &str,
    last_fired: DateTime<Utc>,
    now: DateTime<Utc>,
    cap: usize,
    tz: &Tz,
) -> Result<Vec<DateTime<Utc>>, String> {
    let mut out = Vec::new();
    let mut cursor = last_fired;
    while out.len() < cap {
        match cron_next_after_tz(cron, cursor, tz)? {
            Some(t) if t <= now => {
                out.push(t);
                cursor = t;
            }
            _ => break,
        }
    }
    Ok(out)
}

fn missed_occurrences(
    cron: &str,
    last_fired: DateTime<Utc>,
    now: DateTime<Utc>,
    cap: usize,
) -> Result<Vec<DateTime<Utc>>, String> {
    missed_occurrences_tz(cron, last_fired, now, cap, &Local)
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
// Scheduler — a single tokio tick loop emits `automation-due`; the frontend
// runner executes the pipeline. The backend never runs steps.
// ----------------------------------------------------------------------------

const SCHED_TICK_SECS: u64 = 30;
const MISSED_CAP: usize = 50;

/// One scheduled automation tracked by the tick loop.
#[derive(Clone, Debug)]
struct ScheduledEntry {
    source_path: String, // unique key the frontend resolves against
    automation_id: String,
    name: String,
    cron: String,
    catch_up: bool,
    next_due: DateTime<Utc>,
    last_fired_at: Option<DateTime<Utc>>,
}

/// Managed state: the active schedule + the master enable flag.
pub struct AutomationSchedulerState {
    scheduled: Mutex<Vec<ScheduledEntry>>,
    enabled: AtomicBool,
    catch_up_done: AtomicBool,
}

impl AutomationSchedulerState {
    pub fn new() -> Self {
        Self {
            scheduled: Mutex::new(Vec::new()),
            enabled: AtomicBool::new(false),
            catch_up_done: AtomicBool::new(false),
        }
    }
}

impl Default for AutomationSchedulerState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AutomationDuePayload {
    automation_id: String,
    source_path: String,
    scheduled_for: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MissedEntry {
    automation_id: String,
    source_path: String,
    name: String,
    missed_count: usize,
    last_fired_at: Option<String>,
    occurrences: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AutomationsMissedPayload {
    entries: Vec<MissedEntry>,
}

// --- last-fired persistence sidecar (`~/.notesage/automation-state.json`) ----

fn state_sidecar_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".notesage").join("automation-state.json"))
}

fn load_fired_state() -> HashMap<String, DateTime<Utc>> {
    let mut map = HashMap::new();
    if let Some(path) = state_sidecar_path() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(raw) = serde_json::from_str::<HashMap<String, String>>(&content) {
                for (k, v) in raw {
                    if let Ok(dt) = DateTime::parse_from_rfc3339(&v) {
                        map.insert(k, dt.with_timezone(&Utc));
                    }
                }
            }
        }
    }
    map
}

fn save_fired_state(map: &HashMap<String, DateTime<Utc>>) {
    if let Some(path) = state_sidecar_path() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let raw: HashMap<String, String> =
            map.iter().map(|(k, v)| (k.clone(), v.to_rfc3339())).collect();
        if let Ok(json) = serde_json::to_string_pretty(&raw) {
            let _ = fs::write(&path, json);
        }
    }
}

/// Load the enabled, valid, schedule-triggered automations into scheduler entries.
fn load_schedule_entries(
    base_dirs: &[String],
    fired: &HashMap<String, DateTime<Utc>>,
    now: DateTime<Utc>,
) -> Vec<ScheduledEntry> {
    let mut entries = Vec::new();
    for base in base_dirs {
        let base_path = Path::new(base);
        if !base_path.is_dir() {
            continue;
        }
        let dir = match fs::read_dir(base_path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        for entry in dir.flatten() {
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
            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let a = match parse_automation(&content) {
                Ok(a) => a,
                Err(_) => continue,
            };
            if !a.enabled || a.trigger.kind != TriggerType::Schedule {
                continue;
            }
            let cron = match a.trigger.cron.clone() {
                Some(c) => c,
                None => continue,
            };
            let next_due = match cron_next_after(&cron, now) {
                Ok(Some(t)) => t,
                _ => continue, // invalid cron / no upcoming match — skip silently
            };
            let id = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let path_str = path.to_string_lossy().to_string();
            entries.push(ScheduledEntry {
                source_path: path_str.clone(),
                automation_id: id,
                name: a.name.clone(),
                cron,
                catch_up: a.trigger.catch_up.unwrap_or(true),
                next_due,
                last_fired_at: fired.get(&path_str).copied(),
            });
        }
    }
    entries
}

/// Master enable toggle (also gates the tick loop).
#[tauri::command]
pub async fn set_automations_enabled(
    enabled: bool,
    state: tauri::State<'_, AutomationSchedulerState>,
) -> Result<(), String> {
    state.enabled.store(enabled, Ordering::Relaxed);
    Ok(())
}

/// Rebuild the active schedule from disk (call after save/delete/enable and once
/// on startup). The FIRST call per launch also computes missed runs during the
/// downtime gap and emits `automations-missed` — it never auto-fires them.
#[tauri::command]
pub async fn reload_automation_schedule<R: Runtime>(
    base_dirs: Vec<String>,
    app: AppHandle<R>,
    state: tauri::State<'_, AutomationSchedulerState>,
) -> Result<usize, String> {
    let now = Utc::now();
    let fired = load_fired_state();
    let entries = load_schedule_entries(&base_dirs, &fired, now);
    let count = entries.len();

    if !state.catch_up_done.swap(true, Ordering::SeqCst) {
        let mut missed = Vec::new();
        for e in &entries {
            if !e.catch_up {
                continue;
            }
            let last = match e.last_fired_at {
                Some(t) => t,
                None => continue, // never fired before — no catch-up on first sight
            };
            let occ = missed_occurrences(&e.cron, last, now, MISSED_CAP).unwrap_or_default();
            if occ.is_empty() {
                continue;
            }
            missed.push(MissedEntry {
                automation_id: e.automation_id.clone(),
                source_path: e.source_path.clone(),
                name: e.name.clone(),
                missed_count: occ.len(),
                last_fired_at: Some(last.to_rfc3339()),
                occurrences: occ.iter().map(|t| t.to_rfc3339()).collect(),
            });
        }
        if !missed.is_empty() {
            let _ = app.emit("automations-missed", AutomationsMissedPayload { entries: missed });
        }
    }

    *state.scheduled.lock() = entries;
    Ok(count)
}

/// Spawn the single scheduler tick loop. Called once from `lib.rs` setup.
pub fn spawn_scheduler<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(SCHED_TICK_SECS)).await;

            let state = app.state::<AutomationSchedulerState>();
            if !state.enabled.load(Ordering::Relaxed) {
                continue;
            }
            let now = Utc::now();

            // Collect due entries and advance them. The lock is dropped before any
            // await / I/O below (never hold a lock across await).
            let due: Vec<AutomationDuePayload> = {
                let mut sched = state.scheduled.lock();
                let mut due = Vec::new();
                for e in sched.iter_mut() {
                    if e.next_due <= now {
                        due.push(AutomationDuePayload {
                            automation_id: e.automation_id.clone(),
                            source_path: e.source_path.clone(),
                            scheduled_for: e.next_due.to_rfc3339(),
                        });
                        e.last_fired_at = Some(now);
                        e.next_due = match cron_next_after(&e.cron, now) {
                            Ok(Some(t)) => t,
                            // No future occurrence — push far out so it won't refire.
                            _ => now + chrono::Duration::days(3650),
                        };
                    }
                }
                due
            };
            if due.is_empty() {
                continue;
            }

            let mut fired = load_fired_state();
            for d in &due {
                fired.insert(d.source_path.clone(), now);
            }
            save_fired_state(&fired);

            for payload in due {
                let _ = app.emit("automation-due", payload);
            }
        }
    });
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
        assert!(matches!(a.steps[0], AutomationStep::Agent { .. }));
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
        // Pin to UTC so the assertion is machine-timezone independent.
        let after = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        let next = cron_next_after_tz("0 8 * * *", after, &Utc).unwrap().unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 1, 1, 8, 0, 0).unwrap());
    }

    #[test]
    fn missed_occurrences_coalesces_a_multi_day_gap() {
        let last = Utc.with_ymd_and_hms(2026, 1, 1, 8, 0, 0).unwrap();
        let now = Utc.with_ymd_and_hms(2026, 1, 5, 9, 0, 0).unwrap();
        let occ = missed_occurrences_tz("0 8 * * *", last, now, 50, &Utc).unwrap();
        // 08:00 on Jan 2, 3, 4, 5 — strictly after Jan 1 08:00, on/before Jan 5 09:00.
        assert_eq!(occ.len(), 4);
        assert_eq!(occ[0], Utc.with_ymd_and_hms(2026, 1, 2, 8, 0, 0).unwrap());
        assert_eq!(*occ.last().unwrap(), Utc.with_ymd_and_hms(2026, 1, 5, 8, 0, 0).unwrap());
    }

    #[test]
    fn missed_occurrences_respects_cap() {
        let last = Utc.with_ymd_and_hms(2026, 1, 1, 8, 0, 0).unwrap();
        let now = Utc.with_ymd_and_hms(2026, 2, 1, 8, 0, 0).unwrap();
        let occ = missed_occurrences_tz("0 8 * * *", last, now, 3, &Utc).unwrap();
        assert_eq!(occ.len(), 3);
    }

    #[test]
    fn no_missed_when_caught_up() {
        let t = Utc.with_ymd_and_hms(2026, 1, 1, 8, 0, 0).unwrap();
        let occ = missed_occurrences_tz("0 8 * * *", t, t, 50, &Utc).unwrap();
        assert!(occ.is_empty());
    }
}
