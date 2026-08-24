import * as React from 'react';
import { Switch } from '@/components/ui/switch';
import { trackSettingToggle } from '@/lib/telemetry';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSettingsStore, type MeasurementUnit } from '@/stores/settings-store';
import {
  FONT_PRESETS,
  fontFamilyCSS,
  useEditorStylesStore,
} from '@/stores/editor-styles-store';
import { cn } from '@/lib/utils';
import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/useLocale';

const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 22;
const LINE_HEIGHT_MIN = 1.2;
const LINE_HEIGHT_MAX = 2.2;
const LINE_HEIGHT_STEP = 0.05;

// Page dimensions in cm
const PAGE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  a4: { width: 21.0, height: 29.7 },
  a5: { width: 14.8, height: 21.0 },
  letter: { width: 21.6, height: 27.9 },
};

function toDisplay(cm: number, unit: MeasurementUnit): string {
  if (unit === 'inch') {
    return (cm / 2.54).toFixed(1);
  }
  return cm.toFixed(1);
}

function fromDisplay(displayValue: number, unit: MeasurementUnit): number {
  if (unit === 'inch') {
    return displayValue * 2.54;
  }
  return displayValue;
}

function formatDimension(cm: number, unit: MeasurementUnit): string {
  if (unit === 'inch') {
    return (cm / 2.54).toFixed(1);
  }
  return cm.toFixed(1);
}

/**
 * Writing settings panel (v2) — typography, editor options, and page
 * layout. The panel id stays "editor" for back-compat with stored
 * `initialActiveItem` values; the human-facing label is "Writing".
 *
 * Live-test 2026-04-26 — typography (font, size, line-height) and the
 * Preview block moved here from Appearance. The preview is *driven* by
 * the typography sliders, so they belong together; Appearance now owns
 * only chrome-shaping settings (theme, accent, contrast, tint, quiet
 * chrome, sidebar composition).
 */
