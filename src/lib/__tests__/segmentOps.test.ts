import { describe, it, expect } from 'vitest';
import {
  appendTextSegment,
  pushSegment,
  updateSegment,
  finalizeSegments,
  resetAssistantMessage,
} from '../segmentOps';
import type { ChatMessage, Segment } from '@/lib/ai/types';

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    role: 'assistant',
    content: '',
    timestamp: 1000,
    ...overrides,
  };
}

describe('appendTextSegment', () => {
  it('creates a new text segment when no segments exist', () => {
    const msg = makeMsg();
    const result = appendTextSegment(msg, 'Hello');
    expect(result.segments).toHaveLength(1);
    expect(result.segments![0].type).toBe('text');
    expect((result.segments![0] as { content: string }).content).toBe('Hello');
  });

  it('appends to existing text segment', () => {
    const msg = makeMsg({
      segments: [{ type: 'text', content: 'Hello', timestamp: 1000 }],
    });
    const result = appendTextSegment(msg, ' world');
    expect(result.segments).toHaveLength(1);
    expect((result.segments![0] as { content: string }).content).toBe('Hello world');
  });

  it('creates new text segment when last segment is not text', () => {
    const msg = makeMsg({
      segments: [
        { type: 'thinking', content: 'reasoning...', collapsed: false, timestamp: 1000 },
      ],
    });
    const result = appendTextSegment(msg, 'Hello');
    expect(result.segments).toHaveLength(2);
    expect(result.segments![1].type).toBe('text');
    expect((result.segments![1] as { content: string }).content).toBe('Hello');
  });

  it('does not mutate original message', () => {
    const original: Segment[] = [{ type: 'text', content: 'original', timestamp: 1000 }];
    const msg = makeMsg({ segments: original });
    appendTextSegment(msg, ' added');
    expect(original[0].type === 'text' && (original[0] as { content: string }).content).toBe('original');
  });

  it('creates text segment from empty segments array', () => {
    const msg = makeMsg({ segments: [] });
    const result = appendTextSegment(msg, 'Hi');
    expect(result.segments).toHaveLength(1);
    expect((result.segments![0] as { content: string }).content).toBe('Hi');
  });
});

describe('pushSegment', () => {
  it('adds a segment to empty segments', () => {
    const msg = makeMsg();
    const seg: Segment = { type: 'thinking', content: 'hmm', collapsed: false, timestamp: 1000 };
    const result = pushSegment(msg, seg);
    expect(result.segments).toHaveLength(1);
    expect(result.segments![0]).toEqual(seg);
  });

  it('adds a segment to existing segments', () => {
    const msg = makeMsg({
      segments: [{ type: 'text', content: 'a', timestamp: 1000 }],
    });
    const seg: Segment = { type: 'tool_call', kind: 'read', label: 'Reading', status: 'running', timestamp: 1000 };
    const result = pushSegment(msg, seg);
    expect(result.segments).toHaveLength(2);
    expect(result.segments![1]).toEqual(seg);
  });

  it('does not mutate original', () => {
    const msg = makeMsg({ segments: [] });
    const seg: Segment = { type: 'text', content: 'x', timestamp: 1000 };
    pushSegment(msg, seg);
    expect(msg.segments).toHaveLength(0);
  });

  it('pushes an image segment', () => {
    const msg = makeMsg({
      segments: [{ type: 'text', content: 'Look:', timestamp: 1000 }],
    });
    const imgSeg: Segment = { type: 'image', data: 'abc', mimeType: 'image/png', timestamp: 1001 };
    const result = pushSegment(msg, imgSeg);
    expect(result.segments).toHaveLength(2);
    expect(result.segments![1].type).toBe('image');
    expect((result.segments![1] as { data: string }).data).toBe('abc');
  });
});

