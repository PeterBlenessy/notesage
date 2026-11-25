import { describe, it, expect } from 'vitest';
import {
  GLOBAL_SCOPE,
  NO_SCOPES,
  applyProgress,
  beginScope,
  finishAllExcept,
  finishScope,
  removeScope,
  scopeKey,
  summarize,
  type IndexScopes,
} from '../index-progress';

const WORK = '/lib/Work';
const HOME = '/lib/Home';
const STARTUP = { startupSettled: false, projects: [WORK, HOME] };
const SETTLED = { startupSettled: true, projects: [WORK, HOME] };

describe('index progress: adding the scopes up', () => {
  it('is idle with no scopes, settled or not', () => {
    expect(summarize(NO_SCOPES, STARTUP).active).toBe(false);
    expect(summarize(NO_SCOPES, SETTLED).active).toBe(false);
  });

  it('keys the global pass apart from every project', () => {
    expect(scopeKey(null)).toBe(GLOBAL_SCOPE);
    expect(scopeKey(undefined)).toBe(GLOBAL_SCOPE);
    expect(scopeKey(WORK)).toBe(WORK);
  });

  it('adds several scopes into ONE total instead of restarting per project', () => {
    let scopes: IndexScopes = NO_SCOPES;
    scopes = applyProgress(scopes, GLOBAL_SCOPE, 100, 100);
    scopes = finishScope(scopes, GLOBAL_SCOPE);
    scopes = applyProgress(scopes, WORK, 150, 2000);
    scopes = applyProgress(scopes, HOME, 50, 900);

    const summary = summarize(scopes, STARTUP);
    expect(summary.active).toBe(true);
    expect(summary.filesDone).toBe(300);
    expect(summary.filesTotal).toBe(3000);
    expect(summary.fraction).toBeCloseTo(0.1);
    expect(summary.pendingScopes).toBe(0);
    expect(summary.currentScopes).toEqual([WORK, HOME]);
  });

  it('counts the projects still to start, and draws no fraction from a partial total', () => {
    const scopes = applyProgress(NO_SCOPES, GLOBAL_SCOPE, 50, 100);
    const summary = summarize(scopes, STARTUP);

    expect(summary.pendingScopes).toBe(2);
    expect(summary.filesDone).toBe(50);
    expect(summary.filesTotal).toBe(100);
    // 50% of the library pass is not 50% of the indexing.
    expect(summary.fraction).toBeNull();
  });

  it('has no fraction while a pass has begun but not reported its size', () => {
    let scopes = applyProgress(NO_SCOPES, WORK, 10, 100);
    scopes = beginScope(scopes, HOME);
    const summary = summarize(scopes, SETTLED);
    expect(summary.active).toBe(true);
    expect(summary.fraction).toBeNull();
    expect(summary.currentScopes).toEqual([WORK]);
  });

  it('stays active between the passes of a startup that has not settled', () => {
    let scopes = applyProgress(NO_SCOPES, GLOBAL_SCOPE, 100, 100);
    scopes = finishScope(scopes, GLOBAL_SCOPE);
    expect(summarize(scopes, STARTUP).active).toBe(true);
    // Every scope ready AND startup settled: only then is it over.
    const done = summarize(scopes, { startupSettled: true, projects: [] });
    expect(done.active).toBe(false);
    expect(done.fraction).toBe(1);
    expect(done.filesDone).toBe(100);
  });

  it('a scope that restarts counts from its new numbers, not on top of the old', () => {
    let scopes = applyProgress(NO_SCOPES, WORK, 400, 400);
    scopes = finishScope(scopes, WORK);
    // Recovery: the database was reset and the pass runs again.
    scopes = applyProgress(scopes, WORK, 0, 380);

    const summary = summarize(scopes, SETTLED);
    expect(summary.active).toBe(true);
    expect(summary.filesDone).toBe(0);
    expect(summary.filesTotal).toBe(380);
  });

  it('a finished scope is not reopened by its own last event arriving late', () => {
    let scopes = applyProgress(NO_SCOPES, WORK, 350, 400);
    scopes = finishScope(scopes, WORK);
    const late = applyProgress(scopes, WORK, 400, 400);
    expect(late).toBe(scopes);
    expect(summarize(late, SETTLED).active).toBe(false);
  });

  it('finishing a scope ends it at current == total even if events were lost', () => {
    let scopes = applyProgress(NO_SCOPES, WORK, 50, 400);
    scopes = finishScope(scopes, WORK);
    expect(scopes[WORK]).toEqual({ current: 400, total: 400, done: true });
  });

  it('a ready for a scope that never reported changes nothing', () => {
    expect(finishScope(NO_SCOPES, WORK)).toBe(NO_SCOPES);
    expect(summarize(finishScope(NO_SCOPES, GLOBAL_SCOPE), SETTLED).active).toBe(false);
  });

  it('a ready without progress ends a scope that had only begun', () => {
    let scopes = beginScope(NO_SCOPES, GLOBAL_SCOPE);
    expect(summarize(scopes, SETTLED).active).toBe(true);
    scopes = finishScope(scopes, GLOBAL_SCOPE);
    const summary = summarize(scopes, SETTLED);
    expect(summary.active).toBe(false);
    expect(summary.filesTotal).toBe(0);
  });

  it('removing a project takes its files out of the total', () => {
    let scopes = applyProgress(NO_SCOPES, WORK, 10, 100);
    scopes = applyProgress(scopes, HOME, 5, 50);
    scopes = removeScope(scopes, WORK);

    const summary = summarize(scopes, { startupSettled: true, projects: [HOME] });
    expect(summary.filesDone).toBe(5);
    expect(summary.filesTotal).toBe(50);
    expect(removeScope(scopes, '/lib/Unknown')).toBe(scopes);
  });

  it('a scope that never reports ready can be closed for it, except while its command runs', () => {
    let scopes = applyProgress(NO_SCOPES, WORK, 10, 100);
    scopes = applyProgress(scopes, HOME, 5, 50);
    scopes = finishAllExcept(scopes, new Set([HOME]));
    expect(scopes[WORK].done).toBe(true);
    expect(scopes[HOME].done).toBe(false);
  });

  it('a project indexed mid-session, after startup settled, is active on its own', () => {
    const scopes = applyProgress(NO_SCOPES, '/lib/Added', 0, 12);
    const summary = summarize(scopes, { startupSettled: true, projects: [WORK, HOME, '/lib/Added'] });
    expect(summary.active).toBe(true);
    expect(summary.pendingScopes).toBe(0);
    expect(summary.fraction).toBe(0);
    expect(summary.currentScopes).toEqual(['/lib/Added']);
  });

  it('an empty pass (0 of 0) is a pass: active until ready, and never divides by zero', () => {
    const scopes = applyProgress(NO_SCOPES, WORK, 0, 0);
    const summary = summarize(scopes, SETTLED);
    expect(summary.active).toBe(true);
    expect(summary.fraction).toBeNull();
  });

  it('never reports more done than there is, and survives a malformed payload', () => {
    const over = applyProgress(NO_SCOPES, WORK, 500, 100);
    expect(over[WORK].current).toBe(100);
    const junk = applyProgress(NO_SCOPES, WORK, 'x', undefined);
    expect(junk[WORK]).toEqual({ current: 0, total: 0, done: false });
  });
});
