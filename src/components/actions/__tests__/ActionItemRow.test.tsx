// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/component-harness';
import { ActionItemRow } from '../ActionItemRow';
import type { ActionItem } from '@/stores/action-store';

const action = {
  id: 'a1',
  text: 'Write the report',
  source_type: 'task',
  status: 'open',
  file_path: '/proj/notes.md',
} as unknown as ActionItem;

describe('ActionItemRow keyboard access', () => {
  it('opens the action with Enter or Space on the row, but not from its checkbox', () => {
    const onClick = vi.fn();
    render(<ActionItemRow action={action} onClick={onClick} onToggle={vi.fn()} />);

    const row = screen.getByText('Write the report').closest('[role="button"]') as HTMLElement;
    expect(row.tabIndex).toBe(0);

    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(screen.getByRole('checkbox'), { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
