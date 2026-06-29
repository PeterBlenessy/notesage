import { describe, it, expect, beforeEach } from 'vitest';
import { fileTriggerMatches } from '../file-match';
import { markAutomationWrite, wasAutomationWrite, _resetLoopGuard } from '../loop-guard';
import type { Automation } from '../types';

function fileAuto(over: Partial<Automation> = {}): Automation {
  return {
    id: 'a',
    name: 'A',
    enabled: true,
    armed: true,
    scope: '/proj',
    mode: 'single',
    trigger: { type: 'file', event: 'file-created', path: '/proj/Inbox' },
    guardrails: { maxRunsPerDay: 50, debounceMs: 0, maxStepsPerRun: 15 },
    steps: [{ id: 's', type: 'notify', title: 't', body: 'b' }],
    sourcePath: '/proj/.notesage/automations/a.yaml',
    ...over,
  };
}

describe('fileTriggerMatches', () => {
  it('matches the right event for an in-scope file', () => {
    expect(fileTriggerMatches(fileAuto(), 'file-created', '/proj/Inbox/n.md')).toBe(true);
  });
  it('rejects a different event', () => {
    expect(fileTriggerMatches(fileAuto(), 'file-deleted', '/proj/Inbox/n.md')).toBe(false);
  });
  it('rejects a file outside the watched root', () => {
    expect(fileTriggerMatches(fileAuto(), 'file-created', '/other/n.md')).toBe(false);
  });
  it('rejects non-file triggers', () => {
    const sched = fileAuto({ trigger: { type: 'schedule', cron: '0 8 * * *' } });
    expect(fileTriggerMatches(sched, 'file-created', '/proj/Inbox/n.md')).toBe(false);
  });
});

describe('loop guard', () => {
  beforeEach(() => _resetLoopGuard());

  it("suppresses an automation's own write within the TTL", () => {
    markAutomationWrite('/proj/Inbox/n.md');
    expect(wasAutomationWrite('/proj/Inbox/n.md')).toBe(true);
    expect(wasAutomationWrite('/proj/Inbox/other.md')).toBe(false); // unrelated path still fires
  });

  it('expires after the TTL', () => {
    markAutomationWrite('/p');
    expect(wasAutomationWrite('/p', Date.now() + 20_000)).toBe(false);
  });
});
