/**
 * AppearanceSettings (v2) — chrome-shaping settings.
 *
 *   1. Layout          — Quiet Composer toggle
 *   2. Theme           — color mode, accent, contrast
 *   3. Color tint      — preset pills + hue / intensity sliders
 *   4. Quiet chrome    — preset + per-element fade switches (from #51)
 *   5. Sidebar         — recent/tags caps + hide toggle (from #35)
 *
 * Live-test 2026-04-26 — typography (font, size, line-height) and the
 * Preview block moved to the Writing panel since the preview is driven
 * by the typography sliders.
 */

import * as React from 'react';
import { Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useSettingsStore } from '@/stores/settings-store';
import type { AccentName } from '@/lib/accent';
import type { QuietChromeTargets } from '@/lib/quiet-chrome-presets';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Constants (duplicated from SettingsDialog — small, lifting is a follow-up)
// ---------------------------------------------------------------------------

const TINT_PRESETS: ReadonlyArray<{ label: string; hue: number; chroma: number }> = [
  { label: 'Neutral', hue: 0, chroma: 0 },
  { label: 'Warm', hue: 60, chroma: 12 },
  { label: 'Sepia', hue: 55, chroma: 18 },
  { label: 'Rose', hue: 10, chroma: 10 },
  { label: 'Sage', hue: 145, chroma: 8 },
  { label: 'Ocean', hue: 230, chroma: 8 },
  { label: 'Lavender', hue: 290, chroma: 8 },
];

const THEME_OPTIONS = [
  { value: 'light' as const, label: 'Light', Icon: Sun },
  { value: 'dark' as const, label: 'Dark', Icon: Moon },
  { value: 'system' as const, label: 'System', Icon: Monitor },
];

interface AccentOption {
  value: AccentName;
  label: string;
  /** CSS color string used for the swatch dot. */
  swatch: string;
}

// Swatches match the actual `--accent` values from `.accent-*` classes in
// `globals.css` so what the user sees in the picker is what the UI applies.
// Material Deep Orange 500 / Material Blue 700 — see design-system.md
// "Accent Token Guardrails".
const ACCENT_OPTIONS: ReadonlyArray<AccentOption> = [
  { value: 'default', label: 'Default', swatch: 'var(--color-foreground)' },
  { value: 'orange', label: 'Orange', swatch: 'oklch(68% 0.21 37)' },
  { value: 'blue', label: 'Blue', swatch: 'oklch(56% 0.16 253)' },
  { value: 'system', label: 'System', swatch: 'var(--accent-system-value, oklch(68% 0.21 37))' },
];

const QUIET_CHROME_PRESET_OPTIONS = [
  { value: 'relaxed' as const, label: 'Relaxed' },
  { value: 'default' as const, label: 'Default' },
  { value: 'aggressive' as const, label: 'Aggressive' },
];

// `docHead` is intentionally absent — the DocHead element was removed in
// task #131 of the UI refresh, so an override switch for it would fade
// nothing. The key still exists in `QuietChromeTargets` for
// settings-migration safety, but the row no longer renders.
const QUIET_CHROME_OVERRIDE_ROWS: ReadonlyArray<{
  key: keyof QuietChromeTargets;
  label: string;
}> = [
  { key: 'toolbar', label: 'Toolbar' },
  { key: 'status', label: 'Status bar' },
  { key: 'sidebar', label: 'Sidebar' },
  { key: 'orb', label: 'Agent orb' },
];

// ---------------------------------------------------------------------------
// Small internal segmented-control helper (matches legacy look)
// ---------------------------------------------------------------------------

