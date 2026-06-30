import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { serializeAutomation, slugify, buildSourcePath } from '../serialize';
import type { Automation } from '../types';

const DIGEST: Automation = {
  id: 'morning-digest',
  name: 'Morning Digest',
  enabled: true,
  armed: false,
  scope: '/proj',
  mode: 'single',
  trigger: { type: 'schedule', cron: '0 8 * * *', catchUp: true },
  condition: { weekdays: [1, 2, 3, 4, 5] },
  guardrails: { maxRunsPerDay: 1, debounceMs: 0, maxStepsPerRun: 15 },
  steps: [
    { id: 'summary', type: 'agent', prompt: 'Summarize my notes since yesterday.' },
    {
      id: 'write',
      type: 'document',
      op: 'append',
      path: 'Daily/{{today}}.md',
      content: '## {{today}}\n\n{{steps.summary.output}}\n',
    },
    { id: 'ping', type: 'notify', title: 'Daily digest ready', body: 'Written to Daily/{{today}}.md' },
  ],
  sourcePath: '/proj/.notesage/automations/morning-digest.yaml',
};

describe('serializeAutomation', () => {
  it('round-trips the authored fields through YAML', () => {
    const round = parse(serializeAutomation(DIGEST));
    expect(round).toEqual({
      name: 'Morning Digest',
      enabled: true,
      mode: 'single',
      trigger: { type: 'schedule', cron: '0 8 * * *', catchUp: true },
      condition: { weekdays: [1, 2, 3, 4, 5] },
      guardrails: { maxRunsPerDay: 1, debounceMs: 0, maxStepsPerRun: 15 },
      steps: DIGEST.steps,
    });
  });

  it('omits loader-filled fields (id/scope/sourcePath/armed)', () => {
    const round = parse(serializeAutomation(DIGEST)) as Record<string, unknown>;
    expect(round).not.toHaveProperty('id');
    expect(round).not.toHaveProperty('scope');
    expect(round).not.toHaveProperty('sourcePath');
    expect(round).not.toHaveProperty('armed');
  });

  it('preserves multi-line content verbatim', () => {
    const round = parse(serializeAutomation(DIGEST)) as { steps: { content?: string }[] };
    expect(round.steps[1].content).toBe('## {{today}}\n\n{{steps.summary.output}}\n');
  });

  it('drops an empty condition', () => {
    const noCond = serializeAutomation({ ...DIGEST, condition: undefined });
    expect(parse(noCond)).not.toHaveProperty('condition');
  });

  it('round-trips a file trigger', () => {
    const triage: Automation = {
      id: 'inbox-triage',
      name: 'Inbox Triage',
      enabled: true,
      armed: false,
      scope: '/proj',
      mode: 'single',
      trigger: { type: 'file', event: 'file-created', path: 'Inbox' },
      condition: { glob: 'Inbox/*.md' },
      guardrails: { maxRunsPerDay: 50, debounceMs: 60000, maxStepsPerRun: 15 },
      steps: [
        { id: 'classify', type: 'agent', prompt: 'Classify {{trigger.file}}.' },
        { id: 'ping', type: 'notify', title: 'Filed', body: '{{trigger.file}} triaged' },
      ],
      sourcePath: '/proj/.notesage/automations/inbox-triage.yaml',
    };
    const round = parse(serializeAutomation(triage));
    expect(round).toEqual({
      name: 'Inbox Triage',
      enabled: true,
      mode: 'single',
      trigger: { type: 'file', event: 'file-created', path: 'Inbox' },
      condition: { glob: 'Inbox/*.md' },
      guardrails: { maxRunsPerDay: 50, debounceMs: 60000, maxStepsPerRun: 15 },
      steps: triage.steps,
    });
  });

  it('round-trips a per-step `if` condition (Track A)', () => {
    const a: Automation = {
      ...DIGEST,
      steps: [
        {
          id: 'ping',
          type: 'notify',
          title: 't',
          body: 'b',
          if: 'steps.x.output contains "urgent"',
        },
      ],
    };
    const round = parse(serializeAutomation(a)) as { steps: Record<string, unknown>[] };
    expect(round.steps[0].if).toBe('steps.x.output contains "urgent"');
  });

  it('omits the `if` field when undefined', () => {
    const round = parse(serializeAutomation(DIGEST)) as { steps: Record<string, unknown>[] };
    expect(round.steps[0]).not.toHaveProperty('if');
  });

  it('slugify + buildSourcePath', () => {
    expect(slugify('Morning Digest!')).toBe('morning-digest');
    expect(slugify('   ')).toBe('automation');
    expect(buildSourcePath('global', '/Users/me', 'x')).toBe(
      '/Users/me/.notesage/automations/x.yaml',
    );
    expect(buildSourcePath('/proj', '/Users/me', 'x')).toBe('/proj/.notesage/automations/x.yaml');
  });
});
