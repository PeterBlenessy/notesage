// Tests for the defensive `_meta` parser registry (provider-usage-display #2).
//
// `_meta` is non-contractual by ACP spec — the parser must survive arbitrary
// payloads (garbage included) and never throw.

import { describe, it, expect } from 'vitest';
import { parseUsageMeta } from '../usage';

const CLAUDE_KEY = '_claude/rateLimit';

describe('parseUsageMeta', () => {
  it('parses a fully valid Claude rate-limit payload', () => {
    const payload = {
      status: 'allowed_warning',
      rateLimitType: 'five_hour',
      resetsAt: 1_751_700_000,
      utilization: 87,
    };
    const result = parseUsageMeta({ [CLAUDE_KEY]: payload });
    expect(result).toEqual({
      status: 'allowed_warning',
      rateLimitType: 'five_hour',
      resetsAt: 1_751_700_000,
      utilization: 87,
      raw: payload,
    });
  });

  it('returns a partial with only the valid fields on a partial payload', () => {
    const result = parseUsageMeta({ [CLAUDE_KEY]: { status: 'allowed', resetsAt: 123 } });
    expect(result?.status).toBe('allowed');
    expect(result?.resetsAt).toBe(123);
    expect(result?.rateLimitType).toBeUndefined();
    expect(result?.utilization).toBeUndefined();
  });

  it('tolerates snake_case field variants', () => {
    const result = parseUsageMeta({
      [CLAUDE_KEY]: { rate_limit_type: 'seven_day', resets_at: 456 },
    });
    expect(result?.rateLimitType).toBe('seven_day');
    expect(result?.resetsAt).toBe(456);
  });

  it('drops wrong-typed fields but keeps the valid ones', () => {
    const result = parseUsageMeta({
      [CLAUDE_KEY]: {
        status: 42,               // wrong type — dropped
        rateLimitType: 'five_hour',
        resetsAt: '1751700000',   // string, not number — dropped
        utilization: NaN,         // non-finite — dropped
      },
    });
    expect(result).toBeDefined();
    expect(result?.rateLimitType).toBe('five_hour');
    expect(result?.status).toBeUndefined();
    expect(result?.resetsAt).toBeUndefined();
    expect(result?.utilization).toBeUndefined();
  });

  it('returns undefined when every field is malformed', () => {
    expect(
      parseUsageMeta({ [CLAUDE_KEY]: { status: 42, resetsAt: 'soon', utilization: Infinity } }),
    ).toBeUndefined();
  });

  it('preserves the original payload as raw for the detail view', () => {
    const payload = { status: 'allowed', extraUnknownField: { nested: true } };
    const result = parseUsageMeta({ [CLAUDE_KEY]: payload });
    expect(result?.raw).toBe(payload);
  });

  it('returns undefined for non-object _meta', () => {
    expect(parseUsageMeta(undefined)).toBeUndefined();
    expect(parseUsageMeta(null)).toBeUndefined();
    expect(parseUsageMeta('string')).toBeUndefined();
    expect(parseUsageMeta(42)).toBeUndefined();
    expect(parseUsageMeta(true)).toBeUndefined();
    expect(parseUsageMeta([{ [CLAUDE_KEY]: { status: 'allowed' } }])).toBeUndefined();
  });

  it('returns undefined when _meta has only unknown keys', () => {
    expect(parseUsageMeta({ '_other/vendor': { status: 'allowed' } })).toBeUndefined();
    expect(parseUsageMeta({})).toBeUndefined();
  });

  it('returns undefined for garbage payloads under the known key (never throws)', () => {
    const garbage: unknown[] = [
      null,
      undefined,
      'not-an-object',
      12345,
      true,
      [],
      ['status', 'allowed'],
      { completely: 'unrelated', keys: ['here'] },
      { status: null, rateLimitType: {}, resetsAt: [], utilization: () => {} },
    ];
    for (const payload of garbage) {
      expect(() => parseUsageMeta({ [CLAUDE_KEY]: payload })).not.toThrow();
      expect(parseUsageMeta({ [CLAUDE_KEY]: payload })).toBeUndefined();
    }
  });

  it('never throws on deeply weird _meta values', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic[CLAUDE_KEY] = cyclic; // cyclic reference — parser must not recurse/serialize
    expect(() => parseUsageMeta(cyclic)).not.toThrow();

    // Object with a throwing getter on an UNKNOWN key must not be touched.
    const trap = Object.defineProperty({ [CLAUDE_KEY]: { status: 'allowed' } }, 'unrelated', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    expect(parseUsageMeta(trap)?.status).toBe('allowed');
  });
});
