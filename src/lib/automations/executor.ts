// Automation pipeline executor — the pure core. Runs one automation's steps
// top-to-bottom against a run context, plus the overlap-`mode` queue and the
// per-automation guardrails. All side effects are injected (deps), so this
// module is unit-testable without React/Tauri (Task #13).
//
// PRD: docs/prds/2026-06-28-automations.md (Task #7)

import type {
  Automation,
  AutomationRun,
  AutomationStep,
  RunMode,
  StepResult,
  TriggerType,
} from './types';
import { buildRunContext, render, formatToday, type RunContext } from './template';

// ----------------------------------------------------------------------------
// Single-run execution
// ----------------------------------------------------------------------------

export interface ExecutorDeps {
  /** Run an agent task, resolving with its final text output. */
  runAgent: (prompt: string, projectRoot: string | undefined) => Promise<string>;
  /** Write or append a document (the runner adds self-write tagging + path resolution). */
  writeDocument: (path: string, content: string, op: 'create' | 'append') => Promise<void>;
  /** Fire a user-intent notification. */
  notify: (title: string, body: string) => void;
  /** Persist evolving run state (upsert by runId). */
  persistRun: (run: AutomationRun) => void;
  now: () => Date;
  /** True once a `restart`/cancel has aborted this run. */
  isAborted: () => boolean;
}

export async function runAutomation(
  automation: Automation,
  trigger: Record<string, unknown>,
  deps: ExecutorDeps,
): Promise<AutomationRun> {
  const start = deps.now();
  const run: AutomationRun = {
    runId: `${automation.sourcePath}#${start.getTime()}`,
    automationId: automation.id,
    sourcePath: automation.sourcePath,
    startedAt: start.getTime(),
    status: 'running',
    trigger: {
      type: (trigger.type as TriggerType) ?? automation.trigger.type,
      file: typeof trigger.file === 'string' ? trigger.file : undefined,
    },
    steps: [],
  };
  const snapshot = (): AutomationRun => ({ ...run, steps: run.steps.map((s) => ({ ...s })) });
  deps.persistRun(snapshot());

  const ctx: RunContext = buildRunContext({ trigger, steps: {}, date: start });
  const projectRoot =
    automation.scope && automation.scope !== 'global' ? automation.scope : undefined;
  const maxSteps = automation.guardrails?.maxStepsPerRun ?? automation.steps.length;

  for (let i = 0; i < automation.steps.length; i++) {
    if (deps.isAborted()) {
      run.status = 'skipped';
      break;
    }
    if (i >= maxSteps) break; // guardrail: too many steps (rare for a linear pipeline)

    const step = automation.steps[i];
    const entry: AutomationRun['steps'][number] = { id: step.id, type: step.type };
    run.steps.push(entry);
    try {
      const result = await executeStep(step, ctx, projectRoot, deps);
      ctx.steps[step.id] = result;
      entry.result = result;
      deps.persistRun(snapshot());
    } catch (e) {
      entry.result = { output: '', error: e instanceof Error ? e.message : String(e) };
      run.status = 'error';
      run.completedAt = deps.now().getTime();
      deps.persistRun(snapshot());
      return run;
    }
  }

  if (run.status === 'running') run.status = 'done';
  run.completedAt = deps.now().getTime();
  deps.persistRun(snapshot());
  return run;
}

async function executeStep(
  step: AutomationStep,
  ctx: RunContext,
  projectRoot: string | undefined,
  deps: ExecutorDeps,
): Promise<StepResult> {
  switch (step.type) {
    case 'agent': {
      const output = await deps.runAgent(render(step.prompt, ctx), projectRoot);
      return { output };
    }
    case 'document': {
      const path = render(step.path, ctx);
      const content = render(step.content, ctx);
      await deps.writeDocument(path, content, step.op);
      return { output: path };
    }
    case 'notify': {
      const title = render(step.title, ctx);
      const body = render(step.body, ctx);
      deps.notify(title, body);
      return { output: `${title}: ${body}` };
    }
  }
}

// ----------------------------------------------------------------------------
// Overlap policy + serialization (R3). The task agent is a singleton, so ALL
// runs serialize through one queue regardless of per-automation `mode`.
// ----------------------------------------------------------------------------

export type RunOutcome = 'started' | 'queued' | 'dropped' | 'restarting';

interface Job {
  key: string;
  exec: (signal: AbortSignal) => Promise<void>;
}

export class RunManager {
  private active: { key: string; controller: AbortController } | null = null;
  private queue: Job[] = [];

  request(key: string, mode: RunMode, exec: Job['exec']): RunOutcome {
    const activeSame = this.active?.key === key;
    const queuedSame = this.queue.some((j) => j.key === key);

    if (mode === 'single' && (activeSame || queuedSame)) return 'dropped';

    if (mode === 'restart') {
      this.queue = this.queue.filter((j) => j.key !== key);
      if (activeSame) this.active!.controller.abort();
    }

    const willStartImmediately = !this.active;
    this.queue.push({ key, exec });
    this.pump();

    if (mode === 'restart' && activeSame) return 'restarting';
    return willStartImmediately ? 'started' : 'queued';
  }

  private pump(): void {
    if (this.active || this.queue.length === 0) return;
    const job = this.queue.shift()!;
    const controller = new AbortController();
    this.active = { key: job.key, controller };
    void job
      .exec(controller.signal)
      .catch(() => {})
      .finally(() => {
        this.active = null;
        this.pump();
      });
  }

  get isBusy(): boolean {
    return this.active !== null;
  }
}

// ----------------------------------------------------------------------------
// Guardrails — per-automation daily cap + a fire-rate circuit breaker.
// In-memory (resets on restart); the durable last-fired sidecar lives in Rust.
// ----------------------------------------------------------------------------

export interface GuardrailOptions {
  circuitThreshold: number;
  circuitWindowMs: number;
}

const DEFAULT_GUARDRAILS: GuardrailOptions = {
  circuitThreshold: 30,
  circuitWindowMs: 60 * 60 * 1000,
};

export class GuardrailTracker {
  private runsToday = new Map<string, { date: string; count: number }>();
  private fires = new Map<string, number[]>();
  private paused = new Set<string>();

  constructor(private opts: GuardrailOptions = DEFAULT_GUARDRAILS) {}

  /** `null` if the run is allowed, else a human-readable block reason. */
  check(key: string, maxRunsPerDay: number, now: Date): string | null {
    if (this.paused.has(key)) return 'paused by circuit breaker';

    const today = formatToday(now);
    const rec = this.runsToday.get(key);
    const count = rec && rec.date === today ? rec.count : 0;
    if (count >= maxRunsPerDay) return `daily limit reached (${maxRunsPerDay}/day)`;

    const recent = this.recentFires(key, now.getTime());
    if (recent.length >= this.opts.circuitThreshold) {
      this.paused.add(key);
      return 'paused — firing too often';
    }
    return null;
  }

  /** Record an actual run start (called when a job begins executing). */
  record(key: string, now: Date): void {
    const today = formatToday(now);
    const rec = this.runsToday.get(key);
    this.runsToday.set(
      key,
      rec && rec.date === today ? { date: today, count: rec.count + 1 } : { date: today, count: 1 },
    );
    const recent = this.recentFires(key, now.getTime());
    recent.push(now.getTime());
    this.fires.set(key, recent);
  }

  resume(key: string): void {
    this.paused.delete(key);
  }

  isPaused(key: string): boolean {
    return this.paused.has(key);
  }

  private recentFires(key: string, nowMs: number): number[] {
    return (this.fires.get(key) ?? []).filter((t) => nowMs - t < this.opts.circuitWindowMs);
  }
}
