import type { ChatMessage, Segment } from '@/lib/ai/types';

/**
 * Append text to the last text segment of a message, or create a new text segment.
 * Returns a new message object with updated segments.
 */
export function appendTextSegment(msg: ChatMessage, text: string): ChatMessage {
  const segments = [...(msg.segments || [])];
  const last = segments[segments.length - 1];
  if (last && last.type === 'text') {
    segments[segments.length - 1] = { ...last, content: last.content + text };
  } else {
    segments.push({ type: 'text', content: text, timestamp: Date.now() });
  }
  return { ...msg, segments };
}

/**
 * Push a new segment to the message's segments array.
 * Returns a new message object with updated segments.
 */
export function pushSegment(msg: ChatMessage, segment: Segment): ChatMessage {
  return { ...msg, segments: [...(msg.segments || []), segment] };
}

/**
 * Update a segment at the given index with a partial patch.
 * Returns the original message if the index is out of bounds or no segments exist.
 */
export function updateSegment(msg: ChatMessage, index: number, patch: Partial<Segment>): ChatMessage {
  if (!msg.segments) return msg;
  if (index < 0 || index >= msg.segments.length) return msg;
  const segments = msg.segments.map((s, i) =>
    i === index ? { ...s, ...patch } as Segment : s
  );
  return { ...msg, segments };
}

/**
 * Finalize all segments: collapse thinking segments and mark running tool_calls as done.
 * Returns the original message if no segments exist.
 */
export function finalizeSegments(msg: ChatMessage): ChatMessage {
  if (!msg.segments) return msg;
  const segments = msg.segments.map((s) => {
    if (s.type === 'thinking') return { ...s, collapsed: true };
    if (s.type === 'tool_call' && s.status === 'running') return { ...s, status: 'done' as const };
    return s;
  });
  return { ...msg, segments };
}

/**
 * Reset an assistant message for retry -- clears content, segments, error state.
 * Returns a new message with all streaming-related fields cleared.
 */
export function resetAssistantMessage(msg: ChatMessage): ChatMessage {
  return {
    ...msg,
    content: '',
    segments: [],
    isError: false,
    thinking: '',
    activities: [],
    toolCallActivities: [],
  };
}
