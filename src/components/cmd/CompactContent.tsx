import { cn } from '@/lib/utils';

const COMPACT_PLACEHOLDER = 'Press ⌘K to ask';

interface CompactContentProps {
  onActivate: () => void;
}

/**
 * Compact pill state of the FloatingCommandBar — a centred button near the
 * bottom of the viewport that hints at the ⌘K shortcut. Click or ⌘K expands.
 */
export function CompactContent({ onActivate }: CompactContentProps) {
  return (
    <button
      type="button"
      onClick={onActivate}
      className={cn(
        'flex h-full w-full items-center justify-center px-4',
        'text-left text-sm text-muted-foreground',
        'hover:text-foreground transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
      )}
    >
      <span>{COMPACT_PLACEHOLDER}</span>
    </button>
  );
}
