// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/component-harness';
import { ActionIconButton } from '../ActionIconButton';

describe('ActionIconButton', () => {
  it('renders a button labelled by its aria-label with the given child', () => {
    render(
      <ActionIconButton label="Copy message" onClick={() => {}} className="cls">
        <span>icon</span>
      </ActionIconButton>,
    );
    const button = screen.getByRole('button', { name: 'Copy message' });
    expect(button).toBeTruthy();
    expect(button.className).toBe('cls');
    expect(screen.getByText('icon')).toBeTruthy();
  });

  it('invokes onClick when clicked', () => {
    const onClick = vi.fn();
    render(
      <ActionIconButton label="Edit message" onClick={onClick} className="cls">
        <span>icon</span>
      </ActionIconButton>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
