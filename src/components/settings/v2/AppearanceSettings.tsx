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
import { track, trackSettingToggle } from '@/lib/telemetry';
import type { AccentName } from '@/lib/accent';
import type { Locale } from '@/lib/i18n';
import { t, type MessageKey } from '@/lib/i18n';
import type { QuietChromeTargets } from '@/lib/quiet-chrome-presets';
import { cn } from '@/lib/utils';
import { useLocale } from '@/lib/useLocale';

// ---------------------------------------------------------------------------
// Constants (duplicated from SettingsDialog — small, lifting is a follow-up)
// ---------------------------------------------------------------------------

// `labelKey`, not `label`: these arrays are module scope, and `t()` evaluated
// here would freeze the language at import — the frozen-nav trap
// `settings-i18n.test.tsx` documents. The key is resolved at render.
const TINT_PRESETS: ReadonlyArray<{ labelKey: MessageKey; hue: number; chroma: number }> = [
  { labelKey: 'appearance.tintNeutral', hue: 0, chroma: 0 },
  { labelKey: 'appearance.tintWarm', hue: 60, chroma: 12 },
  { labelKey: 'appearance.tintSepia', hue: 55, chroma: 18 },
  { labelKey: 'appearance.tintRose', hue: 10, chroma: 10 },
  { labelKey: 'appearance.tintSage', hue: 145, chroma: 8 },
  { labelKey: 'appearance.tintOcean', hue: 230, chroma: 8 },
  { labelKey: 'appearance.tintLavender', hue: 290, chroma: 8 },
];

const THEME_OPTIONS: ReadonlyArray<{
  value: 'light' | 'dark' | 'system';
  labelKey: MessageKey;
  Icon: typeof Sun;
}> = [
  { value: 'light', labelKey: 'appearance.themeLight', Icon: Sun },
  { value: 'dark', labelKey: 'appearance.themeDark', Icon: Moon },
  { value: 'system', labelKey: 'appearance.themeSystem', Icon: Monitor },
];

interface AccentOption {
  value: AccentName;
  labelKey: MessageKey;
  /** CSS color string used for the swatch dot. */
  swatch: string;
}

// Swatches match the actual `--accent` values from `.accent-*` classes in
// `globals.css` so what the user sees in the picker is what the UI applies.
// Material Deep Orange 500 / Material Blue 700 — see design-system.md
// "Accent Token Guardrails".
const ACCENT_OPTIONS: ReadonlyArray<AccentOption> = [
  { value: 'default', labelKey: 'appearance.accentDefault', swatch: 'var(--color-foreground)' },
  { value: 'orange', labelKey: 'appearance.accentOrange', swatch: 'oklch(68% 0.21 37)' },
  { value: 'blue', labelKey: 'appearance.accentBlue', swatch: 'oklch(56% 0.16 253)' },
  { value: 'system', labelKey: 'appearance.accentSystem', swatch: 'var(--accent-system-value, oklch(68% 0.21 37))' },
];

const QUIET_CHROME_PRESET_OPTIONS: ReadonlyArray<{
  value: 'relaxed' | 'default' | 'aggressive';
  labelKey: MessageKey;
}> = [
  { value: 'relaxed', labelKey: 'appearance.quietRelaxed' },
  { value: 'default', labelKey: 'appearance.quietDefault' },
  { value: 'aggressive', labelKey: 'appearance.quietAggressive' },
];

