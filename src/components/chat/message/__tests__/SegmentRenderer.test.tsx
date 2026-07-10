// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { renderWithProviders, screen } from '@/test/component-harness';
import { SegmentRenderer } from '../SegmentRenderer';
import type {
  Segment,
  TextSegment,
  ThinkingSegment,
  ToolCallSegment,
  ToolResultSegment,
  ImageSegment,
  PlanSegment,
} from '@/lib/ai/types';

const textSegment = (overrides: Partial<TextSegment> = {}): TextSegment => ({
  type: 'text',
  content: 'Hello world',
  timestamp: 1000,
  ...overrides,
});

const thinkingSegment = (overrides: Partial<ThinkingSegment> = {}): ThinkingSegment => ({
  type: 'thinking',
  content: 'Let me reason about this',
  collapsed: false,
  timestamp: 1000,
  ...overrides,
});

const toolCallSegment = (overrides: Partial<ToolCallSegment> = {}): ToolCallSegment => ({
  type: 'tool_call',
  kind: 'read',
  label: 'Reading config.ts',
  status: 'done',
  timestamp: 1000,
  ...overrides,
});

const toolResultSegment = (overrides: Partial<ToolResultSegment> = {}): ToolResultSegment => ({
  type: 'tool_result',
  result: 'first line\nsecond line',
  collapsed: true,
  timestamp: 1000,
  ...overrides,
});

const imageSegment = (overrides: Partial<ImageSegment> = {}): ImageSegment => ({
  type: 'image',
  data: 'aGVsbG8=',
  mimeType: 'image/png',
  alt: 'A rendered chart',
  timestamp: 1000,
  ...overrides,
});

const planSegment = (overrides: Partial<PlanSegment> = {}): PlanSegment => ({
  type: 'plan',
  entries: [
    { content: 'Investigate the bug', priority: 'high', status: 'in_progress' },
  ],
  timestamp: 1000,
  ...overrides,
});

function renderSegments(segments: Segment[], isActivelyStreaming = false) {
  return renderWithProviders(
    <SegmentRenderer segments={segments} isActivelyStreaming={isActivelyStreaming} />,
  );
}

describe('SegmentRenderer', () => {
  it('renders a text segment as markdown text', () => {
    renderSegments([textSegment({ content: 'The quick brown fox' })]);
    expect(screen.getByText('The quick brown fox')).toBeTruthy();
  });

  it('renders a thinking segment as a collapsible with reasoning content', () => {
    renderSegments([thinkingSegment({ content: 'considering options' })]);
    // Not-collapsed + non-streaming with no next segment → label is "Thinking"
    expect(screen.getByText('Thinking')).toBeTruthy();
    // Content is visible because segment.collapsed is false
    expect(screen.getByText('considering options')).toBeTruthy();
  });

  it('computes a thinking duration label from the next segment timestamp', () => {
    renderSegments([
      thinkingSegment({ timestamp: 1000 }),
      textSegment({ timestamp: 4000, content: 'done thinking' }),
    ]);
    // (4000 - 1000) / 1000 = 3s
    expect(screen.getByText('Thought for 3s')).toBeTruthy();
    expect(screen.getByText('done thinking')).toBeTruthy();
  });

  it('renders a single tool_call segment inline with its label', () => {
    renderSegments([toolCallSegment({ label: 'Reading main.rs' })]);
    expect(screen.getByText('Reading main.rs')).toBeTruthy();
  });

  it('renders a tool_result segment (attached to its call) as a collapsible output summary', () => {
    // A tool_result only renders when it follows a tool_call in the same run.
    renderSegments([
      toolCallSegment({ label: 'Reading data.json', timestamp: 1000 }),
      toolResultSegment({ result: 'line one\nline two', timestamp: 1001 }),
    ]);
    expect(screen.getByText('Reading data.json')).toBeTruthy();
    // Multi-line result → "Output (2 lines)" summary
    expect(screen.getByText(/output \(2 lines\)/i)).toBeTruthy();
  });

  it('renders an image segment as an img element', () => {
    renderSegments([imageSegment({ mimeType: 'image/png', data: 'aGVsbG8=', alt: 'chart' })]);
    const img = screen.getByAltText('chart') as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('data:image/png;base64,aGVsbG8=');
  });

  it('renders a plan segment with its step count', () => {
    renderSegments([
      planSegment({
        entries: [
          { content: 'Step A', priority: 'high', status: 'pending' },
          { content: 'Step B', priority: 'low', status: 'completed' },
        ],
      }),
    ]);
    expect(screen.getByText('Plan')).toBeTruthy();
    expect(screen.getByText('2 steps')).toBeTruthy();
  });

  it('forces a running tool_call to a done state when not actively streaming', () => {
    // A running tool call with no streaming should still render its label (safety net).
    renderSegments([toolCallSegment({ label: 'Editing file.ts', status: 'running' })], false);
    expect(screen.getByText('Editing file.ts')).toBeTruthy();
  });

  it('groups consecutive same-verb tool calls into a collapsible verb group', () => {
    renderSegments([
      toolCallSegment({ label: 'Reading a.ts', timestamp: 1000 }),
      toolCallSegment({ label: 'Reading b.ts', timestamp: 1001 }),
    ]);
    // Two calls with the same verb → grouped under the verb header "Reading"
    expect(screen.getByText('Reading')).toBeTruthy();
    // The group header shows the call count (2)
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('renders nothing for an empty segments array', () => {
    const { container } = renderSegments([]);
    // Outer flex container is present but has no child segment views
    const outer = container.firstElementChild as HTMLElement;
    expect(outer).toBeTruthy();
    expect(outer.childElementCount).toBe(0);
  });

  it('renders an interleaved stream in chronological order', () => {
    renderSegments([
      textSegment({ content: 'intro paragraph', timestamp: 1000 }),
      toolCallSegment({ label: 'Reading notes.md', timestamp: 2000 }),
      textSegment({ content: 'conclusion paragraph', timestamp: 3000 }),
    ]);
    expect(screen.getByText('intro paragraph')).toBeTruthy();
    expect(screen.getByText('Reading notes.md')).toBeTruthy();
    expect(screen.getByText('conclusion paragraph')).toBeTruthy();
    // Order preserved: intro before conclusion in the DOM
    const introEl = screen.getByText('intro paragraph');
    const conclusionEl = screen.getByText('conclusion paragraph');
    expect(
      introEl.compareDocumentPosition(conclusionEl) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
