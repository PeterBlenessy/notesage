import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  trimMessagesToBudget,
  localBundledTrimBudget,
} from '@/lib/ai/context-trim';
import type { ChatMessage } from '@/lib/ai/types';

// Helpers — keep tests readable.
const msg = (role: ChatMessage['role'], content: string, extras: Partial<ChatMessage> = {}): ChatMessage => ({
  role,
  content,
  ...extras,
});
const userMsg = (s: string, extras: Partial<ChatMessage> = {}) => msg('user', s, extras);
const assistantMsg = (s: string, extras: Partial<ChatMessage> = {}) => msg('assistant', s, extras);
const systemMsg = (s: string) => msg('system', s);
const toolMsg = (s: string, callId: string) => msg('tool', s, { toolCallId: callId });

describe('estimateTokens', () => {
  it('uses chars/4 with ceiling', () => {
    // 17 chars / 4 = 4.25 → ceil to 5
    expect(estimateTokens('hello world hello')).toBe(5);
  });

  it('handles empty / null / undefined as 0', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });
});

describe('estimateMessageTokens', () => {
  it('counts content + per-message overhead', () => {
    // 4 chars / 4 = 1 token, + 4 overhead = 5
    expect(estimateMessageTokens(userMsg('test'))).toBe(5);
  });

  it('adds the tool_calls payload size', () => {
    const m = assistantMsg('', {
      toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: '/tmp/foo.txt' } }],
    });
    // Without tool_calls the message is just the 4-token overhead. With them,
    // the JSON-serialized args plus the name contribute extra tokens.
    expect(estimateMessageTokens(m)).toBeGreaterThan(estimateMessageTokens(assistantMsg('')));
  });

  it('budgets per-image even when the base64 string is huge', () => {
    const giantBase64 = 'x'.repeat(2_000_000); // ~2MB string
    const m = userMsg('describe this', {
      attachments: [
        {
          id: 'a1',
          data: giantBase64,
          mimeType: 'image/png',
          width: 1024,
          height: 1024,
          size: giantBase64.length,
        },
      ],
    });
    // The per-image budget caps the image cost at 2000 tokens regardless of
    // base64 size. Without this, a single 2MB image would estimate at 500k+
    // tokens (chars/4) and trigger trimming for no reason.
    const tokens = estimateMessageTokens(m);
    expect(tokens).toBeLessThan(2500);
    expect(tokens).toBeGreaterThanOrEqual(2000);
  });
});

