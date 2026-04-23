/**
 * AppearanceSettings (v2) — M1.4 Batch G10, task #65.
 *
 * New Appearance panel composed of `SettingsShell` primitives (#63). Collects
 * the appearance-related controls that previously lived in several legacy
 * Settings tabs (General / Editor / Advanced) into one coherent column:
 *
 *   1. Theme           — color mode, accent, contrast
 *   2. Color tint      — preset pills + hue / intensity sliders
 *   3. Quiet chrome    — preset + per-element fade switches (from #51)
 *   4. Sidebar         — recent/tags caps + hide toggle (from #35)
 *   5. Editor typography — font family, size, line height
 *   6. Preview         — live sample reacting to the font + theme/accent
 *
 * Rows that would require NEW settings fields are explicitly dropped rather
 * than added in this task:
 *
 *   - Reduce motion — `useReducedMotion` is a read-only reflection of the OS
 *     preference. No in-app override field exists in settings-store, and this
 *     task is a migration, not a feature-adding task.
 *   - Density — no `density` field exists in settings-store. Out of scope for
 *     a panel migration.
 *
 * Both drops are documented in the task report. When/if those settings land,
 * add the corresponding `SettingsRow` here and wire them up.
 */

import * as React from 'react';
import { Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSettingsStore } from '@/stores/settings-store';
import {
  FONT_PRESETS,
  fontFamilyCSS,
  useEditorStylesStore,
} from '@/stores/editor-styles-store';
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

const ACCENT_OPTIONS: ReadonlyArray<AccentOption> = [
  { value: 'default', label: 'Default', swatch: 'var(--color-foreground)' },
  { value: 'orange', label: 'Orange', swatch: 'oklch(70% 0.15 50)' },
  { value: 'blue', label: 'Blue', swatch: 'oklch(65% 0.15 250)' },
  { value: 'system', label: 'System', swatch: 'var(--accent-system-value, oklch(65% 0.15 250))' },
];

const QUIET_CHROME_PRESET_OPTIONS = [
  { value: 'relaxed' as const, label: 'Relaxed' },
  { value: 'default' as const, label: 'Default' },
  { value: 'aggressive' as const, label: 'Aggressive' },
];

