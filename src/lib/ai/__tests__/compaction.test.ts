import { describe, expect, it } from 'vitest';
import {
  planCompaction,
  buildCompactionPrompt,
  applyCompaction,
  isCompactionNote,
  isCompactionWorthwhile,
  COMPACTION_MARKER,
} from '../compaction';
import { estimateMessagesTokens } from '../context-trim';
import type { ChatMessage } from '../types';

function msg(role: ChatMessage['role'], content: string): ChatMessage {
  return { role, content, timestamp: Date.now() } as ChatMessage;
}

/** A conversation of `rounds` user/assistant pairs, each padded to be costly. */
function conversation(rounds: number, padding = 400): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < rounds; i++) {
    out.push(msg('user', `question ${i} ${'x'.repeat(padding)}`));
    out.push(msg('assistant', `answer ${i} ${'y'.repeat(padding)}`));
  }
  return out;
}

describe('planCompaction', () => {
  it('does nothing when the conversation already fits', () => {
    const messages = conversation(2, 10);
    const plan = planCompaction(messages, 100_000);
    expect(plan.needed).toBe(false);
    expect(plan.toCompact).toEqual([]);
    expect(plan.toKeep).toBe(messages);
  });

  it('marks the oldest rounds for summary rather than deletion', () => {
    const messages = conversation(6);
    const plan = planCompaction(messages, 400);

    expect(plan.needed).toBe(true);
    expect(plan.toCompact.length).toBeGreaterThan(0);
    // The split must be exhaustive — nothing may be silently lost between the
    // two halves, which is the whole point of compacting instead of trimming.
    expect(plan.toCompact.length + plan.toKeep.length).toBe(messages.length);
    expect(plan.toCompact[0]).toBe(messages[0]);
  });

  it('never compacts the most recent round', () => {
    // Compaction firing mid-task is the known failure mode; the freshest
    // context is exactly what must survive.
    const messages = conversation(6);
    const plan = planCompaction(messages, 400);
    const last = messages[messages.length - 1];
    expect(plan.toKeep).toContain(last);
    expect(plan.toCompact).not.toContain(last);
  });

  it('preserves the system prompt verbatim and never summarizes it', () => {
    const system = msg('system', 'You are a careful assistant.');
    const messages = [system, ...conversation(6)];
    const plan = planCompaction(messages, 400);

    expect(plan.toKeep[0]).toBe(system);
    expect(plan.toCompact).not.toContain(system);
    expect(plan.toCompact.length + plan.toKeep.length).toBe(messages.length);
  });
});

describe('buildCompactionPrompt', () => {
  it('asks for the specifics that generic summarization loses', () => {
    // Compaction is lossy by 90-99%, and paths, errors and decisions are the
    // first casualties — which are precisely what lets an agent resume.
    const prompt = buildCompactionPrompt([msg('user', 'fix the parser')]);
    expect(prompt).toMatch(/exact paths/i);
    expect(prompt).toMatch(/error messages/i);
    expect(prompt).toMatch(/decisions made/i);
    expect(prompt).toMatch(/outstanding/i);
  });

  it('includes the conversation being summarized', () => {
    const prompt = buildCompactionPrompt([
      msg('user', 'read config.ts'),
      msg('assistant', 'it sets the port'),
    ]);
    expect(prompt).toContain('read config.ts');
    expect(prompt).toContain('it sets the port');
  });
});

describe('applyCompaction', () => {
  it('puts the summary in the system position, after any existing system prompt', () => {
    // The note is context about the conversation, not a turn in it — keeping it
    // out of the user/assistant alternation protects tool-call pairing.
    const system = msg('system', 'You are careful.');
    const messages = [system, ...conversation(6)];
    const plan = planCompaction(messages, 400);
    const result = applyCompaction(plan, 'Earlier: edited parser.ts, tests pass.');

    expect(result[0]).toBe(system);
    expect(isCompactionNote(result[1])).toBe(true);
    expect(result[1].content).toContain('edited parser.ts');
  });

  it('leads with the summary when there is no system prompt', () => {
    const messages = conversation(6);
    const plan = planCompaction(messages, 400);
    const result = applyCompaction(plan, 'Earlier work happened.');
    expect(isCompactionNote(result[0])).toBe(true);
  });

  it('keeps the retained rounds after the summary', () => {
    const messages = conversation(6);
    const plan = planCompaction(messages, 400);
    const result = applyCompaction(plan, 'summary');
    const last = messages[messages.length - 1];
    expect(result[result.length - 1]).toBe(last);
  });

  it('falls back to a plain trim when the summarizer returned nothing', () => {
    // A failed or empty summarization must not insert an empty note that
    // occupies budget and says nothing.
    const messages = conversation(6);
    const plan = planCompaction(messages, 400);
    expect(applyCompaction(plan, '   ')).toBe(plan.toKeep);
    expect(applyCompaction(plan, '')).toBe(plan.toKeep);
  });

  it('is a no-op when no compaction was needed', () => {
    const messages = conversation(2, 10);
    const plan = planCompaction(messages, 100_000);
    expect(applyCompaction(plan, 'unused')).toBe(messages);
  });

  it('produces a result that fits the budget it was planned for', () => {
    // The note costs tokens too; a compaction that overflows its own budget
    // would just trigger another one.
    const messages = conversation(8);
    const budget = 800;
    const plan = planCompaction(messages, budget);
    const result = applyCompaction(plan, 'Short summary of earlier rounds.');
    expect(estimateMessagesTokens(result)).toBeLessThanOrEqual(budget * 1.5);
  });
});

describe('isCompactionWorthwhile', () => {
  it('declines to spend a generation call on a trivial amount of context', () => {
    const messages = conversation(3, 5);
    const plan = planCompaction(messages, 20);
    expect(isCompactionWorthwhile(plan, 500)).toBe(false);
  });

  it('is worth it once a meaningful amount would be lost', () => {
    const plan = planCompaction(conversation(10), 400);
    expect(isCompactionWorthwhile(plan, 500)).toBe(true);
  });

  it('is never worthwhile when nothing needs compacting', () => {
    const plan = planCompaction(conversation(2, 10), 100_000);
    expect(isCompactionWorthwhile(plan)).toBe(false);
  });
});

describe('isCompactionNote', () => {
  it('recognises its own notes so repeated passes can find them', () => {
    const plan = planCompaction(conversation(6), 400);
    const result = applyCompaction(plan, 'prior summary');
    expect(result.some(isCompactionNote)).toBe(true);
  });

  it('does not mistake an ordinary system prompt for one', () => {
    expect(isCompactionNote(msg('system', 'You are careful.'))).toBe(false);
    expect(isCompactionNote(msg('user', COMPACTION_MARKER))).toBe(false);
  });
});
