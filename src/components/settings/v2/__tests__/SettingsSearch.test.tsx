// @vitest-environment jsdom

import '@/test/tauri-mock';
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import {
  renderWithProviders,
  screen,
  fireEvent,
  act,
} from '@/test/component-harness';
import {
  SettingsSearch,
  SettingsSearchContext,
  useSettingsSearchQuery,
  matchesSettingsQuery,
  highlightSettingsQuery,
  useSettingsSearchShortcut,
} from '@/components/settings/v2/SettingsSearch';

function renderSearch(props: {
  value?: string;
  onChange?: (v: string) => void;
  matchCount?: number;
  totalCount?: number;
}) {
  const onChange = props.onChange ?? vi.fn();
  const result = renderWithProviders(
    <SettingsSearch
      value={props.value ?? ''}
      onChange={onChange}
      matchCount={props.matchCount}
      totalCount={props.totalCount}
    />,
  );
  return { ...result, onChange };
}

describe('SettingsSearch input', () => {
  it('renders input with placeholder "Search settings"', () => {
    renderSearch({});
    const input = screen.getByPlaceholderText('Search settings');
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).type).toBe('search');
  });

  it('calls onChange with the new value when typing', () => {
    const onChange = vi.fn();
    renderSearch({ value: '', onChange });
    const input = screen.getByPlaceholderText(
      'Search settings',
    ) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'app' } });
    });
    expect(onChange).toHaveBeenCalledWith('app');
  });

  it('shows no clear button when value is empty', () => {
    renderSearch({ value: '' });
    expect(screen.queryByLabelText('Clear search')).toBeNull();
  });

  it('shows a clear button when value is non-empty and clicking it resets via onChange', () => {
    const onChange = vi.fn();
    renderSearch({ value: 'hello', onChange });
    const clearBtn = screen.getByLabelText('Clear search');
    expect(clearBtn).toBeTruthy();
    act(() => {
      fireEvent.click(clearBtn);
    });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('does not render the sr-only match count when query is empty', () => {
    renderSearch({ value: '', matchCount: 3, totalCount: 10 });
    // The live region exists but is empty.
    expect(screen.queryByText(/matches/)).toBeNull();
  });

  it('renders sr-only "N of M matches" when value is non-empty and counts are provided', () => {
    renderSearch({ value: 'app', matchCount: 2, totalCount: 8 });
    expect(screen.getByText('2 of 8 matches')).toBeTruthy();
  });
});

describe('matchesSettingsQuery', () => {
  it('matches case-insensitively', () => {
    expect(matchesSettingsQuery('Appearance', 'app')).toBe(true);
    expect(matchesSettingsQuery('Appearance', 'APP')).toBe(true);
    expect(matchesSettingsQuery('APPEARANCE', 'app')).toBe(true);
  });

  it('returns true for empty query', () => {
    expect(matchesSettingsQuery('Appearance', '')).toBe(true);
    expect(matchesSettingsQuery('', '')).toBe(true);
    expect(matchesSettingsQuery(undefined, '')).toBe(true);
  });

  it('returns false when haystack is undefined and query is non-empty', () => {
    expect(matchesSettingsQuery(undefined, 'app')).toBe(false);
  });

  it('returns false when query does not appear in haystack', () => {
    expect(matchesSettingsQuery('Appearance', 'xyz')).toBe(false);
  });
});

describe('highlightSettingsQuery', () => {
  it('splits haystack into plain + matched segments preserving original casing', () => {
    expect(highlightSettingsQuery('Color mode', 'col')).toEqual([
      { text: 'Col', matched: true },
      { text: 'or mode', matched: false },
    ]);
  });

  it('handles multiple matches in order', () => {
    expect(highlightSettingsQuery('abcabc', 'b')).toEqual([
      { text: 'a', matched: false },
      { text: 'b', matched: true },
      { text: 'ca', matched: false },
      { text: 'b', matched: true },
      { text: 'c', matched: false },
    ]);
  });

  it('returns a single unmatched segment when query is empty', () => {
    expect(highlightSettingsQuery('Color mode', '')).toEqual([
      { text: 'Color mode', matched: false },
    ]);
  });

  it('returns a single unmatched segment when query does not match', () => {
    expect(highlightSettingsQuery('Color mode', 'xyz')).toEqual([
      { text: 'Color mode', matched: false },
    ]);
  });

  it('returns an empty array for empty haystack', () => {
    expect(highlightSettingsQuery('', 'anything')).toEqual([]);
  });
});

describe('useSettingsSearchQuery', () => {
  it('returns "" outside a provider', () => {
    let captured: string | null = null;
    function Probe() {
      captured = useSettingsSearchQuery();
      return null;
    }
    renderWithProviders(<Probe />);
    expect(captured).toBe('');
  });

  it('returns the provider value when wrapped', () => {
    let captured: string | null = null;
    function Probe() {
      captured = useSettingsSearchQuery();
      return null;
    }
    renderWithProviders(
      <SettingsSearchContext.Provider value={{ query: 'hello' }}>
        <Probe />
      </SettingsSearchContext.Provider>,
    );
    expect(captured).toBe('hello');
  });
});

describe('useSettingsSearchShortcut', () => {
  function ShortcutHost({ active = true }: { active?: boolean }) {
    const ref = React.useRef<HTMLInputElement | null>(null);
    useSettingsSearchShortcut(ref, active);
    return <input ref={ref} data-testid="target" type="search" />;
  }

  it('focuses the ref target on Cmd/Ctrl+F when active', () => {
    renderWithProviders(<ShortcutHost active />);
    const input = screen.getByTestId('target') as HTMLInputElement;
    // Make sure focus is elsewhere first.
    document.body.focus();
    expect(document.activeElement).not.toBe(input);

    // Send both metaKey and ctrlKey so the test is platform-agnostic
    // (jsdom's navigator.platform varies by CI runner).
    act(() => {
      fireEvent.keyDown(window, {
        key: 'f',
        metaKey: true,
        ctrlKey: true,
      });
    });
    expect(document.activeElement).toBe(input);
  });

  it('does nothing when the hook is inactive', () => {
    renderWithProviders(<ShortcutHost active={false} />);
    const input = screen.getByTestId('target') as HTMLInputElement;
    document.body.focus();
    act(() => {
      fireEvent.keyDown(window, {
        key: 'f',
        metaKey: true,
        ctrlKey: true,
      });
    });
    expect(document.activeElement).not.toBe(input);
  });
});
