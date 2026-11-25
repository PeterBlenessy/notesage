import { useId } from 'react';
import { Plus, Trash2, Lock } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import type { EnvRow } from './types';

interface KeyValueRowsProps {
  /** Visible heading of the group ("Environment Variables", "Headers"). */
  label: string;
  rows: EnvRow[];
  onChange: (rows: EnvRow[]) => void;
  keyPlaceholder: string;
  /** Accessible name of the key field of a row. */
  keyLabel: string;
  /** Accessible name of the value field of a row. */
  valueLabel: string;
  /** Optional line under the heading. */
  hint?: string;
}

/**
 * An editable list of name/value pairs where each value can be marked as a
 * secret (kept in the OS keychain; the config file gets a reference only).
 * Used for a local server's environment variables and a remote server's
 * headers, which are stored the same way.
 */
export function KeyValueRows({
  label,
  rows,
  onChange,
  keyPlaceholder,
  keyLabel,
  valueLabel,
  hint,
}: KeyValueRowsProps) {
  const labelId = useId();

  const update = (index: number, patch: Partial<EnvRow>) => {
    const next = [...rows];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  return (
    <div className="space-y-1.5" role="group" aria-labelledby={labelId}>
      <div className="flex items-center justify-between">
        <Label id={labelId} className="text-xs text-muted-foreground">{label}</Label>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={() => onChange([...rows, { key: '', value: '' }])}
        >
          <Plus className="h-3 w-3 mr-1" strokeWidth={1.5} />
          {t("mcpd.addRow")}
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {rows.map((pair, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={pair.key}
            onChange={(e) => update(i, { key: e.target.value })}
            placeholder={keyPlaceholder}
            aria-label={keyLabel}
            className="font-mono text-xs flex-1"
          />
          <span className="text-muted-foreground" aria-hidden="true">=</span>
          <Input
            type={pair.secret ? 'password' : 'text'}
            value={pair.value}
            onChange={(e) => update(i, { value: e.target.value, stored: false })}
            placeholder={pair.stored ? t("mcpd.storedSecretPlaceholder") : pair.secret ? t("mcpd.secretValue") : t("mcpd.valuePlaceholder")}
            aria-label={valueLabel}
            className="font-mono text-xs flex-1"
          />
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-6 w-6 p-0 shrink-0',
              pair.secret ? 'text-foreground' : 'text-muted-foreground'
            )}
            aria-label={pair.secret ? t("mcpd.storedInKeychain") : t("mcpd.storeInKeychain")}
            aria-pressed={!!pair.secret}
            title={pair.secret ? t("mcpd.secretStored") : t("mcpd.storeThis")}
            onClick={() => update(i, { secret: !pair.secret, stored: false })}
          >
            <Lock className="h-3 w-3" strokeWidth={1.5} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 shrink-0"
            aria-label={t("mcpd.removeRow")}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.5} />
          </Button>
        </div>
      ))}
    </div>
  );
}