interface SegmentedProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: React.ReactNode; ariaLabel?: string; disabled?: boolean }>;
  value: T;
  onChange: (value: T) => void;
  /** Approximate column count for the grid. Defaults to options.length (single row). */
  columns?: number;
  /** Optional test id on the wrapping element for scoped queries in tests. */
  dataTestId?: string;
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  columns,
  dataTestId,
}: SegmentedProps<T>) {
  const gridCols = columns ?? options.length;
  return (
    <div
      data-testid={dataTestId}
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
      role="radiogroup"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.ariaLabel}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5',
              'text-[12px] font-medium transition-colors duration-150',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'border-foreground bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]'
                : 'border-border text-muted-foreground hover:bg-muted',
              opt.disabled && 'opacity-50 cursor-not-allowed hover:bg-transparent',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AppearanceSettings
// ---------------------------------------------------------------------------

export function AppearanceSettings() {
  // ── Settings store ────────────────────────────────────────────────────
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const accent = useSettingsStore((s) => s.accent);
  const setAccent = useSettingsStore((s) => s.setAccent);
  const contrastLevel = useSettingsStore((s) => s.contrastLevel);
  const setContrastLevel = useSettingsStore((s) => s.setContrastLevel);
  const tintHue = useSettingsStore((s) => s.tintHue);
  const setTintHue = useSettingsStore((s) => s.setTintHue);
  const tintChroma = useSettingsStore((s) => s.tintChroma);
  const setTintChroma = useSettingsStore((s) => s.setTintChroma);
  const quietChromePreset = useSettingsStore((s) => s.quietChromePreset);
  const quietChromeOverrides = useSettingsStore((s) => s.quietChromeOverrides);
  const quietChromeTransparent = useSettingsStore(
    (s) => s.quietChromeTransparent,
  );
  const setQuietChromeTransparent = useSettingsStore(
    (s) => s.setQuietChromeTransparent,
  );
  const setQuietChromePreset = useSettingsStore((s) => s.setQuietChromePreset);
  const setQuietChromeOverride = useSettingsStore((s) => s.setQuietChromeOverride);
  const sidebarRecentCap = useSettingsStore((s) => s.sidebarRecentCap);
  const setSidebarRecentCap = useSettingsStore((s) => s.setSidebarRecentCap);
  const sidebarTagsCap = useSettingsStore((s) => s.sidebarTagsCap);
  const setSidebarTagsCap = useSettingsStore((s) => s.setSidebarTagsCap);
  const sidebarMentionsCap = useSettingsStore((s) => s.sidebarMentionsCap);
  const setSidebarMentionsCap = useSettingsStore((s) => s.setSidebarMentionsCap);

  // ── Derived values ────────────────────────────────────────────────────

  const contrastSublabel = React.useMemo(() => {
    if (contrastLevel === 0) return 'Full';
    if (contrastLevel === 100) return 'Soft';
    return `${contrastLevel}%`;
  }, [contrastLevel]);

  const intensityPct = React.useMemo(
    () => `${Math.round((tintChroma / 30) * 100)}%`,
    [tintChroma],
  );

  // Show advanced quiet-chrome switches whenever the preset is "custom".
  const showQuietChromeAdvanced = quietChromePreset === 'custom';

  // ── Layout (formerly in Advanced > Experimental) ─────────────────────
  const uiPreview = useSettingsStore((s) => s.uiPreview);
  const setUiPreview = useSettingsStore((s) => s.setUiPreview);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <>
      {/* Live-test 2026-04-25 — panel hero dropped. Mockup-e has no
          per-panel "Appearance" heading + description; the nav already
          shows which panel is active. The tagline lives there as a
          column-header tooltip if we ever need it. Removing the hero
          tightens the panel meaningfully and matches the comp. */}

      {/* ── Layout ────────────────────────────────────────────────── */}
      <SettingsGroup label="Layout">
        <SettingsRow
          label="Quiet Composer"
          description="The new layout. Floating command bar, ambient agent orb, full-height sidebar. Toggle off to return to the classic layout."
          htmlFor="appearance-ui-preview"
          control={
            <Switch
              id="appearance-ui-preview"
              checked={uiPreview === 'quiet-composer'}
              onCheckedChange={(checked) =>
                setUiPreview(checked ? 'quiet-composer' : 'legacy')
              }
            />
          }
        />
      </SettingsGroup>

      {/* ── Theme ────────────────────────────────────────────────── */}
      <SettingsGroup label="Theme">
        <SettingsRow
          label="Color mode"
          description="Light, dark, or match the operating system."
          control={
            <Segmented
              dataTestId="appearance-color-mode"
              options={THEME_OPTIONS.map((o) => ({
                value: o.value,
                label: (
                  <>
                    <o.Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                    <span>{o.label}</span>
                  </>
                ),
                ariaLabel: o.label,
              }))}
              value={theme}
              onChange={setTheme}
            />
          }
        />

        <SettingsRow
          label="Accent color"
          description="Used for primary affordances like buttons, toggles, and focus rings."
          control={
            <Segmented
              dataTestId="appearance-accent"
              options={ACCENT_OPTIONS.map((o) => ({
                value: o.value,
                label: (
                  <>
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 rounded-full border border-border shrink-0"
                      style={{ backgroundColor: o.swatch }}
                    />
                    <span>{o.label}</span>
                  </>
                ),
                ariaLabel: o.label,
              }))}
              value={accent}
              onChange={setAccent}
              columns={4}
            />
          }
        />

        <SettingsRow
          label="Contrast"
          description="Fine-tune contrast for eye comfort."
          control={
            <div className="w-[180px]">
              <Slider
                value={[contrastLevel]}
                onValueChange={([v]) => setContrastLevel(v)}
                min={0}
                max={100}
                step={1}
                aria-label="Contrast"
              />
            </div>
          }
          controlSublabel={contrastSublabel}
        />

        {/* Color tint — folded into the Theme group (live-test
            2026-04-26). The 7 named chips are too wide to right-align
            next to a label, so this is a custom block: "Color tint"
            label on top, chips flow left-aligned below at full
            width. Intensity / Hue rows appear when a non-Neutral
            tint is active. */}
        <div className="px-0 py-3 space-y-2">
          <div>
            <span className="text-[13px] font-medium text-foreground">
              Color tint
            </span>
            <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
              Add a subtle color wash to the interface. Neutral keeps the
              palette strictly greyscale.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TINT_PRESETS.map((preset) => {
              const isActive =
                preset.chroma === 0
                  ? tintChroma === 0
                  : tintChroma > 0 &&
                    tintHue === preset.hue &&
                    tintChroma === preset.chroma;
              return (
                <button
                  key={preset.label}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    setTintHue(preset.hue);
                    setTintChroma(preset.chroma);
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md',
                    'text-[12px] font-medium border transition-colors duration-150',
                    'outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isActive
                      ? 'border-foreground bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]'
                      : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                >
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 rounded-full shrink-0 border border-border"
                    style={{
                      backgroundColor:
                        preset.chroma === 0
                          ? 'oklch(70% 0 0)'
                          : `oklch(70% 0.08 ${preset.hue})`,
                    }}
                  />
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        {tintChroma > 0 ? (
          <>
            <SettingsRow
              label="Intensity"
              description="How strongly the tint bleeds into the UI chrome."
              control={
                <div className="flex items-center gap-2">
                  <div className="w-[180px]">
                    <Slider
                      value={[tintChroma]}
                      onValueChange={([v]) => setTintChroma(v)}
                      min={1}
                      max={30}
                      step={1}
                      aria-label="Tint intensity"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setTintChroma(0)}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors duration-150"
                    aria-label="Reset tint"
                  >
                    <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
                    Reset
                  </button>
                </div>
              }
              controlSublabel={intensityPct}
            />

            <SettingsRow
              label="Hue"
              description="Shifts the tint hue."
              control={
                <div className="w-[180px]">
                  <Slider
                    value={[tintHue]}
                    onValueChange={([v]) => setTintHue(v)}
                    min={0}
                    max={359}
                    step={1}
                    aria-label="Tint hue"
                  />
                </div>
              }
              controlSublabel={`${tintHue}°`}
            />
          </>
        ) : null}
      </SettingsGroup>

      {/* ── Quiet chrome ─────────────────────────────────────────── */}
      <SettingsGroup
        label="Quiet Chrome"
        description="Fade chrome elements (toolbar, status bar, document header, sidebar, agent orb) while you type. The composer is never faded."
      >
        <SettingsRow
          label="Preset"
          description="Relaxed keeps most chrome visible. Aggressive dims everything under typing."
          control={
            <Segmented
              dataTestId="appearance-quiet-chrome"
              options={QUIET_CHROME_PRESET_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
                ariaLabel: o.label,
              }))}
              value={quietChromePreset === 'custom' ? 'default' : quietChromePreset}
              onChange={setQuietChromePreset}
            />
          }
          controlSublabel={
            quietChromePreset === 'custom' ? 'Custom overrides active' : null
          }
        />

        {showQuietChromeAdvanced
          ? QUIET_CHROME_OVERRIDE_ROWS.map(({ key, label }) => {
              const id = `appearance-quiet-chrome-${key}`;
              return (
                <SettingsRow
                  key={key}
                  label={`Fade ${label.toLowerCase()}`}
                  htmlFor={id}
                  control={
                    <Switch
                      id={id}
                      checked={quietChromeOverrides[key]}
                      onCheckedChange={(checked) => setQuietChromeOverride(key, checked)}
                    />
                  }
                />
              );
            })
          : null}

        {/* #132 — translucent chrome + editor flow-under. Default off
           *  so existing users see no change. When on, the title bar
           *  and status bar render with semi-transparent backgrounds +
           *  backdrop-blur and the document area scrolls beneath them
           *  (Bear / Craft chrome aesthetic). */}
        <SettingsRow
          label="Translucent chrome"
          description="Title bar and status bar use a frosted-glass background; the document scrolls beneath them. Off by default."
          htmlFor="appearance-quiet-chrome-transparent"
          control={
            <Switch
              id="appearance-quiet-chrome-transparent"
              checked={quietChromeTransparent}
              onCheckedChange={setQuietChromeTransparent}
            />
          }
        />
      </SettingsGroup>

      {/* ── Sidebar composition ──────────────────────────────────── */}
      <SettingsGroup
        label="Sidebar Composition"
        description="How many items each sidebar section shows, and which sections are visible."
      >
        <SettingsRow
          label="Recent items"
          description="Maximum recent files shown in the sidebar."
          control={
            <div className="w-[180px]">
              <Slider
                value={[sidebarRecentCap]}
                onValueChange={([v]) => setSidebarRecentCap(v)}
                min={3}
                max={15}
                step={1}
                aria-label="Recent items cap"
              />
            </div>
          }
          controlSublabel={String(sidebarRecentCap)}
        />

        <SettingsRow
          label="Top tags"
          description={
            sidebarTagsCap === 0
              ? 'Hidden — drag the slider above 0 to show the Tags section.'
              : 'Maximum tags shown, sorted by usage. Set to 0 to hide.'
          }
          control={
            <div className="w-[180px]">
              <Slider
                value={[sidebarTagsCap]}
                onValueChange={([v]) => setSidebarTagsCap(v)}
                min={0}
                max={15}
                step={1}
                aria-label="Top tags cap"
              />
            </div>
          }
          controlSublabel={sidebarTagsCap === 0 ? 'Hidden' : String(sidebarTagsCap)}
        />

        <SettingsRow
          label="Top mentions"
          description={
            sidebarMentionsCap === 0
              ? 'Hidden — drag the slider above 0 to show the Mentions section.'
              : 'Maximum mentions shown, sorted by usage. Set to 0 to hide.'
          }
          control={
            <div className="w-[180px]">
              <Slider
                value={[sidebarMentionsCap]}
                onValueChange={([v]) => setSidebarMentionsCap(v)}
                min={0}
                max={15}
                step={1}
                aria-label="Top mentions cap"
              />
            </div>
          }
          controlSublabel={
            sidebarMentionsCap === 0 ? 'Hidden' : String(sidebarMentionsCap)
          }
        />
      </SettingsGroup>

    </>
  );
}
