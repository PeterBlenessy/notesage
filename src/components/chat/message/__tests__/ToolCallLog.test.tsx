// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@/test/component-harness';
import { ToolCallLog } from '../ToolCallLog';
import type { ToolCallActivity, ToolCallStatus } from '@/lib/ai/types';

const activity = (overrides: Partial<ToolCallActivity> = {}): ToolCallActivity => ({
  id: 'tc-1',
  name: 'read_file',
  arguments: {},
  status: 'complete' as ToolCallStatus,
  startedAt: 1000,
  ...overrides,
});

describe('ToolCallLog', () => {
  it('renders a pluralized call count in the collapsed header', () => {
    render(<ToolCallLog activities={[activity({ id: 'a' }), activity({ id: 'b' })]} isActive={false} />);
    expect(screen.getByText('2 tool calls')).toBeTruthy();
  });

  it('renders a singular call count for a single call', () => {
    render(<ToolCallLog activities={[activity()]} isActive={false} />);
    expect(screen.getByText('1 tool call')).toBeTruthy();
  });

  it('shows a running-tools header when active with a running call', () => {
    render(
      <ToolCallLog
        activities={[activity({ status: 'running' }), activity({ id: 'b', status: 'complete' })]}
        isActive={true}
      />,
    );
    expect(screen.getByText('Running tools (2)')).toBeTruthy();
  });

  it('does not show the running header when a pending call exists but chat is inactive', () => {
    render(<ToolCallLog activities={[activity({ status: 'pending' })]} isActive={false} />);
    // isActive false → treated as done, so it uses the count label, not "Running tools"
    expect(screen.getByText('1 tool call')).toBeTruthy();
    expect(screen.queryByText(/running tools/i)).toBeNull();
  });

  it('keeps activity items hidden until the header is expanded', () => {
    render(<ToolCallLog activities={[activity({ name: 'write_file' })]} isActive={false} />);
    expect(screen.queryByText('write_file')).toBeNull();
    fireEvent.click(screen.getByText('1 tool call'));
    expect(screen.getByText('write_file')).toBeTruthy();
  });

  it('renders an error message for a failed tool call', () => {
    render(
      <ToolCallLog
        activities={[activity({ status: 'error', error: 'ENOENT: file not found' })]}
        isActive={false}
      />,
    );
    fireEvent.click(screen.getByText('1 tool call'));
    expect(screen.getByText('ENOENT: file not found')).toBeTruthy();
  });

  it('renders a permission-denied message for a denied tool call', () => {
    render(
      <ToolCallLog activities={[activity({ status: 'denied' })]} isActive={false} />,
    );
    fireEvent.click(screen.getByText('1 tool call'));
    expect(screen.getByText('Permission denied')).toBeTruthy();
  });

  it('reveals the raw result when the per-item Result toggle is expanded', () => {
    render(
      <ToolCallLog
        activities={[activity({ status: 'complete', result: 'the tool output text' })]}
        isActive={false}
      />,
    );
    fireEvent.click(screen.getByText('1 tool call'));
    // Result body hidden until the "Result" toggle is clicked
    expect(screen.queryByText('the tool output text')).toBeNull();
    fireEvent.click(screen.getByText('Result'));
    expect(screen.getByText('the tool output text')).toBeTruthy();
  });

  it('does not render a Result toggle for a completed call without a result', () => {
    render(<ToolCallLog activities={[activity({ status: 'complete', result: undefined })]} isActive={false} />);
    fireEvent.click(screen.getByText('1 tool call'));
    expect(screen.queryByText('Result')).toBeNull();
  });
});
