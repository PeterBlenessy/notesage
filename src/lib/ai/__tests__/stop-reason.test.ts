import { describe, expect, it } from 'vitest';
import { describeStopReason, isEarlyStop, formatStopReasonNotice } from '../stop-reason';

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
