import { describe, it, expect, vi } from 'vitest';
import { emitWorkflowEvent, onWorkflowEvent, type WorkflowEvent } from '../event-bus';

describe('workflow event bus', () => {
  it('delivers events to subscribers and stops after unsubscribe', () => {
    const seen: WorkflowEvent[] = [];
    const off = onWorkflowEvent((e) => seen.push(e));

    emitWorkflowEvent({ event: 'document-saved', file: '/a.md' });
    expect(seen).toEqual([{ event: 'document-saved', file: '/a.md' }]);

    off();
    emitWorkflowEvent({ event: 'document-saved', file: '/b.md' });
    expect(seen).toHaveLength(1); // no delivery after unsubscribe
  });

  it('a throwing subscriber does not break the others', () => {
    const good = vi.fn();
    const offBad = onWorkflowEvent(() => {
      throw new Error('boom');
    });
    const offGood = onWorkflowEvent(good);

    expect(() => emitWorkflowEvent({ event: 'transcription-done' })).not.toThrow();
    expect(good).toHaveBeenCalledOnce();

    offBad();
    offGood();
  });
});