export function EditorSettings() {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  const toolbarVisible = useSettingsStore((s) => s.toolbarVisible);
  const setToolbarVisible = useSettingsStore((s) => s.setToolbarVisible);
  const showFloatingToolbar = useSettingsStore((s) => s.showFloatingToolbar);
  const setShowFloatingToolbar = useSettingsStore((s) => s.setShowFloatingToolbar);
  const typewriterScrolling = useSettingsStore((s) => s.typewriterScrolling);
  const setTypewriterScrolling = useSettingsStore((s) => s.setTypewriterScrolling);
  const externalChangeDiffReview = useSettingsStore((s) => s.externalChangeDiffReview);
  const setExternalChangeDiffReview = useSettingsStore(
    (s) => s.setExternalChangeDiffReview,
  );
  // Moved from Advanced > Scope (consolidation 2026-04-26): completions
  // out-of-scope is an editor-side AI affordance — sits naturally next
  // to the other editor toggles.
  const completionsOnOutOfScope = useSettingsStore((s) => s.completionsOnOutOfScope);
  const setCompletionsOnOutOfScope = useSettingsStore(
    (s) => s.setCompletionsOnOutOfScope,
  );
  const contentWidth = useSettingsStore((s) => s.contentWidth);
  const setContentWidth = useSettingsStore((s) => s.setContentWidth);
  const measurementUnit = useSettingsStore((s) => s.measurementUnit);
  const setMeasurementUnit = useSettingsStore((s) => s.setMeasurementUnit);
  const marginTop = useSettingsStore((s) => s.marginTop);
  const setMarginTop = useSettingsStore((s) => s.setMarginTop);
  const marginBottom = useSettingsStore((s) => s.marginBottom);
  const setMarginBottom = useSettingsStore((s) => s.setMarginBottom);
  const marginLeft = useSettingsStore((s) => s.marginLeft);
  const setMarginLeft = useSettingsStore((s) => s.setMarginLeft);
  const marginRight = useSettingsStore((s) => s.marginRight);
  const setMarginRight = useSettingsStore((s) => s.setMarginRight);
  const printLayout = useSettingsStore((s) => s.printLayout);
  const setPrintLayout = useSettingsStore((s) => s.setPrintLayout);

  // Editor typography (live-test 2026-04-26 — moved from Appearance).
  const fontFamily = useEditorStylesStore((s) => s.fontFamily);
  const fontSize = useEditorStylesStore((s) => s.fontSize);
  const lineHeight = useEditorStylesStore((s) => s.lineHeight);
  const setFontFamily = useEditorStylesStore((s) => s.setFontFamily);
  const setFontSize = useEditorStylesStore((s) => s.setFontSize);
  const setLineHeight = useEditorStylesStore((s) => s.setLineHeight);

  const previewFontCSS = fontFamilyCSS(fontFamily);
  const currentFontLabel = React.useMemo(
    () =>
      FONT_PRESETS.find((p) => p.value === fontFamily)?.label ?? fontFamily,
    [fontFamily],
  );

  const unitLabel = measurementUnit === 'cm' ? 'cm' : 'in';

  function pageLabel(key: string, name: string): string {
    const dims = PAGE_DIMENSIONS[key];
    if (!dims) return name;
    return `${name} (${formatDimension(dims.width, measurementUnit)} x ${formatDimension(
      dims.height,
      measurementUnit,
    )} ${unitLabel})`;
  }

  function handleMarginInput(value: string, setter: (v: number) => void) {
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed < 0) return;
    setter(fromDisplay(parsed, measurementUnit));
  }

  return (
    <>
      <SettingsGroup
        label={t("settings.typography")}
        description="Default font, size, and line-height for the paragraph block. Per-heading overrides live in the editor typography popover."
      >
        <SettingsRow
          label={t("settings.fontFamily")}
          description={t("settings.fontFamilyDesc")}
          control={
            <Select value={fontFamily} onValueChange={setFontFamily}>
              <SelectTrigger className="w-[200px]" aria-label={t("settings.fontFamily")}>
                <SelectValue placeholder={t("editorSettings.pickFont")} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t("settings.sansSerif")}</SelectLabel>
                  {FONT_PRESETS.filter((p) => p.category === 'sans').map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <span style={{ fontFamily: p.css }}>{p.label}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>{t("settings.serif")}</SelectLabel>
                  {FONT_PRESETS.filter((p) => p.category === 'serif').map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <span style={{ fontFamily: p.css }}>{p.label}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>{t("settings.monospace")}</SelectLabel>
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
          label={t("settings.fontSize")}
          description={t("settings.fontSizeDesc")}
          control={
            <div className="w-[180px]">
              <Slider
                value={[fontSize]}
                onValueChange={([v]) => setFontSize(v)}
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                step={1}
                aria-label={t("settings.fontSize")}
              />
            </div>
          }
          controlSublabel={`${fontSize} px`}
        />

        <SettingsRow
          label={t("settings.lineHeight")}
          description={t("settings.lineHeightDesc")}
          control={
            <div className="w-[180px]">
              <Slider
                value={[lineHeight]}
                onValueChange={([v]) => setLineHeight(v)}
                min={LINE_HEIGHT_MIN}
                max={LINE_HEIGHT_MAX}
                step={LINE_HEIGHT_STEP}
                aria-label={t("settings.lineHeight")}
              />
            </div>
          }
          controlSublabel={lineHeight.toFixed(2)}
        />
      </SettingsGroup>

      <SettingsGroup label={t("settings.preview")}>
        <div
          data-testid="appearance-preview"
          aria-hidden="true"
          className="py-3"
        >
          <div
            className="rounded-md border border-border bg-background p-4"
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
              On Attention
            </h4>
            <p className="m-0 mb-2">
              The hardest part of thinking is not the thinking itself
              but holding still long enough for a thought to arrive.
              Distraction is rarely loud — it is almost always polite,
              small, well-intended.
            </p>
            <div className="text-[11px] text-muted-foreground">
              Preview · {fontSize} px {currentFontLabel} ·{' '}
              {lineHeight.toFixed(2)} line-height
            </div>
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup
        label={t("settings.editorOptions")}
        description={t("settings.editorOptionsDesc")}
      >
        <SettingsRow
          label={t("editorSettings.topToolbar")}
          description={t("editorSettings.topToolbarDesc")}
          htmlFor="toolbar-visible"
          control={
            <Switch
              id="toolbar-visible"
              checked={toolbarVisible}
              onCheckedChange={setToolbarVisible}
            />
          }
        />
        <SettingsRow
          label={t("settings.floatingToolbar")}
          description={t("settings.floatingToolbarDesc")}
          htmlFor="floating-toolbar"
          control={
            <Switch
              id="floating-toolbar"
              checked={showFloatingToolbar}
              onCheckedChange={setShowFloatingToolbar}
            />
          }
        />
        <SettingsRow
          label={t("settings.typewriterScrolling")}
          description={t("settings.typewriterScrollingDesc")}
          htmlFor="typewriter-scrolling"
          control={
            <Switch
              id="typewriter-scrolling"
              checked={typewriterScrolling}
              onCheckedChange={(v) => { setTypewriterScrolling(v); trackSettingToggle("typewriter_scrolling", v); }}
            />
          }
        />
        <SettingsRow
          label={t("settings.reviewExternalDiff")}
          description={
            <>
              When on, files modified on disk show inline diff decorations
              and a sticky Accept / Reject toast. When off, changes
              auto-reload silently with a 3-second info toast — applies to
              both clean and dirty tabs (in-memory edits are overwritten).{' '}
              <span className="text-muted-foreground/60">
                Beta — may not preserve formatting perfectly.
              </span>
            </>
          }
          htmlFor="external-diff-review"
          control={
            <Switch
              id="external-diff-review"
              checked={externalChangeDiffReview}
              onCheckedChange={(v) => { setExternalChangeDiffReview(v); trackSettingToggle("external_change_review", v); }}
            />
          }
        />
        {/* Inverted UI (live-test 2026-04-26 audit) — the persisted
            field is `completionsOnOutOfScope` (default false = safe),
            but the previous label "Completions outside project scope"
            read like a feature switch and users would enable it
            expecting completions to "work better", silently disabling
            the scope safety. The toggle now mirrors the inverted
            sense: ON = restricted (default), OFF = allow everywhere. */}
        <SettingsRow
          label={t("settings.restrictCompletions")}
          description="When on (default), inline completions are suppressed for files outside the project selected in the command bar — your completion provider never sees unrelated files. Turn off to receive completions everywhere."
          htmlFor="restrict-completions-scope"
          control={
            <Switch
              id="restrict-completions-scope"
              checked={!completionsOnOutOfScope}
              onCheckedChange={(checked) =>
                setCompletionsOnOutOfScope(!checked)
              }
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        label={t("settings.pageLayout")}
        description={t("settings.pageLayoutDesc")}
      >
        <SettingsRow
          label={t("settings.units")}
          description={t("settings.unitsDesc")}
          control={
            <div className="inline-flex h-7 rounded-md overflow-hidden border border-border">
              {(['cm', 'inch'] as const).map((unit) => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => setMeasurementUnit(unit)}
                  className={cn(
                    'inline-flex items-center justify-center px-3 text-[11px] font-medium transition-colors duration-150 hover:bg-accent',
                    measurementUnit === unit
                      ? 'bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]'
                      : 'text-muted-foreground',
                  )}
                >
                  {unit === 'cm' ? 'cm' : 'in'}
                </button>
              ))}
            </div>
          }
        />

        <SettingsRow
          label={t("settings.pageSize")}
          description={t("settings.pageSizeDesc")}
          control={
            <Select value={contentWidth} onValueChange={setContentWidth}>
              <SelectTrigger className="w-[200px] text-left">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">{t("editorSettings.fullWidth")}</SelectItem>
                <SelectItem value="auto">Auto (720px)</SelectItem>
                <SelectItem value="a4">{pageLabel('a4', 'A4')}</SelectItem>
                <SelectItem value="a5">{pageLabel('a5', 'A5')}</SelectItem>
                <SelectItem value="letter">{pageLabel('letter', 'Letter')}</SelectItem>
              </SelectContent>
            </Select>
          }
        />

        {(contentWidth === 'a4' ||
          contentWidth === 'a5' ||
          contentWidth === 'letter') && (
          <SettingsRow
            label={t("settings.printLayout")}
            description={t("settings.printLayoutDesc")}
            control={
              <Switch
                checked={printLayout}
                onCheckedChange={(v) => { setPrintLayout(v); trackSettingToggle("print_layout", v); }}
              />
            }
          />
        )}

        {/* Page margins — adopts the SettingsRow rhythm (title +
            description in the top stripe, control area below) but
            keeps a 2×2 grid for the four inputs since each side
            label needs to sit beside its input. */}
        <div className="px-0 py-3">
          <span className="text-[13px] font-medium text-foreground">
            Page margins
          </span>
          <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
            Set margins for each side independently ({unitLabel}).
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2">
            {(
              [
                { label: 'Top', value: marginTop, setter: setMarginTop },
                { label: 'Bottom', value: marginBottom, setter: setMarginBottom },
                { label: 'Left', value: marginLeft, setter: setMarginLeft },
                { label: 'Right', value: marginRight, setter: setMarginRight },
              ] as const
            ).map(({ label, value, setter }) => (
              <div key={label} className="flex items-center gap-2">
                <Label className="text-[12px] text-muted-foreground w-12 shrink-0">
                  {label}
                </Label>
                <div className="flex items-center gap-1.5 flex-1">
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={toDisplay(value, measurementUnit)}
                    onChange={(e) => handleMarginInput(e.target.value, setter)}
                    className="h-8 text-[12px]"
                  />
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {unitLabel}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SettingsGroup>
    </>
  );
}