// `docHead` is intentionally absent — the DocHead element was removed in
// task #131 of the UI refresh, so an override switch for it would fade
// nothing. The key still exists in `QuietChromeTargets` for
// settings-migration safety, but the row no longer renders.
const QUIET_CHROME_OVERRIDE_ROWS: ReadonlyArray<{
  key: keyof QuietChromeTargets;
  labelKey: MessageKey;
}> = [
  { key: 'toolbar', labelKey: 'appearance.chromeToolbar' },
  { key: 'status', labelKey: 'appearance.chromeStatus' },
  { key: 'titlebar', labelKey: 'appearance.chromeTitlebar' },
  { key: 'cmdbar', labelKey: 'appearance.chromeCmdbar' },
  { key: 'sidebar', labelKey: 'appearance.chromeSidebar' },
  { key: 'orb', labelKey: 'appearance.chromeOrb' },
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
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  // ── Settings store ────────────────────────────────────────────────────
  const locale = useSettingsStore((s) => s.locale);
  const setLocale = useSettingsStore((s) => s.setLocale);
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
  const showTitleBar = useSettingsStore((s) => s.showTitleBar);
  const setShowTitleBar = useSettingsStore((s) => s.setShowTitleBar);
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

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <>
      {/* Live-test 2026-04-25 — panel hero dropped. Mockup-e has no
          per-panel "Appearance" heading + description; the nav already
          shows which panel is active. The tagline lives there as a
          column-header tooltip if we ever need it. Removing the hero
          tightens the panel meaningfully and matches the comp. */}

      {/* ── Language ─────────────────────────────────────────────── */}
      <SettingsGroup label={t("settings.language")}>
        <SettingsRow
          label={t("settings.displayLanguage")}
          description={t("settings.displayLanguageDesc")}
          control={
            <Segmented
              dataTestId="appearance-language"
              options={[
                { value: 'system', label: t("appearance.langSystem"), ariaLabel: t("appearance.langSystemAria") },
                { value: 'en', label: 'English', ariaLabel: 'English' },
                { value: 'sv', label: 'Svenska', ariaLabel: 'Svenska' },
              ]}
              value={locale ?? 'system'}
              onChange={(v) => {
                const next = v === 'system' ? null : (v as Locale);
                setLocale(next);
                track('setting_changed', { setting: 'locale', value: v });
              }}
            />
          }
        />
      </SettingsGroup>

      {/* ── Theme ────────────────────────────────────────────────── */}
      <SettingsGroup label={t("settings.theme")}>
        <SettingsRow
          label={t("settings.colorMode")}
          description={t("settings.colorModeDesc")}
          control={
            <Segmented
              dataTestId="appearance-color-mode"
              options={THEME_OPTIONS.map((o) => ({
                value: o.value,
                label: (
                  <>
                    <o.Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                    <span>{t(o.labelKey)}</span>
                  </>
                ),
                ariaLabel: t(o.labelKey),
              }))}
              value={theme}
              onChange={(v) => { setTheme(v); track("setting_changed", { setting: "theme", value: v }); }}
            />
          }
        />

        <SettingsRow
          label={t("settings.accentColor")}
          description={t("settings.accentColorDesc")}
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
                    <span>{t(o.labelKey)}</span>
                  </>
                ),
                ariaLabel: t(o.labelKey),
              }))}
              value={accent}
              onChange={(v) => { setAccent(v); track("setting_changed", { setting: "accent", value: v }); }}
              columns={4}
            />
          }
        />

        <SettingsRow
          label={t("settings.contrast")}
          description={t("settings.contrastDesc")}
          control={
            <div className="w-[180px]">
              <Slider
                value={[contrastLevel]}
                onValueChange={([v]) => setContrastLevel(v)}
                min={0}
                max={100}
                step={1}
                aria-label={t("settings.contrast")}
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
              {t("appearance.colorTint")}
            </span>
            <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
              {t("appearance.colorTintHint")}
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
                  key={preset.labelKey}
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
                  {t(preset.labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        {tintChroma > 0 ? (
          <>
            <SettingsRow
              label={t("settings.intensity")}
              description={t("settings.intensityDesc")}
              control={
                <div className="flex items-center gap-2">
                  <div className="w-[180px]">
                    <Slider
                      value={[tintChroma]}
                      onValueChange={([v]) => setTintChroma(v)}
                      min={1}
                      max={30}
                      step={1}
                      aria-label={t("settings.tintIntensity")}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setTintChroma(0)}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors duration-150"
                    aria-label={t("settings.resetTint")}
                  >
                    <RotateCcw className="h-3 w-3" strokeWidth={1.5} />
                    {t("appearance.reset")}
                  </button>
                </div>
              }
              controlSublabel={intensityPct}
            />

            <SettingsRow
              label={t("settings.hue")}
              description={t("appearance.tintHueDesc")}
              control={
                <div className="w-[180px]">
                  <Slider
                    value={[tintHue]}
                    onValueChange={([v]) => setTintHue(v)}
                    min={0}
                    max={359}
                    step={1}
                    aria-label={t("appearance.tintHue")}
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
        label={t("settings.quietChrome")}
        description={t("appearance.fadeDesc")}
      >
        <SettingsRow
          label={t("settings.preset")}
          description={t("settings.presetDesc")}
          control={
            <Segmented
              dataTestId="appearance-quiet-chrome"
              options={QUIET_CHROME_PRESET_OPTIONS.map((o) => ({
                value: o.value,
                label: t(o.labelKey),
                ariaLabel: t(o.labelKey),
              }))}
              value={quietChromePreset === 'custom' ? 'default' : quietChromePreset}
              onChange={(v) => { setQuietChromePreset(v); track("setting_changed", { setting: "quiet_preset", value: v }); }}
            />
          }
          controlSublabel={
            quietChromePreset === 'custom' ? 'Custom overrides active' : null
          }
        />

        {showQuietChromeAdvanced
          ? QUIET_CHROME_OVERRIDE_ROWS.map(({ key, labelKey }) => {
              const id = `appearance-quiet-chrome-${key}`;
              return (
                <SettingsRow
                  key={key}
                  label={t("appearance.fadeTarget", { target: t(labelKey).toLowerCase() })}
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

        {/* Show/hide the document title bar (name + dirty dot + close ×).
           *  Off by default — the filename also lives in the sidebar and
           *  status bar, and window dragging is handled by the sidebar, so
           *  hiding it reclaims vertical space for the document. */}
        <SettingsRow
          label={t("settings.showTitleBar")}
          description={t("appearance.titleBarDesc")}
          htmlFor="appearance-show-title-bar"
          control={
            <Switch
              id="appearance-show-title-bar"
              checked={showTitleBar}
              onCheckedChange={(v) => { setShowTitleBar(v); trackSettingToggle("title_bar", v); }}
            />
          }
        />

        {/* #132 — translucent chrome + editor flow-under. Default off
           *  so existing users see no change. When on, the title bar
           *  and status bar render with semi-transparent backgrounds +
           *  backdrop-blur and the document area scrolls beneath them
           *  (Bear / Craft chrome aesthetic). */}
        <SettingsRow
          label={t("settings.translucentChrome")}
          description={t("appearance.transparentChromeHint")}
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
        label={t("settings.sidebarComposition")}
        description={t("settings.sidebarCompositionDesc")}
      >
        <SettingsRow
          label={t("settings.recentItems")}
          description={t("settings.recentItemsDesc")}
          control={
            <div className="w-[180px]">
              <Slider
                value={[sidebarRecentCap]}
                onValueChange={([v]) => setSidebarRecentCap(v)}
                min={3}
                max={15}
                step={1}
                aria-label={t("settings.recentItemsCap")}
              />
            </div>
          }
          controlSublabel={String(sidebarRecentCap)}
        />

        <SettingsRow
          label={t("settings.topTags")}
          description={
            sidebarTagsCap === 0
              ? t("appearance.tagsHidden")
              : t("appearance.tagsCapHint")
          }
          control={
            <div className="w-[180px]">
              <Slider
                value={[sidebarTagsCap]}
                onValueChange={([v]) => setSidebarTagsCap(v)}
                min={0}
                max={15}
                step={1}
                aria-label={t("settings.topTagsCap")}
              />
            </div>
          }
          controlSublabel={sidebarTagsCap === 0 ? 'Hidden' : String(sidebarTagsCap)}
        />

        <SettingsRow
          label={t("settings.topMentions")}
          description={
            sidebarMentionsCap === 0
              ? t("appearance.mentionsHidden")
              : t("appearance.mentionsCapHint")
          }
          control={
            <div className="w-[180px]">
              <Slider
                value={[sidebarMentionsCap]}
                onValueChange={([v]) => setSidebarMentionsCap(v)}
                min={0}
                max={15}
                step={1}
                aria-label={t("settings.topMentionsCap")}
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
