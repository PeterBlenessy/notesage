import { describe, it, expect } from 'vitest';
import { friendlyAIError } from '@/lib/ai/errors';

// `friendlyAIError` runs inside the chat hooks' `catch` blocks, BEFORE they
// clear the loading flag. If it throws, the chat stays stuck loading and the
// real error is lost (audit 2026-11-22 §7) — so it must never throw, whatever
// shape the provider's error body has.
describe('friendlyAIError — non-string message fields', () => {
  it('extracts a string error.message', () => {
    const raw = 'OpenAI API error: {"error":{"message":"Your credit balance is too low"}}';
    expect(friendlyAIError(raw)).toContain('Your credit balance is too low');
  });

  it('unwraps a doubly-escaped JSON message', () => {
    const raw = 'Prompt failed: Internal error: {"message":"{\\"detail\\":\\"inner detail text\\"}"}';
    expect(friendlyAIError(raw)).toBe('inner detail text');
  });

  it.each([
    ['an object message', '{"error":{"message":{"code":42,"text":"nested"}}}'],
    ['a numeric message', '{"message":7}'],
    ['an array message', '{"message":["a","b"]}'],
    ['a boolean error.message', '{"error":{"message":true}}'],
  ])('does not throw on %s and falls back to the raw text', (_label, body) => {
    const raw = `Custom server error: ${body}`;
    let result = '';
    expect(() => { result = friendlyAIError(raw, 'My Server', 'conn-1'); }).not.toThrow();
    expect(typeof result).toBe('string');
    expect(result).toContain('Custom server error');
  });

  it('does not throw when the inner JSON carries non-string fields', () => {
    const raw = 'Prompt failed: {"message":"{\\"detail\\":{\\"a\\":1},\\"message\\":7}"}';
    let result = '';
    expect(() => { result = friendlyAIError(raw, 'Agent'); }).not.toThrow();
    // Falls back to the outer (string) message rather than an object.
    expect(result).toContain('{"detail":{"a":1},"message":7}');
  });
});
