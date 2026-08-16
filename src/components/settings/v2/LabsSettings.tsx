import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { flagEntries, type FlagSpec, type FlagId } from '@/lib/flags';
import { useFlagStore } from '@/stores/flag-store';
import { SettingsGroup } from './SettingsGroup';
import { SettingsHint } from './SettingsHint';
import { SettingsRow } from './SettingsRow';

/** Stage badge — how finished a flagged feature is. Neutral greys only; the
 *  strict palette has no room for a chromatic "beta" pill, and the word does
 *  the work anyway. */
function StageBadge({ stage }: { stage: FlagSpec['stage'] }) {
  return (
    <span className="rounded border border-border px-1.5 py-px text-[10px] uppercase tracking-wide text-muted-foreground">
      {stage}
    </span>
  );
}

/**
 * Labs — the opt-in surface for experimental features (PRD
 * `2026-08-15-single-binary-feature-flags.md`).
 *
 * Everyone now runs the same binary, so unfinished behaviour ships in it,
 * off, and is enabled here. The panel is deliberately visible rather than
 * hidden behind a chord: a hidden panel gets no traffic, and traffic is what
 * decides when a flag graduates.
 */
export function LabsSettings() {
  const entries = flagEntries();
  const enabled = useFlagStore((s) => s.enabled);
  const setEnabled = useFlagStore((s) => s.setEnabled);
  const resetAll = useFlagStore((s) => s.resetAll);

  if (entries.length === 0) {
    return (
      <SettingsGroup label="Labs">
        <SettingsHint>
          Nothing experimental is in flight right now. Features appear here
          while they are being tried out, and disappear once they are finished
          and turned on for everyone.
        </SettingsHint>
      </SettingsGroup>
    );
  }

  return (
    <>
      <SettingsGroup label="Labs">
        <SettingsHint>
          Features still being worked on. They may change, misbehave, or
          disappear. Turning any of them on also switches on usage and crash
          reporting — that is how we tell whether a feature is ready to keep —
          and you can turn that back off in Privacy at any time.
        </SettingsHint>

        {entries.map(([id, spec]) => (
          <SettingsRow
            key={id}
            label={spec.summary}
            description={
              <span className="flex items-center gap-2">
                <StageBadge stage={spec.stage} />
                <span>Added in {spec.introducedIn}</span>
              </span>
            }
            htmlFor={`flag-${id}`}
            control={
              <Switch
                id={`flag-${id}`}
                checked={enabled.includes(id as FlagId)}
                onCheckedChange={(on) => setEnabled(id as FlagId, on)}
              />
            }
          />
        ))}
      </SettingsGroup>

      {enabled.length > 0 && (
        <SettingsGroup label="Reset">
          <SettingsRow
            label="Turn off all Labs features"
            description="One way back if something you enabled is misbehaving."
            control={
              <Button variant="outline" size="sm" onClick={() => resetAll()}>
                Reset
              </Button>
            }
          />
        </SettingsGroup>
      )}
    </>
  );
}
