// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/component-harness';
import { ToolCallSegmentView } from '../segments/ToolCallSegmentView';
import type { ToolCallSegment } from '@/lib/ai/types';

const baseSegment = (overrides: Partial<ToolCallSegment> = {}): ToolCallSegment => ({
  type: 'tool_call',
  kind: 'edit',
  label: 'Editing App.tsx',
  status: 'done',
  timestamp: Date.now(),
  ...overrides,
});

describe('ToolCallSegmentView', () => {
  it('renders label and status for tool calls without content (regression)', () => {
    render(<ToolCallSegmentView segment={baseSegment()} />);
    expect(screen.getByText('Editing App.tsx')).toBeTruthy();
  });

  it('does not render a content region when content is absent', () => {
    const { container } = render(<ToolCallSegmentView segment={baseSegment()} />);
    // No diff summary or text content summary should appear
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('does not render a content region when content is empty array', () => {
    const { container } = render(
      <ToolCallSegmentView segment={baseSegment({ content: [] })} />,
    );
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('renders a DiffContentView for diff content items', () => {
    render(
      <ToolCallSegmentView
        segment={baseSegment({
          content: [
            { type: 'diff', path: '/src/App.tsx', oldText: 'a', newText: 'b' },
          ],
        })}
      />,
    );
    // Diff summary mentions the basename
    const buttons = screen.getAllByRole('button');
    const diffToggle = buttons.find((b) => b.textContent?.includes('App.tsx'));
    expect(diffToggle).toBeTruthy();
  });

  it('renders a TextContentView for text content items', () => {
    render(
      <ToolCallSegmentView
        segment={baseSegment({
          content: [{ type: 'text', text: 'output line\nanother line' }],
        })}
      />,
    );
    // Text summary shows "Output (2 lines)" for multi-line content
    expect(screen.getByText(/output \(2 lines\)/i)).toBeTruthy();
  });

  it('renders a placeholder for terminal content items', () => {
    render(
      <ToolCallSegmentView
        segment={baseSegment({
          content: [{ type: 'terminal', terminalId: 'term-1' }],
        })}
      />,
    );
    expect(screen.getByText(/terminal output \(not yet supported\)/i)).toBeTruthy();
  });

  it('renders multiple content items in order', () => {
    const { container } = render(
      <ToolCallSegmentView
        segment={baseSegment({
          content: [
            { type: 'diff', path: '/a.ts', oldText: 'x', newText: 'y' },
            { type: 'text', text: 'hello' },
          ],
        })}
      />,
    );
    // There should be at least two buttons: one for diff, one for text
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });
});
