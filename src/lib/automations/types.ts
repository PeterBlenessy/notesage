// Automations — TypeScript model, mirroring the Rust structs in
// `src-tauri/src/commands/automations.rs` (serde `camelCase`, so on-disk YAML,
// IPC JSON, and these interfaces are one representation).
//
// PRD: docs/prds/2026-06-28-automations.md · Research: docs/research/automation-formats.md

/**
 * Overlap policy when a run is already active (R3, Home-Assistant style).
 * NB: `restart` cancellation is cooperative — it skips the *remaining* steps of
 * the in-flight run at the next step boundary; an already-executing step
 * (agent/skill/document) still runs to completion (see executor.ts).
 */
export type RunMode = 'single' | 'restart' | 'queued';

export type TriggerType = 'schedule' | 'file' | 'workflow';
export type StepType = 'agent' | 'document' | 'notify';

export type FileEventName =
  | 'file-created'
  | 'file-modified'
  | 'file-deleted'
  | 'file-renamed';
export type WorkflowEventName =
  | 'agent-task-complete'
  | 'document-saved'
  | 'transcription-done';

/** schedule: canonical 5-field cron (`"0 8 * * *"`), interpreted in local time. */
export interface ScheduleTrigger {
  type: 'schedule';
  cron: string;
  /** include in missed-run reconciliation (default true). */
  catchUp?: boolean;
}
/** file: a watcher event on `path` (defaults to the automation's scope). */
export interface FileTrigger {
  type: 'file';
  event: FileEventName;
  path?: string;
}
/** workflow: an in-app event (document-saved / agent-task-complete / transcription-done). */
export interface WorkflowTrigger {
  type: 'workflow';
  event: WorkflowEventName;
}

/**
 * Discriminated by `type` so each variant only exposes its own fields — reading
 * `trigger.cron` on a file trigger is a compile error, not silent `undefined`.
 * Serializes to the same flat YAML/JSON the Rust `Trigger` struct does.
 */
export type Trigger = ScheduleTrigger | FileTrigger | WorkflowTrigger;

// Typed accessors — read a possibly-absent field across variants without
// scattering `type` guards (callbacks lose narrowing, so these centralize it).
export const triggerCron = (t: Trigger): string | undefined =>
  t.type === 'schedule' ? t.cron : undefined;
export const triggerCatchUp = (t: Trigger): boolean | undefined =>
  t.type === 'schedule' ? t.catchUp : undefined;
export const triggerEvent = (t: Trigger): FileEventName | WorkflowEventName | undefined =>
  t.type === 'file' || t.type === 'workflow' ? t.event : undefined;
export const triggerPath = (t: Trigger): string | undefined =>
  t.type === 'file' ? t.path : undefined;

/** Trigger-level gate (R1, was `filter`). Phase 1 ships `weekdays`. */
export interface Condition {
  glob?: string;
  weekdays?: number[];
  frontmatter?: Record<string, string>;
}

export interface Guardrails {
  maxRunsPerDay: number;
  debounceMs: number;
  maxStepsPerRun: number;
}

/** Per-automation guardrail defaults — mirror the Rust `default_max_runs()` /
 *  `default_max_steps()` fns. Single TS source of truth for the form builder. */
export const DEFAULT_AUTOMATION_GUARDRAILS: Guardrails = {
  maxRunsPerDay: 24,
  debounceMs: 0,
  maxStepsPerRun: 25,
};

// Every step may carry an optional `if` — a condition expression (see
// condition-expr.ts) that, when present and falsey at run time, SKIPS the step
// (the run continues to the next step). Phase 4, Track A.
export type AutomationStep =
  | { type: 'agent'; id: string; prompt: string; if?: string }
  | {
      type: 'document';
      id: string;
      op: 'create' | 'append';
      path: string;
      content: string;
      if?: string;
    }
  | { type: 'notify'; id: string; title: string; body: string; if?: string };

export interface Automation {
  /** Slug derived from the filename (filled by the loader). */
  id: string;
  name: string;
  enabled: boolean;
  /** `false` until reviewed when it contains a write/script step (Task #8). */
  armed: boolean;
  /** `"global"` or a project root path (filled by the loader). */
  scope?: string;
  mode: RunMode;
  trigger: Trigger;
  condition?: Condition;
  guardrails: Guardrails;
  steps: AutomationStep[];
  /** Absolute path to the YAML (filled by the loader). */
  sourcePath: string;
}

/**
 * R2 — per-step result envelope. `output` is the text used by
 * `{{steps.<id>.output}}`; `json` holds a structured result (an agent/skill
 * returning JSON) addressable as `{{steps.<id>.json.field}}`.
 */
export interface StepResult {
  output: string;
  json?: unknown;
  error?: string;
  /** `true` when the step was skipped because its `if` was falsey (Track A). */
  skipped?: boolean;
}

export type RunStatus = 'running' | 'done' | 'error' | 'skipped';

export interface AutomationRun {
  runId: string;
  automationId: string;
  /** Unique key the run is filed under (matches `Automation.sourcePath`). */
  sourcePath: string;
  startedAt: number;
  completedAt?: number;
  status: RunStatus;
  trigger: { type: TriggerType; file?: string };
  steps: { id: string; type: StepType; result?: StepResult }[];
}

// --- IPC return shapes ------------------------------------------------------

/** One discovered file: the parsed automation, or its parse/validation error. */
export interface AutomationFile {
  path: string;
  automation?: Automation;
  valid: boolean;
  error?: string;
}

export interface AutomationValidation {
  ok: boolean;
  error?: string;
  /** Next fire time (RFC3339, schedule triggers only) — preview for the form builder. */
  nextRun?: string;
}

// --- Event payloads (emitted by the Rust scheduler) -------------------------

/** `automation-due` — a scheduled automation is due; the runner executes it. */
export interface AutomationDuePayload {
  automationId: string;
  sourcePath: string;
  scheduledFor: string;
}

/** One automation with runs missed during a downtime gap. */
export interface MissedEntry {
  automationId: string;
  sourcePath: string;
  name: string;
  missedCount: number;
  lastFiredAt?: string;
  occurrences: string[];
}

/** `automations-missed` — surfaced to the user on launch (never auto-fired). */
export interface AutomationsMissedPayload {
  entries: MissedEntry[];
}
