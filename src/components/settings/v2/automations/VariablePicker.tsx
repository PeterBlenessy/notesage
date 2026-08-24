import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
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
      <DropdownMenuContent align="end" className="max-h-64 w-60 overflow-auto">
        <div className="px-2 py-1 text-[0.7rem] text-muted-foreground">{t("automation.clickToInsert")}</div>
        {tokens.map((t) => (
          <DropdownMenuItem key={t.token} onSelect={() => onInsert(t.token)} className="gap-2 text-xs">
            <span className="inline-flex items-center rounded bg-[var(--color-accent-primary)]/15 px-1.5 py-0.5 font-medium text-[var(--color-accent-primary)]">
              {t.label}
            </span>
            <code className="ml-auto text-[0.65rem] text-muted-foreground">{t.token}</code>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
