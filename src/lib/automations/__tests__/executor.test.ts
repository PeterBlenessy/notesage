import { describe, it, expect } from 'vitest';
import {
  runAutomation,
  RunManager,
  GuardrailTracker,
  effectiveDebounceMs,
  DEFAULT_FILE_DEBOUNCE_MS,
  type ExecutorDeps,
} from '../executor';
import type { Automation } from '../types';

const FIXED = new Date(2026, 0, 15, 8, 0, 0);

const DIGEST: Automation = {
  id: 'morning-digest',
  name: 'Morning Digest',
  enabled: true,
  armed: true,
  scope: '/proj',
  mode: 'single',
  trigger: { type: 'schedule', cron: '0 8 * * *' },
  guardrails: { maxRunsPerDay: 1, debounceMs: 0, maxStepsPerRun: 15 },
  steps: [
    { id: 'summary', type: 'agent', prompt: 'Summarize {{trigger.file}} on {{today}}' },
    {
      id: 'write',
      type: 'document',
      op: 'append',
      path: 'Daily/{{today}}.md',
      content: '## {{today}}\n{{steps.summary.output}}\n',
    },
    { id: 'ping', type: 'notify', title: 'done', body: '{{steps.summary.output}}' },
  ],
  sourcePath: '/proj/.notesage/automations/morning-digest.yaml',
};

function makeDeps(overrides: Partial<ExecutorDeps> = {}) {
  const calls = {
    agent: [] as { prompt: string; projectRoot?: string }[],
    doc: [] as { path: string; content: string; op: string }[],
    skill: [] as { skill: string; script: string; args: string[] }[],
    notify: [] as { title: string; body: string }[],
    runs: [] as { status: string }[],
  };
  const deps: ExecutorDeps = {
    runAgent: async (prompt, projectRoot) => {
      calls.agent.push({ prompt, projectRoot });
      return 'AGENT_OUT';
    },
    writeDocument: async (path, content, op) => {
      calls.doc.push({ path, content, op });
    },
    runSkill: async (skill, script, args) => {
      calls.skill.push({ skill, script, args });
      return 'SKILL_OUT';
    },
    notify: (title, body) => {
      calls.notify.push({ title, body });
    },
    persistRun: (run) => {
      calls.runs.push({ status: run.status });
    },
    now: () => FIXED,
    isAborted: () => false,
    ...overrides,
  };
  return { deps, calls };
}

describe('runAutomation', () => {
  it('runs the daily-digest pipeline, threading rendered context', async () => {
    const { deps, calls } = makeDeps();
    const run = await runAutomation(DIGEST, { type: 'schedule', file: '/proj/a.md' }, deps);

    expect(run.status).toBe('done');
    expect(run.steps.map((s) => s.id)).toEqual(['summary', 'write', 'ping']);
    expect(run.steps[0].result?.output).toBe('AGENT_OUT');

    expect(calls.agent[0]).toEqual({
      prompt: 'Summarize /proj/a.md on 2026-01-15',
      projectRoot: '/proj',
    });
    expect(calls.doc[0]).toEqual({
      path: 'Daily/2026-01-15.md',
      content: '## 2026-01-15\nAGENT_OUT\n',
      op: 'append',
    });
    expect(calls.notify[0]).toEqual({ title: 'done', body: 'AGENT_OUT' });
    // persistRun is called at start + after each step + at completion.
    expect(calls.runs.length).toBeGreaterThanOrEqual(4);
    expect(calls.runs[calls.runs.length - 1]?.status).toBe('done');
  });

  it('stops at a failing step and records the error', async () => {
    const { deps, calls } = makeDeps({
      runAgent: async () => {
        throw new Error('boom');
      },
    });
    const run = await runAutomation(DIGEST, { type: 'schedule' }, deps);

    expect(run.status).toBe('error');
    expect(run.steps).toHaveLength(1); // halted after the failing agent step
    expect(run.steps[0].result?.error).toBe('boom');
    expect(calls.doc).toHaveLength(0); // downstream steps never ran
    expect(calls.notify).toHaveLength(0);
  });

  it('marks the run skipped when aborted before a step', async () => {
    const { deps, calls } = makeDeps({ isAborted: () => true });
    const run = await runAutomation(DIGEST, { type: 'schedule' }, deps);
    expect(run.status).toBe('skipped');
    expect(calls.agent).toHaveLength(0);
  });

  it('runs a skill step with rendered args (Inbox-Triage shape)', async () => {
    const { deps, calls } = makeDeps();
    const triage: Automation = {
      ...DIGEST,
      trigger: { type: 'file', event: 'file-created' },
      steps: [
        { id: 'classify', type: 'agent', prompt: 'Classify {{trigger.file}}' },
        {
          id: 'file-it',
          type: 'skill',
          skill: 'file-organizer',
          script: 'move.sh',
          args: ['{{trigger.file}}', '{{steps.classify.output}}'],
        },
        { id: 'ping', type: 'notify', title: 'Filed', body: '{{trigger.file}}' },
      ],
    };
    const run = await runAutomation(triage, { type: 'file', file: '/proj/Inbox/n.md' }, deps);

    expect(run.status).toBe('done');
    expect(calls.skill[0]).toEqual({
      skill: 'file-organizer',
      script: 'move.sh',
      args: ['/proj/Inbox/n.md', 'AGENT_OUT'],
    });
    expect(run.steps[1].result?.output).toBe('SKILL_OUT');
    expect(calls.notify[0]).toEqual({ title: 'Filed', body: '/proj/Inbox/n.md' });
  });

  it('runs an On-save Check (workflow document-saved → agent → notify)', async () => {
    const { deps, calls } = makeDeps();
    const onSave: Automation = {
      ...DIGEST,
      trigger: { type: 'workflow', event: 'document-saved' },
      steps: [
        { id: 'review', type: 'agent', prompt: 'Review {{trigger.file}} for missing tags' },
        { id: 'ping', type: 'notify', title: 'Reviewed', body: '{{steps.review.output}}' },
      ],
    };
    const run = await runAutomation(
      onSave,
      { type: 'workflow', event: 'document-saved', file: '/proj/notes/x.md' },
      deps,
    );

    expect(run.status).toBe('done');
    expect(calls.agent[0].prompt).toBe('Review /proj/notes/x.md for missing tags');
    expect(calls.notify[0]).toEqual({ title: 'Reviewed', body: 'AGENT_OUT' });
  });
});

