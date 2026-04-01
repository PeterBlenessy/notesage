/**
 * PageHeaderFooterEditor — inline editor for page header/footer zones.
 *
 * Rendered as a floating panel positioned over the clicked header/footer zone
 * within the page break gap. Provides three-column text inputs for left, center,
 * and right content, a "Different first page" checkbox, and a variable insertion
 * dropdown ({page}, {pages}, {title}, {date}).
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  settings: PageHeaderFooter;
  onUpdate: (updated: PageHeaderFooter) => void;
  onClose: () => void;
  /** Bounding rect of the clicked zone element, used for positioning. */
  anchorRect?: DOMRect;
}

type ColumnKey = 'left' | 'center' | 'right';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PageHeaderFooterEditor({
  type,
  settings,
  onUpdate,
  onClose,
  anchorRect,
}: PageHeaderFooterEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeInputRef = useRef<HTMLInputElement | null>(null);
  const [activeField, setActiveField] = useState<{ row: 'main' | 'first'; col: ColumnKey } | null>(null);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Delay attaching so the opening click doesn't immediately close
    const timer = setTimeout(() => {
      window.addEventListener('mousedown', handleClick, true);
    }, 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousedown', handleClick, true);
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
    // All empty: focus left input
    if (inputs.length > 0) inputs[0].focus();
  }, []);

  const handleFieldChange = useCallback(
    (row: 'main' | 'first', col: ColumnKey, value: string) => {
      if (row === 'main') {
        onUpdate({ ...settings, [col]: value });
      } else {
        onUpdate({
          ...settings,
          firstPage: {
            left: settings.firstPage?.left ?? '',
            center: settings.firstPage?.center ?? '',
            right: settings.firstPage?.right ?? '',
            [col]: value,
          },
        });
      }
    },
    [settings, onUpdate],
  );

  const handleDifferentFirstPage = useCallback(
    (checked: boolean) => {
      onUpdate({
        ...settings,
        differentFirstPage: checked,
        firstPage: checked
          ? (settings.firstPage ?? { left: '', center: '', right: '' })
          : settings.firstPage,
      });
    },
    [settings, onUpdate],
  );

  const insertVariable = useCallback(
    (token: string) => {
      const input = activeInputRef.current;
      if (!input || !activeField) return;

      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      const newValue = input.value.slice(0, start) + token + input.value.slice(end);

      handleFieldChange(activeField.row, activeField.col, newValue);

      // Restore cursor position after the inserted token
      requestAnimationFrame(() => {
        input.focus();
        const newPos = start + token.length;
        input.setSelectionRange(newPos, newPos);
      });
    },
    [activeField, handleFieldChange],
  );

  const handleInputFocus = useCallback(
    (row: 'main' | 'first', col: ColumnKey, el: HTMLInputElement) => {
      activeInputRef.current = el;
      setActiveField({ row, col });
    },
    [],
  );

  const label = type === 'header' ? 'Header' : 'Footer';

  // Compute position: center over anchor, clamped to viewport
  const positionStyle: React.CSSProperties = anchorRect
    ? {
        position: 'fixed',
        left: anchorRect.left,
        top: anchorRect.top,
        width: anchorRect.width,
        zIndex: 50,
      }
    : {};

  return (
    <div
      ref={containerRef}
      className="page-hf-editor"
      style={positionStyle}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Section label */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              Insert variable
              <ChevronDown className="ml-0.5 size-3" strokeWidth={1.5} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
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

      {/* Main row: three column inputs */}
      <ColumnInputRow
        row="main"
        left={settings.left}
        center={settings.center}
        right={settings.right}
        onChange={handleFieldChange}
        onInputFocus={handleInputFocus}
      />

      {/* Different first page toggle */}
      <div className="flex items-center gap-1.5 mt-1.5">
        <Checkbox
          id={`hf-diff-first-${type}`}
          checked={settings.differentFirstPage}
          onCheckedChange={(checked) => handleDifferentFirstPage(checked === true)}
          className="size-3"
        />
        <label
          htmlFor={`hf-diff-first-${type}`}
          className="text-[10px] text-muted-foreground cursor-pointer select-none"
        >
          Different first page
        </label>
      </div>

      {/* First page row */}
      {settings.differentFirstPage && (
        <div className="mt-1.5">
          <span className="text-[10px] text-muted-foreground mb-1 block">
            First page
          </span>
          <ColumnInputRow
            row="first"
            left={settings.firstPage?.left ?? ''}
            center={settings.firstPage?.center ?? ''}
            right={settings.firstPage?.right ?? ''}
            onChange={handleFieldChange}
            onInputFocus={handleInputFocus}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Three-column input row
// ---------------------------------------------------------------------------

interface ColumnInputRowProps {
  row: 'main' | 'first';
  left: string;
  center: string;
  right: string;
  onChange: (row: 'main' | 'first', col: ColumnKey, value: string) => void;
  onInputFocus: (row: 'main' | 'first', col: ColumnKey, el: HTMLInputElement) => void;
}

function ColumnInputRow({ row, left, center, right, onChange, onInputFocus }: ColumnInputRowProps) {
  return (
    <div className="grid grid-cols-3 gap-1">
      <Input
        type="text"
        value={left}
        placeholder="Left"
        onChange={(e) => onChange(row, 'left', e.target.value)}
        onFocus={(e) => onInputFocus(row, 'left', e.target as HTMLInputElement)}
        className="page-hf-input"
      />
      <Input
        type="text"
        value={center}
        placeholder="Center"
        onChange={(e) => onChange(row, 'center', e.target.value)}
        onFocus={(e) => onInputFocus(row, 'center', e.target as HTMLInputElement)}
        className="page-hf-input text-center"
      />
      <Input
        type="text"
        value={right}
        placeholder="Right"
        onChange={(e) => onChange(row, 'right', e.target.value)}
        onFocus={(e) => onInputFocus(row, 'right', e.target as HTMLInputElement)}
        className="page-hf-input text-right"
      />
    </div>
  );
}
