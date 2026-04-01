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
}: PageHeaderFooterEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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
      const target = e.target as Node;
      // Don't close if click is inside the editor or a Radix dropdown portal
      if (containerRef.current && !containerRef.current.contains(target)) {
        const radixPortal = (target as HTMLElement).closest?.('[data-radix-popper-content-wrapper]');
        if (radixPortal) return;
        onClose();
      }
    }
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

  const label = type === 'header' ? 'Header' : 'Footer';

  return (
    <div
      ref={containerRef}
      className="page-hf-editor"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Section label */}
      <div className="mb-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>

      {/* Main row */}
      <ColumnInputRow
        row="main"
        left={settings.left}
        center={settings.center}
        right={settings.right}
        onChange={handleFieldChange}
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
          />
        </div>
      )}
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
            tabIndex={-1}
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
  row: 'main' | 'first';
  left: string;
  center: string;
  right: string;
  onChange: (row: 'main' | 'first', col: ColumnKey, value: string) => void;
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