describe('trimMessagesToBudget', () => {
  it('returns the original list when already within budget', () => {
    const messages = [systemMsg('sys'), userMsg('hi'), assistantMsg('hello')];
    const result = trimMessagesToBudget(messages, 1000);
    expect(result.dropped).toBe(0);
    expect(result.messages).toBe(messages);
  });

  it('drops oldest complete rounds when over budget', () => {
    // Two complete rounds. Budget is tight enough that only the second can fit.
    const big = 'x'.repeat(400); // ~100 tokens per message
    const messages = [
      systemMsg('sys'),
      userMsg(`round1 user ${big}`),
      assistantMsg(`round1 assistant ${big}`),
      userMsg(`round2 user ${big}`),
      assistantMsg(`round2 assistant ${big}`),
    ];
    const budget = estimateMessagesTokens([
      systemMsg('sys'),
      userMsg(`round2 user ${big}`),
      assistantMsg(`round2 assistant ${big}`),
    ]) + 5; // small slack

    const result = trimMessagesToBudget(messages, budget);

    expect(result.dropped).toBe(2);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[1].content).toContain('round2 user');
    expect(result.messages[2].content).toContain('round2 assistant');
  });

  it('keeps the leading system message after trimming', () => {
    // Regression: the system message holds the project root, tools, and ReAct
    // guidance — dropping it would gut the local-model context.
    const big = 'x'.repeat(400);
    const messages = [
      systemMsg('CRITICAL_SYSTEM_PROMPT'),
      userMsg(`old ${big}`),
      assistantMsg(`old reply ${big}`),
      userMsg(`new ${big}`),
    ];
    const budget = estimateMessagesTokens([systemMsg('CRITICAL_SYSTEM_PROMPT'), userMsg(`new ${big}`)]) + 5;

    const result = trimMessagesToBudget(messages, budget);

    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toBe('CRITICAL_SYSTEM_PROMPT');
  });

  it('preserves tool_call/tool_result pairing when dropping a round', () => {
    // Each round drops AS A UNIT — never split a tool_calls assistant from
    // its matching tool result messages, or the API rejects the payload.
    const big = 'x'.repeat(400);
    const messages = [
      systemMsg('sys'),
      userMsg(`round1 ${big}`),
      assistantMsg('', {
        toolCalls: [{ id: 'c1', name: 'read_file', arguments: { path: '/a' } }],
      }),
      toolMsg(`tool result 1 ${big}`, 'c1'),
      assistantMsg(`round1 final ${big}`),
      userMsg(`round2 ${big}`),
      assistantMsg(`round2 reply ${big}`),
    ];
    const budget = estimateMessagesTokens([
      systemMsg('sys'),
      userMsg(`round2 ${big}`),
      assistantMsg(`round2 reply ${big}`),
    ]) + 5;

    const result = trimMessagesToBudget(messages, budget);

    // Either all four round-1 messages stayed, or all four were dropped.
    const hasC1Call = result.messages.some(
      (m) => m.role === 'assistant' && m.toolCalls?.some((tc) => tc.id === 'c1')
    );
    const hasC1Result = result.messages.some((m) => m.role === 'tool' && m.toolCallId === 'c1');
    expect(hasC1Call).toBe(hasC1Result);
  });

  it('keeps the final round even when it alone exceeds the budget', () => {
    // Refusing to drop the user's most recent prompt — let the API reject it
    // with a clear "context too large" instead of silently dropping the
    // prompt and producing a nonsense reply.
    const huge = 'x'.repeat(40_000); // way over any reasonable budget
    const messages = [systemMsg('sys'), userMsg('old'), userMsg(huge)];

    const result = trimMessagesToBudget(messages, 100);

    expect(result.messages.some((m) => m.content === huge)).toBe(true);
    expect(result.messages[0].role).toBe('system');
  });

  it('works without a system message', () => {
    const big = 'x'.repeat(400);
    const messages = [userMsg(`old ${big}`), assistantMsg(`reply ${big}`), userMsg(`new ${big}`)];
    const budget = estimateMessagesTokens([userMsg(`new ${big}`)]) + 5;

    const result = trimMessagesToBudget(messages, budget);

    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content).toContain('new');
    expect(result.dropped).toBeGreaterThan(0);
  });

  it('drops multiple rounds in one pass to fit a very tight budget', () => {
    const big = 'x'.repeat(400);
    const messages = [
      systemMsg('sys'),
      userMsg(`r1 ${big}`),
      assistantMsg(`r1a ${big}`),
      userMsg(`r2 ${big}`),
      assistantMsg(`r2a ${big}`),
      userMsg(`r3 ${big}`),
      assistantMsg(`r3a ${big}`),
      userMsg(`r4 ${big}`),
    ];
    const budget = estimateMessagesTokens([systemMsg('sys'), userMsg(`r4 ${big}`)]) + 5;

    const result = trimMessagesToBudget(messages, budget);

    expect(result.messages.find((m) => m.content?.includes('r1'))).toBeUndefined();
    expect(result.messages.find((m) => m.content?.includes('r2'))).toBeUndefined();
    expect(result.messages.find((m) => m.content?.includes('r3'))).toBeUndefined();
    expect(result.messages.find((m) => m.content?.includes('r4'))).toBeDefined();
  });

  it('reports estimated tokens after trimming, not before', () => {
    const big = 'x'.repeat(400);
    const messages = [
      systemMsg('sys'),
      userMsg(`r1 ${big}`),
      assistantMsg(`r1a ${big}`),
      userMsg(`r2 ${big}`),
    ];
    const budget = estimateMessagesTokens([systemMsg('sys'), userMsg(`r2 ${big}`)]) + 5;

    const result = trimMessagesToBudget(messages, budget);

    expect(result.estimatedTokens).toBeLessThanOrEqual(budget);
    expect(result.estimatedTokens).toBeLessThan(estimateMessagesTokens(messages));
  });

  it('handles empty input', () => {
    const result = trimMessagesToBudget([], 1000);
    expect(result.messages).toEqual([]);
    expect(result.dropped).toBe(0);
    expect(result.estimatedTokens).toBe(0);
  });
});

describe('localBundledTrimBudget', () => {
  it('reserves 25% of the context length for the response', () => {
    // 4096 × 0.75 = 3072
    expect(localBundledTrimBudget(4096)).toBe(3072);
    // 32768 × 0.75 = 24576
    expect(localBundledTrimBudget(32768)).toBe(24576);
  });
});
