import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  render,
  buildRunContext,
  formatToday,
  formatNow,
  type RunContext,
} from '../template';

// Built from LOCAL components, so getFullYear/getMonth/getDate/getHours read
// back identically on any machine timezone → deterministic.
const FIXED = new Date(2026, 0, 15, 8, 30, 0);

function ctx(): RunContext {
  return buildRunContext({
    trigger: { type: 'file', file: '/proj/Inbox/note.md', event: 'file-created' },
    steps: {
      summary: { output: 'A short summary.' },
      classify: { output: 'urgent', json: { label: 'urgent', score: 0.9 } },
    },
    date: FIXED,
  });
}

describe('automation template renderer', () => {
  it('formats local today / now', () => {
    expect(formatToday(FIXED)).toBe('2026-01-15');
    expect(formatNow(FIXED)).toBe('2026-01-15 08:30');
    expect(formatToday(new Date(2026, 11, 5))).toBe('2026-12-05'); // zero-padding
  });

  it('renders {{today}} and {{now}}', () => {
    const c = ctx();
    expect(render('Daily/{{today}}.md', c)).toBe('Daily/2026-01-15.md');
    expect(render('at {{now}}', c)).toBe('at 2026-01-15 08:30');
  });

  it('substitutes trigger fields', () => {
    expect(render('file: {{trigger.file}} ({{trigger.event}})', ctx())).toBe(
      'file: /proj/Inbox/note.md (file-created)',
    );
  });

  it('substitutes prior step output, whitespace-tolerant', () => {
    expect(render('Summary: {{ steps.summary.output }}', ctx())).toBe(
      'Summary: A short summary.',
    );
  });

  it('resolves nested json from a step result (R2)', () => {
    expect(
      render('label={{steps.classify.json.label}} score={{steps.classify.json.score}}', ctx()),
    ).toBe('label=urgent score=0.9');
  });

  it('renders missing tokens as empty and collects warnings', () => {
    const r = renderTemplate('x={{trigger.nope}} y={{steps.ghost.output}} z={{bogus}}', ctx());
    expect(r.text).toBe('x= y= z=');
    expect(r.warnings).toEqual(['trigger.nope', 'steps.ghost.output', 'bogus']);
  });

  it('preserves an empty-string step output without warning', () => {
    const c = buildRunContext({ trigger: {}, steps: { s: { output: '' } }, date: FIXED });
    const r = renderTemplate('[{{steps.s.output}}]', c);
    expect(r.text).toBe('[]');
    expect(r.warnings).toEqual([]);
  });

  it('does not execute code — tokens are pure path lookups', () => {
    const r = renderTemplate('{{ 1 + 1 }} and {{ process.env.HOME }}', ctx());
    expect(r.text).toBe(' and ');
    // template-literal syntax in the INPUT is left literal (not interpreted)
    expect(render('${trigger.file} stays literal', ctx())).toBe('${trigger.file} stays literal');
  });

  it('leaves unmatched braces literal', () => {
    expect(render('a {{ b', ctx())).toBe('a {{ b');
  });
});
