import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface TokenOption {
  token: string;
  label: string;
}

/**
 * "Insert variable" dropdown — inserts a `{{ … }}` token. The token text is the
 * source of truth (a pill is just a rendering of the same string), so a value
 * typed by hand and one inserted here serialize identically (Research R6).
 */
export function VariablePicker({
  tokens,
  onInsert,
}: {
  tokens: TokenOption[];
  onInsert: (token: string) => void;
}) {
  if (tokens.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-muted-foreground"
        >
          Insert variable
          <ChevronDown className="size-3" strokeWidth={1.5} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-64 overflow-auto">
        {tokens.map((t) => (
          <DropdownMenuItem
            key={t.token}
            onSelect={() => onInsert(t.token)}
            className="gap-2 text-xs"
          >
            <code className="rounded bg-muted px-1 py-0.5">{t.token}</code>
            <span className="text-muted-foreground">{t.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
