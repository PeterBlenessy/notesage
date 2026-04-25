import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSettingsStore, type MeasurementUnit } from '@/stores/settings-store';
import { cn } from '@/lib/utils';
import { SettingsGroup } from './SettingsGroup';
import { SettingsRow } from './SettingsRow';

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
 * Editor settings panel (v2) — editor options and page layout.
 *
 * Typography (font, size, line height, paragraph spacing) lives in the
 * AppearanceSettings panel (task #65), not here.
 */
export function EditorSettings() {
  const toolbarVisible = useSettingsStore((s) => s.toolbarVisible);
  const setToolbarVisible = useSettingsStore((s) => s.setToolbarVisible);
  const showFloatingToolbar = useSettingsStore((s) => s.showFloatingToolbar);
  const setShowFloatingToolbar = useSettingsStore((s) => s.setShowFloatingToolbar);
  const externalChangeDiffReview = useSettingsStore((s) => s.externalChangeDiffReview);
  const setExternalChangeDiffReview = useSettingsStore(
    (s) => s.setExternalChangeDiffReview,
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
        label="Editor Options"
        description="Configure your editing experience."
      >
        <SettingsRow
          label="Top Toolbar"
          description="Show the formatting toolbar above the editor."
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
          label="Floating Toolbar"
          description="Show AI actions and comment button when text is selected."
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
          label="Review external diff"
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
              onCheckedChange={setExternalChangeDiffReview}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        label="Page Layout"
        description="Configure page size, units, and margins."
      >
        <SettingsRow
          label="Units"
          description="Measurement unit for dimensions."
          control={
            <div className="flex rounded-md overflow-hidden border border-border">
              {(['cm', 'inch'] as const).map((unit) => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => setMeasurementUnit(unit)}
                  className={cn(
                    'px-3.5 py-1.5 text-xs font-medium transition-colors duration-150 hover:bg-accent',
                    measurementUnit === unit
                      ? 'bg-[var(--color-accent-primary)]/12 text-foreground'
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
          label="Page Size"
          description="Page format and dimensions."
          control={
            <Select value={contentWidth} onValueChange={setContentWidth}>
              <SelectTrigger className="w-64 text-left">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full Width</SelectItem>
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
            label="Print Layout"
            description="Show page boundaries with headers and footers."
            control={
              <Switch
                checked={printLayout}
                onCheckedChange={setPrintLayout}
              />
            }
          />
        )}

        <div className="px-4 py-3">
          <div className="mb-3">
            <Label className="text-[13px] font-medium text-foreground">
              Page Margins
            </Label>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              Set margins for each side independently ({unitLabel}).
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {(
              [
                { label: 'Top', value: marginTop, setter: setMarginTop },
                { label: 'Bottom', value: marginBottom, setter: setMarginBottom },
                { label: 'Left', value: marginLeft, setter: setMarginLeft },
                { label: 'Right', value: marginRight, setter: setMarginRight },
              ] as const
            ).map(({ label, value, setter }) => (
              <div key={label} className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground w-12 shrink-0">
                  {label}
                </Label>
                <div className="flex items-center gap-1.5 flex-1">
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    value={toDisplay(value, measurementUnit)}
                    onChange={(e) => handleMarginInput(e.target.value, setter)}
                    className="h-8 text-xs"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">
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
