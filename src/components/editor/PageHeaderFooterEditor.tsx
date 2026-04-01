/**
 * PageHeaderFooterEditor — inline editor for page header/footer zones.
 *
 * Rendered as a floating panel positioned over the clicked header/footer zone.
 * Provides three-column text inputs (left, center, right), each with its own
 * variable insertion dropdown. Includes a "Different first page" checkbox.
 */

import { useRef, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import {
  PAGE_VARIABLES,
  type PageHeaderFooter,
} from '@/lib/page-settings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PageHeaderFooterEditorProps {
  type: 'header' | 'footer';
  page: number;
  settings: PageHeaderFooter;
  pageNumberStart?: number;
  onUpdate: (updated: PageHeaderFooter) => void;
  onPageNumberStartChange?: (n: number) => void;
  onClose: () => void;
}

type ColumnKey = 'left' | 'center' | 'right';
type SlotKey = 'main' | 'first' | 'odd' | 'even';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PageHeaderFooterEditor({
  type,
  page,
  settings,
  pageNumberStart = 1,
  onUpdate,
  onPageNumberStartChange,
  onClose,
}: PageHeaderFooterEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Stop keyboard events from bubbling up to ProseMirror.
  // Escape closes the editor; all other keys stay within the inputs.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      e.stopPropagation();
    }
    // Bubble phase: lets children (inputs) handle the event first,
    // then stops it from reaching ProseMirror above.
    el.addEventListener('keydown', handleKey, false);
    el.addEventListener('keyup', handleKey, false);
    return () => {
      el.removeEventListener('keydown', handleKey, false);
      el.removeEventListener('keyup', handleKey, false);
    };
  }, [onClose]);

  // Stop mouse events from reaching ProseMirror while allowing React synthetic
  // events (used by Radix dropdowns) to work. We stop propagation on the ZONE
  // element (outside React's tree) rather than on our container, so the native
  // event still bubbles from our React children to the React root for delegation.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Find the zone element (our portal target) and stop events there.
    // The zone is the parent of our container in the DOM.
    const zone = el.parentElement;
    if (!zone) return;

    function stopAtZone(e: Event) {
      e.stopPropagation();
    }
    zone.addEventListener('mousedown', stopAtZone, false);
    zone.addEventListener('mouseup', stopAtZone, false);
    zone.addEventListener('pointerdown', stopAtZone, false);
    zone.addEventListener('pointerup', stopAtZone, false);

    // Close on click outside
    function handleOutsideClick(e: MouseEvent) {
      const target = e.target as Node;
      if (el && !el.contains(target)) {
        const radixPortal = (target as HTMLElement).closest?.('[data-radix-popper-content-wrapper]');
        if (radixPortal) return;
        onClose();
      }
    }
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleOutsideClick, true);
    }, 50);
    return () => {
      clearTimeout(timer);
      zone.removeEventListener('mousedown', stopAtZone, false);
      zone.removeEventListener('mouseup', stopAtZone, false);
      zone.removeEventListener('pointerdown', stopAtZone, false);
      zone.removeEventListener('pointerup', stopAtZone, false);
      window.removeEventListener('mousedown', handleOutsideClick, true);
    };
  }, [onClose]);

  // Focus first non-empty input on mount
  useEffect(() => {
    if (!containerRef.current) return;
    const inputs = containerRef.current.querySelectorAll<HTMLInputElement>('input[type="text"]');
    for (const input of inputs) {
      if (input.value) {
        input.focus();
        return;
      }
    }
    if (inputs.length > 0) inputs[0].focus();
  }, []);

  const emptyColumns = { left: '', center: '', right: '' };

  // Determine which data slot this page's inputs bind to
  const displayPage = page + (pageNumberStart - 1);
  const isFirstPage = displayPage === 1 && settings.differentFirstPage;
  const isOddPage = !isFirstPage && settings.differentOddEven && displayPage % 2 === 1;
  const isEvenPage = !isFirstPage && settings.differentOddEven && displayPage % 2 === 0;
  const activeSlot: SlotKey = isFirstPage ? 'first' : isOddPage ? 'odd' : isEvenPage ? 'even' : 'main';

  const currentValues = activeSlot === 'first' ? (settings.firstPage ?? emptyColumns)
    : activeSlot === 'odd' ? (settings.oddPage ?? emptyColumns)
    : activeSlot === 'even' ? (settings.evenPage ?? emptyColumns)
    : settings;

  const handleFieldChange = useCallback(
    (_row: SlotKey, col: ColumnKey, value: string) => {
      if (activeSlot === 'main') {
        onUpdate({ ...settings, [col]: value });
      } else if (activeSlot === 'first') {
        onUpdate({ ...settings, firstPage: { ...(settings.firstPage ?? emptyColumns), [col]: value } });
      } else if (activeSlot === 'odd') {
        onUpdate({ ...settings, oddPage: { ...(settings.oddPage ?? emptyColumns), [col]: value } });
      } else if (activeSlot === 'even') {
        onUpdate({ ...settings, evenPage: { ...(settings.evenPage ?? emptyColumns), [col]: value } });
      }
    },
    [settings, activeSlot, onUpdate],
  );

  const handleToggle = useCallback(
    (field: 'differentFirstPage' | 'differentOddEven', checked: boolean) => {
      const update = { ...settings, [field]: checked };
      const mainCols = { left: settings.left, center: settings.center, right: settings.right };
      if (field === 'differentFirstPage' && checked) {
        // Copy current main values so the user's work isn't lost
        update.firstPage = settings.firstPage ?? { ...mainCols };
      }
      if (field === 'differentOddEven' && checked) {
        update.oddPage = settings.oddPage ?? { ...mainCols };
        update.evenPage = settings.evenPage ?? { ...mainCols };
      }
      onUpdate(update);
    },
    [settings, onUpdate],
  );

  const label = type === 'header' ? 'Header' : 'Footer';

  return (
    <div
      ref={containerRef}
      className="page-hf-editor"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Section label + slot indicator */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
          {activeSlot !== 'main' && (
            <span className="ml-1.5 normal-case tracking-normal font-normal">
              ({activeSlot === 'first' ? 'first page' : activeSlot === 'odd' ? 'odd pages' : 'even pages'})
            </span>
          )}
        </span>
      </div>

      {/* Single input row — binds to the active slot for this page */}
      <ColumnInputRow
        row={activeSlot}
        left={currentValues.left}
        center={currentValues.center}
        right={currentValues.right}
        onChange={handleFieldChange}
      />

      {/* Toggles + page number start */}
      <div className="flex items-center gap-4 mt-1.5">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={settings.differentFirstPage}
            onChange={(e) => handleToggle('differentFirstPage', e.target.checked)}
            className="size-3 accent-current"
          />
          <span className="text-[10px] text-muted-foreground">Different first page</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={settings.differentOddEven}
            onChange={(e) => handleToggle('differentOddEven', e.target.checked)}
            className="size-3 accent-current"
          />
          <span className="text-[10px] text-muted-foreground">Different odd &amp; even</span>
        </label>
        {onPageNumberStartChange && (
          <div className="flex items-center gap-1 ml-auto">
            <label className="text-[10px] text-muted-foreground select-none">Page #</label>
            <input
              type="number"
              min={1}
              value={pageNumberStart}
              onChange={(e) => onPageNumberStartChange(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-10 h-5 text-[10px] text-center bg-transparent border border-border rounded px-1 text-foreground outline-none focus:border-muted-foreground"
            />
          </div>
        )}
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Input with per-field variable dropdown
// ---------------------------------------------------------------------------

interface ColumnInputProps {
  value: string;
  placeholder: string;
  align?: string;
  onChange: (value: string) => void;
}

function ColumnInput({ value, placeholder, align, onChange }: ColumnInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const insertVariable = (token: string) => {
    const input = inputRef.current;
    if (!input) {
      onChange(value + token);
      return;
    }
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? start;
    const newValue = value.slice(0, start) + token + value.slice(end);
    onChange(newValue);

    // Restore cursor after the inserted token
    requestAnimationFrame(() => {
      input.focus();
      const newPos = start + token.length;
      input.setSelectionRange(newPos, newPos);
    });
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`page-hf-input pr-6 ${align ?? ''}`}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-0.5 top-1/2 -translate-y-1/2 h-4 w-4 p-0 text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className="size-3" strokeWidth={1.5} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {PAGE_VARIABLES.map((v) => (
            <DropdownMenuItem
              key={v.token}
              onSelect={() => insertVariable(v.token)}
              className="flex items-center justify-between"
            >
              <span className="text-xs">{v.label}</span>
              <code className="text-[10px] text-muted-foreground ml-2">
                {v.token}
              </code>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Three-column input row
// ---------------------------------------------------------------------------

interface ColumnInputRowProps {
  row: SlotKey;
  left: string;
  center: string;
  right: string;
  onChange: (row: SlotKey, col: ColumnKey, value: string) => void;
}

function ColumnInputRow({ row, left, center, right, onChange }: ColumnInputRowProps) {
  return (
    <div className="grid grid-cols-3 gap-1">
      <ColumnInput
        value={left}
        placeholder="Left"
        onChange={(v) => onChange(row, 'left', v)}
      />
      <ColumnInput
        value={center}
        placeholder="Center"
        align="text-center"
        onChange={(v) => onChange(row, 'center', v)}
      />
      <ColumnInput
        value={right}
        placeholder="Right"
        align="text-right"
        onChange={(v) => onChange(row, 'right', v)}
      />
    </div>
  );
}
