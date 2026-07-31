import { describe, expect, it } from 'vitest';
import {
  describeStopReason,
  isEarlyStop,
  formatStopReasonNotice,
  isResumableStop,
  CONTINUE_REPLY,
  toTelemetryStopReason,
} from '../stop-reason';
import { parseQuickReplies } from '@/components/chat/QuickReplies';

// The bug these lock in: an ACP agent that abandons a long multi-file task
// (token budget exhausted, per-turn request cap hit) reported nothing at all,
// so it was indistinguishable from a turn that finished cleanly.

describe('describeStopReason', () => {
  it('says nothing when the agent actually finished', () => {
    expect(describeStopReason('end_turn')).toBeNull();
  });

  it('says nothing when the user cancelled — the UI already shows that', () => {
    expect(describeStopReason('cancelled')).toBeNull();
  });

  it('explains a token-budget stop and flags the work as incomplete', () => {
    const msg = describeStopReason('max_tokens');
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/ran out of tokens/i);
    expect(msg).toMatch(/incomplete/i);
  });

  it('explains a per-turn step-cap stop and flags the work as incomplete', () => {
    const msg = describeStopReason('max_turn_requests');
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/maximum number of steps/i);
    expect(msg).toMatch(/incomplete/i);
  });

  it('surfaces a refusal — the ACP spec requires reflecting it in the UI', () => {
    expect(describeStopReason('refusal')).toMatch(/declined/i);
  });

  it('still speaks up for an unrecognised reason rather than staying silent', () => {
    // A future ACP variant this build does not know about is still not a
    // completed turn. Silence here would reintroduce the original bug.
    const msg = describeStopReason('some_future_reason');
    expect(msg).not.toBeNull();
    expect(msg).toMatch(/some_future_reason/);
    expect(msg).toMatch(/may be incomplete/i);
  });

  it('treats the backend "unknown" sentinel as an early stop, not a completion', () => {
    expect(describeStopReason('unknown')).not.toBeNull();
  });

  // An ABSENT reason is not the same as an unrecognised one. A backend too old
  // to send it (or a test mock returning undefined) must not produce a bogus
  // "stopped for reason: undefined" notice on every single turn.
  it.each([undefined, null, ''])('stays silent when no reason was reported (%p)', (reason) => {
    expect(describeStopReason(reason)).toBeNull();
  });
});

describe('isEarlyStop', () => {
  it('is false only for a completed turn', () => {
    expect(isEarlyStop('end_turn')).toBe(false);
  });

  it.each(['max_tokens', 'max_turn_requests', 'refusal', 'cancelled', 'unknown'])(
    'is true for %s',
    (reason) => {
      expect(isEarlyStop(reason)).toBe(true);
    },
  );

  it.each([undefined, null, ''])('is false when nothing was reported (%p)', (reason) => {
    expect(isEarlyStop(reason)).toBe(false);
  });
});

describe('formatStopReasonNotice', () => {
  it('produces nothing to append for a clean finish', () => {
    expect(formatStopReasonNotice('end_turn')).toBeNull();
  });

  it('renders as a blockquote so it reads as meta-commentary, not model output', () => {
    const notice = formatStopReasonNotice('max_tokens');
    expect(notice).toMatch(/^\n\n> /);
  });

  it('separates itself from preceding assistant text', () => {
    // Appended to a message that may already end mid-sentence; without the
    // blank line the notice would fuse into the model's last paragraph.
    expect(formatStopReasonNotice('refusal')?.startsWith('\n\n')).toBe(true);
  });
});