describe('updateSegment', () => {
  it('updates segment at given index', () => {
    const msg = makeMsg({
      segments: [
        { type: 'tool_call', kind: 'read', label: 'Reading', status: 'running', timestamp: 1000 },
      ],
    });
    const result = updateSegment(msg, 0, { status: 'done' });
    expect((result.segments![0] as { status: string }).status).toBe('done');
  });

  it('returns original message for out of bounds index', () => {
    const msg = makeMsg({
      segments: [{ type: 'text', content: 'a', timestamp: 1000 }],
    });
    expect(updateSegment(msg, 5, { content: 'b' })).toBe(msg);
    expect(updateSegment(msg, -1, { content: 'b' })).toBe(msg);
  });

  it('returns original message when no segments', () => {
    const msg = makeMsg();
    expect(updateSegment(msg, 0, { content: 'b' })).toBe(msg);
  });

  it('does not mutate original segments', () => {
    const original: Segment[] = [
      { type: 'tool_call', kind: 'read', label: 'Reading', status: 'running', timestamp: 1000 },
    ];
    const msg = makeMsg({ segments: original });
    updateSegment(msg, 0, { status: 'done' });
    expect((original[0] as { status: string }).status).toBe('running');
  });
});

describe('finalizeSegments', () => {
  it('collapses thinking segments', () => {
    const msg = makeMsg({
      segments: [
        { type: 'thinking', content: 'reasoning', collapsed: false, timestamp: 1000 },
      ],
    });
    const result = finalizeSegments(msg);
    expect((result.segments![0] as { collapsed: boolean }).collapsed).toBe(true);
  });

  it('marks running tool_calls as done', () => {
    const msg = makeMsg({
      segments: [
        { type: 'tool_call', kind: 'bash', label: 'Running', status: 'running', timestamp: 1000 },
        { type: 'tool_call', kind: 'read', label: 'Done', status: 'done', timestamp: 1000 },
        { type: 'tool_call', kind: 'write', label: 'Error', status: 'error', timestamp: 1000 },
      ],
    });
    const result = finalizeSegments(msg);
    expect((result.segments![0] as { status: string }).status).toBe('done');
    expect((result.segments![1] as { status: string }).status).toBe('done');
    expect((result.segments![2] as { status: string }).status).toBe('error');
  });

  it('returns original message when no segments', () => {
    const msg = makeMsg();
    expect(finalizeSegments(msg)).toBe(msg);
  });

  it('leaves text and tool_result segments unchanged', () => {
    const msg = makeMsg({
      segments: [
        { type: 'text', content: 'hello', timestamp: 1000 },
        { type: 'tool_result', collapsed: true, result: 'ok', timestamp: 1000 },
      ],
    });
    const result = finalizeSegments(msg);
    expect((result.segments![0] as { content: string }).content).toBe('hello');
    expect((result.segments![1] as { collapsed: boolean }).collapsed).toBe(true);
  });

  it('preserves image segments unchanged', () => {
    const msg = makeMsg({
      segments: [
        { type: 'image', data: 'abc123', mimeType: 'image/png', timestamp: 1000 },
        { type: 'tool_call', kind: 'bash', label: 'Run', status: 'running', timestamp: 1001 },
      ],
    });
    const result = finalizeSegments(msg);
    expect(result.segments![0].type).toBe('image');
    expect((result.segments![0] as { data: string }).data).toBe('abc123');
    expect((result.segments![1] as { status: string }).status).toBe('done');
  });
});

describe('resetAssistantMessage', () => {
  it('clears all streaming-related fields', () => {
    const msg = makeMsg({
      content: 'some response',
      segments: [{ type: 'text', content: 'hello', timestamp: 1000 }],
      isError: true,
      thinking: 'reasoning...',
      activities: [{ kind: 'tool-call', label: 'read', status: 'done', timestamp: 1000 }],
      toolCallActivities: [{ id: '1', name: 'read', arguments: {}, status: 'pending', startedAt: 1000 }],
    });
    const result = resetAssistantMessage(msg);
    expect(result.content).toBe('');
    expect(result.segments).toEqual([]);
    expect(result.isError).toBe(false);
    expect(result.thinking).toBe('');
    expect(result.activities).toEqual([]);
    expect(result.toolCallActivities).toEqual([]);
  });

  it('preserves non-streaming fields', () => {
    const msg = makeMsg({
      role: 'assistant',
      timestamp: 5000,
      id: 'msg-1',
      parentId: 'parent-1',
      content: 'old content',
    });
    const result = resetAssistantMessage(msg);
    expect(result.role).toBe('assistant');
    expect(result.timestamp).toBe(5000);
    expect(result.id).toBe('msg-1');
    expect(result.parentId).toBe('parent-1');
  });
});