const QUIET_CHROME_OVERRIDE_ROWS: ReadonlyArray<{
  key: keyof QuietChromeTargets;
  label: string;
}> = [
  { key: 'toolbar', label: 'Toolbar' },
  { key: 'status', label: 'Status bar' },
  { key: 'docHead', label: 'Document header' },
  { key: 'sidebar', label: 'Sidebar' },
  { key: 'orb', label: 'Agent orb' },
];

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 22;
const LINE_HEIGHT_MIN = 1.2;
const LINE_HEIGHT_MAX = 2.2;
const LINE_HEIGHT_STEP = 0.05;

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
                ? 'border-foreground bg-accent text-foreground'
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
  const setQuietChromePreset = useSettingsStore((s) => s.setQuietChromePreset);
  const setQuietChromeOverride = useSettingsStore((s) => s.setQuietChromeOverride);
  const sidebarRecentCap = useSettingsStore((s) => s.sidebarRecentCap);
  const setSidebarRecentCap = useSettingsStore((s) => s.setSidebarRecentCap);
  const sidebarTagsCap = useSettingsStore((s) => s.sidebarTagsCap);
  const setSidebarTagsCap = useSettingsStore((s) => s.setSidebarTagsCap);
  const sidebarTagsHidden = useSettingsStore((s) => s.sidebarTagsHidden);
  const setSidebarTagsHidden = useSettingsStore((s) => s.setSidebarTagsHidden);

  // ── Editor typography store ───────────────────────────────────────────
  const fontFamily = useEditorStylesStore((s) => s.fontFamily);
  const fontSize = useEditorStylesStore((s) => s.fontSize);
  const lineHeight = useEditorStylesStore((s) => s.lineHeight);
  const setFontFamily = useEditorStylesStore((s) => s.setFontFamily);
  const setFontSize = useEditorStylesStore((s) => s.setFontSize);
  const setLineHeight = useEditorStylesStore((s) => s.setLineHeight);

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

  const previewFontCSS = fontFamilyCSS(fontFamily);

  // Show advanced quiet-chrome switches whenever the preset is "custom".
  const showQuietChromeAdvanced = quietChromePreset === 'custom';

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <>
      <header className="mb-8 pb-6 border-b border-border">
        <h2 className="text-[24px] font-semibold tracking-tight">Appearance</h2>
        <p className="mt-1 text-[13px] text-muted-foreground max-w-[520px] leading-relaxed">
          How Notesage looks. All changes are live — the preview below reflects
          the current selection instantly.
        </p>
      </header>

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
      </SettingsGroup>

      {/* ── Color tint ────────────────────────────────────────────── */}
      <SettingsGroup
        label="Color tint"
        description="Add a subtle color wash to the interface. Neutral keeps the palette strictly greyscale."
      >
        <SettingsRow
          label="Preset"
          description="Named tint presets. Picking Neutral clears any tint."
          control={
            <div className="flex flex-wrap gap-1.5 max-w-[360px] justify-end">
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
                        ? 'border-foreground bg-accent text-foreground'
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
          }
        />

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
              description="Rotates the tint around the oklch color wheel."
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
        label="Quiet chrome"
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
      </SettingsGroup>

      {/* ── Sidebar composition ──────────────────────────────────── */}
      <SettingsGroup
        label="Sidebar composition"
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
            sidebarTagsHidden
              ? 'Hidden — enable the toggle below to show tags.'
              : 'Maximum tags shown, sorted by usage.'
          }
          control={
            <div className="w-[180px]">
              <Slider
                value={[sidebarTagsCap]}
                onValueChange={([v]) => setSidebarTagsCap(v)}
                min={3}
                max={15}
                step={1}
                disabled={sidebarTagsHidden}
                aria-label="Top tags cap"
              />
            </div>
          }
          controlSublabel={String(sidebarTagsCap)}
        />

        <SettingsRow
          label="Hide Tags section"
          description="Remove the tags list from the sidebar entirely."
          htmlFor="appearance-sidebar-tags-hidden"
          control={
            <Switch
              id="appearance-sidebar-tags-hidden"
              checked={sidebarTagsHidden}
              onCheckedChange={setSidebarTagsHidden}
            />
          }
        />
      </SettingsGroup>

      {/* ── Editor typography ────────────────────────────────────── */}
      <SettingsGroup
        label="Editor typography"
        description="Default font, size, and line-height for the paragraph block. Per-heading overrides live in the editor typography popover."
      >
        <SettingsRow
          label="Font family"
          description="Preset reading fonts bundled with Notesage."
          control={
            <Select value={fontFamily} onValueChange={setFontFamily}>
              <SelectTrigger className="w-[200px]" aria-label="Font family">
                <SelectValue placeholder="Pick a font" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Sans-serif</SelectLabel>
                  {FONT_PRESETS.filter((p) => p.category === 'sans').map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <span style={{ fontFamily: p.css }}>{p.label}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Serif</SelectLabel>
                  {FONT_PRESETS.filter((p) => p.category === 'serif').map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <span style={{ fontFamily: p.css }}>{p.label}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Monospace</SelectLabel>
                  {FONT_PRESETS.filter((p) => p.category === 'mono').map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <span style={{ fontFamily: p.css }}>{p.label}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          }
        />

        <SettingsRow
          label="Font size"
          description="Base paragraph font size, in pixels."
          control={
            <div className="w-[180px]">
              <Slider
                value={[fontSize]}
                onValueChange={([v]) => setFontSize(v)}
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                step={1}
                aria-label="Font size"
              />
            </div>
          }
          controlSublabel={`${fontSize} px`}
        />

        <SettingsRow
          label="Line height"
          description="How much vertical room each line gets."
          control={
            <div className="w-[180px]">
              <Slider
                value={[lineHeight]}
                onValueChange={([v]) => setLineHeight(v)}
                min={LINE_HEIGHT_MIN}
                max={LINE_HEIGHT_MAX}
                step={LINE_HEIGHT_STEP}
                aria-label="Line height"
              />
            </div>
          }
          controlSublabel={lineHeight.toFixed(2)}
        />
      </SettingsGroup>

      {/* ── Preview ──────────────────────────────────────────────── */}
      <SettingsGroup label="Preview">
        <div
          data-testid="appearance-preview"
          aria-hidden="true"
          className="px-4 py-4"
        >
          <div
            className="rounded-md border border-border bg-background p-4 min-h-[180px]"
            style={{
              fontFamily: previewFontCSS,
              fontSize: `${fontSize}px`,
              lineHeight,
            }}
          >
            <h4
              className="font-semibold mb-1"
              style={{ fontFamily: previewFontCSS }}
            >
              Sample heading
            </h4>
            <p className="m-0 mb-3">
              This paragraph uses your current font, size, and line height.
              The surrounding chrome reflects the active theme, accent, and
              contrast.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={cn(
                  'inline-flex items-center justify-center rounded-md',
                  'px-3 py-1.5 text-[12px] font-medium',
                  'text-[oklch(100%_0_0)] transition-opacity duration-150',
                  'hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
                style={{
                  backgroundColor: 'var(--accent, var(--color-foreground))',
                }}
              >
                Primary action
              </button>
              <span className="text-[11px] text-muted-foreground">
                {fontSize} px · {lineHeight.toFixed(2)} line-height
              </span>
            </div>
          </div>
        </div>
      </SettingsGroup>
    </>
  );
}
