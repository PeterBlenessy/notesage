// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen } from '@/test/component-harness';
import userEvent from '@testing-library/user-event';
import { FindBar } from '@/components/editor/FindBar';

function defaultProps(overrides: Partial<Parameters<typeof FindBar>[0]> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    matchCount: 0,
    currentMatch: -1,
    onSearch: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    replaceEnabled: false,
    replaceExpanded: false,
    onReplaceExpandedChange: vi.fn(),
    ...overrides,
  };
}

describe('FindBar', () => {
  it('returns null when open is false', () => {
    const { container } = renderWithProviders(<FindBar {...defaultProps({ open: false })} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders search input when open', () => {
    renderWithProviders(<FindBar {...defaultProps()} />);
    expect(screen.getByPlaceholderText('Find...')).toBeTruthy();
  });

  it('shows "No results" when matchCount=0 and query is non-empty', () => {
    renderWithProviders(
      <FindBar {...defaultProps({ matchCount: 0, initialQuery: 'hello' })} />,
    );
    expect(screen.getByText('No results')).toBeTruthy();
  });

  it('shows match count in "X of Y" format', () => {
    renderWithProviders(
      <FindBar {...defaultProps({ matchCount: 5, currentMatch: 0 })} />,
    );
    expect(screen.getByText('1 of 5')).toBeTruthy();
  });

  it('calls onSearch when typing in the search input', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    renderWithProviders(<FindBar {...defaultProps({ onSearch })} />);

    const input = screen.getByPlaceholderText('Find...');
    await user.type(input, 'test');

    expect(onSearch).toHaveBeenCalledWith('t');
    expect(onSearch).toHaveBeenCalledWith('te');
    expect(onSearch).toHaveBeenCalledWith('tes');
    expect(onSearch).toHaveBeenCalledWith('test');
  });

  it('calls onNext on Enter key press', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    renderWithProviders(
      <FindBar {...defaultProps({ onNext, matchCount: 3, currentMatch: 0 })} />,
    );

    const input = screen.getByPlaceholderText('Find...');
    await user.click(input);
    await user.keyboard('{Enter}');

    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('calls onPrevious on Shift+Enter key press', async () => {
    const user = userEvent.setup();
    const onPrevious = vi.fn();
    renderWithProviders(
      <FindBar {...defaultProps({ onPrevious, matchCount: 3, currentMatch: 1 })} />,
    );

    const input = screen.getByPlaceholderText('Find...');
    await user.click(input);
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape key press', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<FindBar {...defaultProps({ onClose })} />);

    const input = screen.getByPlaceholderText('Find...');
    await user.click(input);
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  it('shows replace row when replaceEnabled and replaceExpanded are true', () => {
    renderWithProviders(
      <FindBar
        {...defaultProps({
          replaceEnabled: true,
          replaceExpanded: true,
          onReplace: vi.fn(),
          onReplaceAll: vi.fn(),
        })}
      />,
    );

    expect(screen.getByPlaceholderText('Replace...')).toBeTruthy();
  });

  it('calls onReplace when clicking replace button', async () => {
    const user = userEvent.setup();
    const onReplace = vi.fn();
    renderWithProviders(
      <FindBar
        {...defaultProps({
          replaceEnabled: true,
          replaceExpanded: true,
          matchCount: 3,
          currentMatch: 0,
          onReplace,
          onReplaceAll: vi.fn(),
        })}
      />,
    );

    const replaceButton = screen.getByTitle('Replace (Enter in replace field)');
    await user.click(replaceButton);

    expect(onReplace).toHaveBeenCalledWith('');
  });
});
