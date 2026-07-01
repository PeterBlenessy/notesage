import { describe, it, expect } from 'vitest';
import { evaluateCondition } from '../condition-expr';
import { buildRunContext, type RunContext } from '../template';

const ctx: RunContext = buildRunContext({
  trigger: { type: 'workflow', file: '/Inbox/note.md', output: 'URGENT: fix' },
  steps: {
    classify: { output: 'urgent', json: { urgent: true, count: 3, label: 'p1' } },
    review: { output: 'has a TODO here' },
    empty: { output: '' },
  },
  date: new Date(2026, 0, 15),
});

describe('evaluateCondition — operators', () => {
  it('== compares booleans, strings, and numbers', () => {
    expect(evaluateCondition('steps.classify.json.urgent == true', ctx)).toBe(true);
    expect(evaluateCondition('steps.classify.json.urgent == false', ctx)).toBe(false);
    expect(evaluateCondition('steps.classify.output == "urgent"', ctx)).toBe(true);
    expect(evaluateCondition('steps.classify.json.count == 3', ctx)).toBe(true);
    expect(evaluateCondition('steps.classify.json.label == "p2"', ctx)).toBe(false);
  });

  it('!= negates', () => {
    expect(evaluateCondition('steps.classify.json.count != 0', ctx)).toBe(true);
    expect(evaluateCondition('steps.classify.json.urgent != true', ctx)).toBe(false);
  });

  it('contains does substring matching', () => {
    expect(evaluateCondition('steps.review.output contains "TODO"', ctx)).toBe(true);
    expect(evaluateCondition('steps.review.output contains "MISSING"', ctx)).toBe(false);
  });

  it('matches does regex testing', () => {
    expect(evaluateCondition('trigger.file matches "\\.md$"', ctx)).toBe(true);
    expect(evaluateCondition('trigger.file matches "\\.txt$"', ctx)).toBe(false);
    expect(evaluateCondition('trigger.file matches "(["', ctx)).toBe(false); // invalid regex → false
  });

  it('bare path is a truthiness test (with or without {{ }})', () => {
    expect(evaluateCondition('{{trigger.file}}', ctx)).toBe(true);
    expect(evaluateCondition('trigger.file', ctx)).toBe(true);
    expect(evaluateCondition('steps.empty.output', ctx)).toBe(false); // empty string → falsey
    expect(evaluateCondition('steps.classify.json.count', ctx)).toBe(true); // 3 → truthy
  });

  it('resolves a {{ }}-wrapped left-hand side', () => {
    expect(evaluateCondition('{{steps.classify.output}} == "urgent"', ctx)).toBe(true);
  });
});

describe('evaluateCondition — safety + edge cases', () => {
  it('a missing path is falsey, never throws', () => {
    expect(evaluateCondition('steps.nope.output', ctx)).toBe(false);
    expect(evaluateCondition('trigger.missing == "x"', ctx)).toBe(false);
    expect(evaluateCondition('steps.classify.json.deep.deeper == "x"', ctx)).toBe(false);
  });

  it('a malformed expression resolves to false (never throws)', () => {
    expect(evaluateCondition('== ==', ctx)).toBe(false);
    expect(evaluateCondition('steps.', ctx)).toBe(false);
    expect(evaluateCondition('   ', ctx)).toBe(true); // whitespace-only ⇒ empty ⇒ always-run
  });

  it('is inert against injection — pure data, no eval/interpolation', () => {
    // None of these execute anything; they resolve to undefined/strings → false.
    expect(() => evaluateCondition('process.env contains "PATH"', ctx)).not.toThrow();
    expect(evaluateCondition('process.env contains "PATH"', ctx)).toBe(false);
    expect(evaluateCondition('steps.classify.output == "${1+1}"', ctx)).toBe(false);
    expect(evaluateCondition('"${process.exit(1)}" == "0"', ctx)).toBe(false);
    expect(evaluateCondition('__proto__.polluted == "yes"', ctx)).toBe(false);
    expect(evaluateCondition('constructor.name == "Object"', ctx)).toBe(false);
  });
});
