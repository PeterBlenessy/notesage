import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type Freq = 'daily' | 'weekly' | 'hourly' | 'custom';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function buildCron(freq: Freq, hour: number, minute: number, weekdays: number[]): string {
  switch (freq) {
    case 'hourly':
      return `${minute} * * * *`;
    case 'weekly':
      return `${minute} ${hour} * * ${weekdays.length ? [...weekdays].sort().join(',') : '*'}`;
    case 'daily':
    default:
      return `${minute} ${hour} * * *`;
  }
}

/** Best-effort parse of a 5-field cron back into the picker; falls back to custom. */
function parseCron(cron: string): {
  freq: Freq;
  hour: number;
  minute: number;
  weekdays: number[];
  custom: string;
} {
  const fallback = { freq: 'custom' as Freq, hour: 8, minute: 0, weekdays: [] as number[], custom: cron };
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return fallback;
  const [mi, h, dom, mo, dow] = parts;
  const minute = Number(mi);
  const hour = Number(h);
  if (dom !== '*' || mo !== '*' || Number.isNaN(minute)) return fallback;

  if (h === '*' && dow === '*') return { freq: 'hourly', hour: 0, minute, weekdays: [], custom: cron };
  if (Number.isNaN(hour)) return fallback;
  if (dow === '*') return { freq: 'daily', hour, minute, weekdays: [], custom: cron };
  const weekdays = dow.split(',').map(Number).filter((n) => !Number.isNaN(n));
  if (weekdays.length) return { freq: 'weekly', hour, minute, weekdays, custom: cron };
  return fallback;
}

export function TriggerEditor({
  cron,
  catchUp,
  onCronChange,
  onCatchUpChange,
}: {
  cron: string;
  catchUp: boolean;
  onCronChange: (cron: string) => void;
  onCatchUpChange: (v: boolean) => void;
}) {
  const seed = useMemo(() => parseCron(cron), []); // seed once from the initial cron
  const [freq, setFreq] = useState<Freq>(seed.freq);
  const [hour, setHour] = useState(seed.hour);
  const [minute, setMinute] = useState(seed.minute);
  const [weekdays, setWeekdays] = useState<number[]>(seed.weekdays);
  const [custom, setCustom] = useState(seed.custom);

  const computed = freq === 'custom' ? custom : buildCron(freq, hour, minute, weekdays);
  useEffect(() => {
    onCronChange(computed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computed]);

  const toggleDay = (d: number) =>
    setWeekdays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-xs text-muted-foreground">Run</Label>
        <Select value={freq} onValueChange={(v) => setFreq(v as Freq)}>
          <SelectTrigger className="h-8 w-32 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="hourly">Hourly</SelectItem>
            <SelectItem value="custom">Custom cron</SelectItem>
          </SelectContent>
        </Select>

        {(freq === 'daily' || freq === 'weekly') && (
          <>
            <Label className="text-xs text-muted-foreground">at</Label>
            <Input
              type="time"
              aria-label="Time"
              value={`${pad(hour)}:${pad(minute)}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(':').map(Number);
                if (!Number.isNaN(h)) setHour(h);
                if (!Number.isNaN(m)) setMinute(m);
              }}
              className="h-8 w-28 text-sm"
            />
          </>
        )}

        {freq === 'hourly' && (
          <>
            <Label className="text-xs text-muted-foreground">at minute</Label>
            <Input
              type="number"
              min={0}
              max={59}
              value={minute}
              onChange={(e) => setMinute(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
              className="h-8 w-20 text-sm"
            />
          </>
        )}
      </div>

      {freq === 'weekly' && (
        <div className="flex flex-wrap gap-1">
          {WEEKDAYS.map((label, d) => (
            <Button
              key={d}
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={weekdays.includes(d)}
              onClick={() => toggleDay(d)}
              className={cn(
                'h-7 w-11 text-xs',
                weekdays.includes(d) &&
                  'border-[var(--color-accent-primary)] text-[var(--color-accent-primary)]',
              )}
            >
              {label}
            </Button>
          ))}
        </div>
      )}

      {freq === 'custom' && (
        <Input
          aria-label="Cron expression"
          value={custom}
          placeholder="0 8 * * *"
          onChange={(e) => setCustom(e.target.value)}
          className="h-8 font-mono text-sm"
        />
      )}

      <p className="text-xs text-muted-foreground">
        Cron: <code className="rounded bg-muted px-1 py-0.5">{computed || '—'}</code> · local time
      </p>

      <div className="flex items-center gap-2">
        <Switch id="trigger-catchup" checked={catchUp} onCheckedChange={onCatchUpChange} />
        <Label htmlFor="trigger-catchup" className="text-xs text-muted-foreground">
          Offer to catch up runs missed while Notesage was closed
        </Label>
      </div>
    </div>
  );
}