describe('RunManager (overlap mode)', () => {
  it('mode=single drops an overlapping fire while a run is active', async () => {
    const mgr = new RunManager();
    let release!: () => void;
    const pending = new Promise<void>((r) => {
      release = r;
    });

    const first = mgr.request('k', 'single', async () => {
      await pending;
    });
    const second = mgr.request('k', 'single', async () => {});

    expect(first).toBe('started');
    expect(second).toBe('dropped');
    release();
  });

  it('mode=restart aborts the in-flight run', async () => {
    const mgr = new RunManager();
    let firstAborted = false;
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((r) => {
      releaseFirst = r;
    });

    mgr.request('k', 'restart', async (signal) => {
      signal.addEventListener('abort', () => {
        firstAborted = true;
      });
      await firstPending;
    });
    const outcome = mgr.request('k', 'restart', async () => {});

    expect(outcome).toBe('restarting');
    expect(firstAborted).toBe(true);
    releaseFirst();
  });

  it('mode=queued serializes runs in order', async () => {
    const mgr = new RunManager();
    const order: string[] = [];
    let release!: () => void;
    const pending = new Promise<void>((r) => {
      release = r;
    });

    mgr.request('a', 'queued', async () => {
      order.push('a-start');
      await pending;
      order.push('a-end');
    });
    mgr.request('b', 'queued', async () => {
      order.push('b');
    });

    expect(order).toEqual(['a-start']); // b waits behind a
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['a-start', 'a-end', 'b']);
  });
});

describe('GuardrailTracker', () => {
  it('enforces the per-day cap', () => {
    const g = new GuardrailTracker();
    expect(g.check('k', 1, FIXED)).toBeNull();
    g.record('k', FIXED);
    expect(g.check('k', 1, FIXED)).toMatch(/daily limit/);
  });

  it('trips a circuit breaker on too-frequent fires', () => {
    const g = new GuardrailTracker({ circuitThreshold: 3, circuitWindowMs: 1000 });
    for (let i = 0; i < 3; i++) {
      expect(g.check('k', 999, FIXED)).toBeNull();
      g.record('k', FIXED);
    }
    expect(g.check('k', 999, FIXED)).toMatch(/too often/);
    expect(g.isPaused('k')).toBe(true);
  });

  it('debounces an event re-fire within the debounce window', () => {
    const g = new GuardrailTracker();
    const t0 = FIXED;
    expect(g.check('k', 999, t0, 60_000)).toBeNull();
    g.record('k', t0);

    // A second event 30s later is suppressed.
    const t30 = new Date(t0.getTime() + 30_000);
    expect(g.check('k', 999, t30, 60_000)).toMatch(/debounce/i);

    // After the window elapses, it fires again.
    const t61 = new Date(t0.getTime() + 61_000);
    expect(g.check('k', 999, t61, 60_000)).toBeNull();
  });

  it('does not debounce when debounceMs is 0 (schedule triggers)', () => {
    const g = new GuardrailTracker();
    expect(g.check('k', 999, FIXED, 0)).toBeNull();
    g.record('k', FIXED);
    // Same instant but debounce disabled → still allowed (cap permitting).
    expect(g.check('k', 999, FIXED, 0)).toBeNull();
  });

  it('debounce is per-key', () => {
    const g = new GuardrailTracker();
    g.record('a', FIXED);
    // A different automation is unaffected by a's recent fire.
    expect(g.check('b', 999, FIXED, 60_000)).toBeNull();
  });
});

describe('effectiveDebounceMs', () => {
  it('returns 0 for schedule triggers regardless of debounceMs', () => {
    expect(effectiveDebounceMs('schedule', 60_000)).toBe(0);
    expect(effectiveDebounceMs('schedule', 0)).toBe(0);
    expect(effectiveDebounceMs('schedule', undefined)).toBe(0);
  });

  it('defaults to 60s for event triggers when unset/0', () => {
    expect(effectiveDebounceMs('file', 0)).toBe(DEFAULT_FILE_DEBOUNCE_MS);
    expect(effectiveDebounceMs('file', undefined)).toBe(DEFAULT_FILE_DEBOUNCE_MS);
    expect(effectiveDebounceMs('workflow', 0)).toBe(DEFAULT_FILE_DEBOUNCE_MS);
  });

  it('honours an explicit debounceMs for event triggers', () => {
    expect(effectiveDebounceMs('file', 5_000)).toBe(5_000);
    expect(effectiveDebounceMs('workflow', 120_000)).toBe(120_000);
  });
});