describe('continuing a turn that ran out of room', () => {
  it.each(['max_tokens', 'max_turn_requests'])('offers to continue after %s', (reason) => {
    expect(isResumableStop(reason)).toBe(true);
    const notice = formatStopReasonNotice(reason);
    // The existing chip UI parses this tag out of message content.
    expect(notice).toContain('<quick-replies>');
    expect(notice).toContain(CONTINUE_REPLY);
  });

  it('does not offer to continue after a refusal — that is nagging, not resuming', () => {
    expect(isResumableStop('refusal')).toBe(false);
    expect(formatStopReasonNotice('refusal')).not.toContain('<quick-replies>');
  });

  it.each(['end_turn', 'cancelled'])('offers nothing at all for %s', (reason) => {
    expect(isResumableStop(reason)).toBe(false);
    expect(formatStopReasonNotice(reason)).toBeNull();
  });

  it('does not offer to continue for an unrecognised reason', () => {
    // We cannot know whether continuing is meaningful, so report but don't act.
    expect(isResumableStop('some_future_reason')).toBe(false);
    expect(formatStopReasonNotice('some_future_reason')).not.toContain('<quick-replies>');
  });

  it('puts the continuation on its own line so the chip parser sees one option', () => {
    const notice = formatStopReasonNotice('max_tokens')!;
    const inner = notice.match(/<quick-replies>\s*([\s\S]*?)\s*<\/quick-replies>/)?.[1];
    expect(inner?.split('\n').filter((l) => l.trim()).length).toBe(1);
  });

  // The notice is produced here but consumed by the chip parser in the chat UI.
  // Asserting the shape in isolation would pass even if the two disagreed, so
  // run the real parser over the real output.
  it('produces a block the actual chip parser turns into exactly one chip', () => {
    const assistantContent = `Here is what I did so far.${formatStopReasonNotice('max_tokens')}`;
    const parsed = parseQuickReplies(assistantContent);

    expect(parsed.replies).toEqual([CONTINUE_REPLY]);
    // And the raw tag must not survive into the rendered text.
    expect(parsed.strippedContent).not.toContain('quick-replies');
    expect(parsed.strippedContent).toContain('Here is what I did so far.');
    expect(parsed.strippedContent).toContain('ran out of tokens');
  });

  it('leaves no chip for a non-resumable stop when run through the real parser', () => {
    const parsed = parseQuickReplies(`Done.${formatStopReasonNotice('refusal')}`);
    expect(parsed.replies).toEqual([]);
  });
});

describe('toTelemetryStopReason', () => {
  it.each(['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'])(
    'passes the known reason %s through unchanged',
    (reason) => {
      expect(toTelemetryStopReason(reason)).toBe(reason);
    },
  );

  it('collapses anything unrecognised to "unknown"', () => {
    // A newer backend could emit a variant this build does not know. Reporting
    // it verbatim would put an unbounded value into the usage taxonomy, which
    // the PII contract forbids.
    expect(toTelemetryStopReason('some_future_reason')).toBe('unknown');
    expect(toTelemetryStopReason('unknown')).toBe('unknown');
  });

  it.each([undefined, null, ''])('collapses %p to "unknown" rather than omitting it', (reason) => {
    expect(toTelemetryStopReason(reason)).toBe('unknown');
  });

  it('only ever returns a member of the closed telemetry enum', () => {
    // The guarantee the taxonomy depends on: no input produces a novel value.
    const allowed = new Set([
      'end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled', 'unknown',
    ]);
    const inputs = [
      'end_turn', 'max_tokens', 'refusal', 'cancelled', 'unknown', 'max_turn_requests',
      'wildly_new', '', 'END_TURN', '../etc/passwd', '{"a":1}', undefined, null,
    ];
    for (const input of inputs) {
      expect(allowed.has(toTelemetryStopReason(input))).toBe(true);
    }
  });

  it('maps every reason the notice layer knows about', () => {
    // Drift lock: describeStopReason and the telemetry enum are separate
    // unions over the same protocol. If one gains a case the other must too,
    // or a real reason starts reporting as "unknown".
    for (const reason of ['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled']) {
      expect(toTelemetryStopReason(reason)).not.toBe('unknown');
    }
  });
});
