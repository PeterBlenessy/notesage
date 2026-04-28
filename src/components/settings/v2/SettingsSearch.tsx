import * as React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Search primitive for the Mockup E settings shell. Renders a small search
 * input intended to live in the nav column's `navHeader` slot, plus a handful
 * of pure helpers and a context so downstream panels (migrated in #65/#66/#67)
 * can read the current query and hide non-matching rows.
 *
 * This task delivers the input + plumbing. The nav labels themselves can be
 * filtered by a consumer (see `SettingsDialogV2`); per-panel row filtering is
 * cooperative — panel components are expected to call `useSettingsSearchQuery`
 * and `matchesSettingsQuery`/`highlightSettingsQuery` to hide or highlight
 * rows. Keeping the contract narrow means this file can ship ahead of the
 * panel migrations without coupling to any specific panel shape.
 */

/**
 * Context lets children read the current query without threading props.
 * Defaults to an empty string, so components outside a provider behave as
 * if no search is active.
 */
export const SettingsSearchContext = React.createContext<{ query: string }>({
  query: '',
});

/**
 * Hook for descendants to read the current settings search query. Returns
 * `""` outside a provider.
 */
export function useSettingsSearchQuery(): string {
  return React.useContext(SettingsSearchContext).query;
}

/**
 * Case-insensitive substring match. An empty query always matches — callers
 * should use this as the "should I render this row?" predicate in filtered
 * modes. Undefined haystacks are treated as non-matching (unless the query
 * itself is empty, in which case everything matches).
 */
export function matchesSettingsQuery(
  haystack: string | undefined,
  query: string,
): boolean {
  if (!query) return true;
  if (haystack === undefined || haystack === null) return false;
  return haystack.toLowerCase().includes(query.toLowerCase());
}

/**
 * Splits `haystack` into an ordered list of plain + matched segments so the
 * caller can render `<mark>` or any other highlight style. Unlike a simple
 * `replace`, this preserves the original casing of `haystack` inside the
 * matched ranges. Returns a single unmatched segment when the query is empty
 * or has no matches.
 */
export function highlightSettingsQuery(
  haystack: string,
  query: string,
): Array<{ text: string; matched: boolean }> {
  if (!haystack) return [];
  if (!query) return [{ text: haystack, matched: false }];

  const lowerHay = haystack.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const segments: Array<{ text: string; matched: boolean }> = [];

  let cursor = 0;
  while (cursor < haystack.length) {
    const nextIdx = lowerHay.indexOf(lowerQuery, cursor);
    if (nextIdx === -1) {
      segments.push({ text: haystack.slice(cursor), matched: false });
      break;
    }
    if (nextIdx > cursor) {
      segments.push({ text: haystack.slice(cursor, nextIdx), matched: false });
    }
    const end = nextIdx + query.length;
    segments.push({ text: haystack.slice(nextIdx, end), matched: true });
    cursor = end;
  }

  // Edge case: empty query guard above means we always push at least one
  // segment, but if haystack is entirely matches the while loop still exits
  // cleanly via `break`. Nothing more to do.
  return segments;
}

export interface SettingsSearchProps {
  value: string;
  onChange: (value: string) => void;
  /** Match count announced to screen readers. */
  matchCount?: number;
  /** Total filterable items for the "N of M" readout. */
  totalCount?: number;
  /** Placeholder text. Defaults to "Search settings". */
  placeholder?: string;
  className?: string;
}

/**
 * Settings nav search input. Renders a compact search field sized to fit in
 * the 236 px nav column with a leading search icon and a trailing clear
 * button that appears when the input is non-empty. Accepts a ref that points
 * at the underlying `<input>` so the parent can focus it in response to ⌘F.
 *
 * The sr-only match readout is published via `aria-live="polite"` so screen
 * readers announce "N of M matches" as the user types, without moving focus.
 */
export const SettingsSearch = React.forwardRef<
  HTMLInputElement,
  SettingsSearchProps
>(function SettingsSearch(
  {
    value,
    onChange,
    matchCount,
    totalCount,
    placeholder = 'Search settings',
    className,
  },
  ref,
) {
  const showCount =
    value.length > 0 &&
    matchCount !== undefined &&
    totalCount !== undefined;

  return (
    <div className={cn('relative w-full', className)}>
      <Search
        aria-hidden="true"
        strokeWidth={1.5}
        className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={ref}
        type="search"
        role="searchbox"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn(
          'h-8 w-full rounded-md border border-border bg-background pl-7 pr-7',
          'text-[12px] placeholder:text-muted-foreground/60',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          // Strip the browser's default clear button — we render our own.
          '[&::-webkit-search-cancel-button]:appearance-none',
        )}
      />
      {value.length > 0 ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className={cn(
            'absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-5 w-5',
            'items-center justify-center rounded-sm text-muted-foreground',
            'transition-colors duration-150 hover:text-foreground hover:bg-muted',
            'outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          <X strokeWidth={1.5} className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <span className="sr-only" aria-live="polite" role="status">
        {showCount ? `${matchCount} of ${totalCount} matches` : ''}
      </span>
    </div>
  );
});

/**
 * Wires `⌘F` (macOS) / `Ctrl+F` (other platforms) to focus the supplied
 * input ref while `active` is true. Uses the capture phase and
 * `preventDefault` so the host app's global find bar doesn't also fire when
 * the settings dialog is open.
 *
 * This hook is dialog-scoped by design: callers pass `active={open}` so the
 * listener is torn down as soon as the dialog closes, ensuring we never
 * swallow the user's find shortcut in the editor.
 */
export function useSettingsSearchShortcut(
  inputRef: React.RefObject<HTMLInputElement | null>,
  active: boolean,
): void {
  React.useEffect(() => {
    if (!active) return;

    const handler = (event: KeyboardEvent) => {
      const isMac =
        typeof navigator !== 'undefined' &&
        /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
      const modifier = isMac ? event.metaKey : event.ctrlKey;
      if (!modifier) return;
      if (event.key !== 'f' && event.key !== 'F') return;

      // Let other inputs inside the dialog own their own find shortcut.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        target !== inputRef.current &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') &&
        target.getAttribute('type') !== 'search'
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      inputRef.current?.focus();
      inputRef.current?.select();
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [inputRef, active]);
}
