import { useCallback, useMemo, useState } from "react";
import { Check, RotateCcw, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { useEditorStylesStore, EDITOR_STYLES_DEFAULTS, FONT_PRESETS, fontFamilyCSS, type EditorFontFamily, type SystemFont } from "@/stores/editor-styles-store";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/utils";

const SANS_PRESETS = FONT_PRESETS.filter((f) => f.category === "sans");
const SERIF_PRESETS = FONT_PRESETS.filter((f) => f.category === "serif");
const MONO_PRESETS = FONT_PRESETS.filter((f) => f.category === "mono");

/** Set of preset font family names (lowercased) to avoid duplicates in system fonts list. */
const PRESET_FAMILY_SET = new Set(
  FONT_PRESETS.flatMap((f) => [f.label.toLowerCase(), ...f.css.split(",").map((s) => s.trim().replace(/"/g, "").toLowerCase())])
);

const MAX_SYSTEM_FONTS = 50;

function isPresetFont(family: string): boolean {
  return PRESET_FAMILY_SET.has(family.toLowerCase());
}

export function TypographyPopover() {
  const { fontFamily, fontSize, lineHeight, paragraphSpacing, systemFonts, setFontFamily, setFontSize, setLineHeight, setParagraphSpacing, resetToDefaults, saveSettings } = useEditorStylesStore();
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const [fontSearch, setFontSearch] = useState("");

  const save = useCallback(() => {
    if (notesRootPath && !notesRootPath.startsWith("~")) {
      saveSettings(notesRootPath);
    }
  }, [notesRootPath, saveSettings]);

  const selectFont = useCallback((value: EditorFontFamily) => {
    setFontFamily(value);
    setFontPickerOpen(false);
    setFontSearch("");
    // Save after a tick so state is committed
    setTimeout(() => {
      if (notesRootPath && !notesRootPath.startsWith("~")) {
        saveSettings(notesRootPath);
      }
    }, 0);
  }, [setFontFamily, notesRootPath, saveSettings]);

  // Group system fonts by category, filtering out presets and limiting results
  const filteredSystemFonts = useMemo(() => {
    const unique = systemFonts.filter((f) => !isPresetFont(f.family));
    if (!fontSearch) return unique.slice(0, MAX_SYSTEM_FONTS);
    const query = fontSearch.toLowerCase();
    return unique.filter((f) => f.family.toLowerCase().includes(query)).slice(0, MAX_SYSTEM_FONTS);
  }, [systemFonts, fontSearch]);

  const systemSans = useMemo(() => filteredSystemFonts.filter((f) => f.category === "sans"), [filteredSystemFonts]);
  const systemSerif = useMemo(() => filteredSystemFonts.filter((f) => f.category === "serif"), [filteredSystemFonts]);
  const systemMono = useMemo(() => filteredSystemFonts.filter((f) => f.category === "mono"), [filteredSystemFonts]);
  const systemOther = useMemo(() => filteredSystemFonts.filter((f) => f.category === "other"), [filteredSystemFonts]);

  const currentFontLabel = FONT_PRESETS.find((f) => f.value === fontFamily)?.label ?? fontFamily;

  const isDefault =
    fontFamily === EDITOR_STYLES_DEFAULTS.fontFamily &&
    fontSize === EDITOR_STYLES_DEFAULTS.fontSize &&
    lineHeight === EDITOR_STYLES_DEFAULTS.lineHeight &&
    paragraphSpacing === EDITOR_STYLES_DEFAULTS.paragraphSpacing;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
            >
              <Type className="size-4" strokeWidth={1.5} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Typography
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="start" className="w-72 p-3 space-y-4">
        {/* Font Family */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Font</Label>
          <Popover open={fontPickerOpen} onOpenChange={setFontPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={fontPickerOpen}
                className="w-full h-8 justify-between text-xs font-normal"
              >
                <span className="truncate" style={{ fontFamily: fontFamilyCSS(fontFamily) }}>
                  {currentFontLabel}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start" side="bottom">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Search fonts..."
                  value={fontSearch}
                  onValueChange={setFontSearch}
                  className="h-8 text-xs"
                />
                <CommandList className="max-h-[60vh]">
                    <CommandEmpty className="py-3 text-center text-xs text-muted-foreground">
                      No fonts found.
                    </CommandEmpty>

                    {/* Presets */}
                    <PresetGroup label="Sans-serif" fonts={SANS_PRESETS} current={fontFamily} onSelect={selectFont} search={fontSearch} />
                    <PresetGroup label="Serif" fonts={SERIF_PRESETS} current={fontFamily} onSelect={selectFont} search={fontSearch} />
                    <PresetGroup label="Monospace" fonts={MONO_PRESETS} current={fontFamily} onSelect={selectFont} search={fontSearch} />

                    {/* System fonts */}
                    {systemSans.length > 0 && (
                      <SystemFontGroup label="System — Sans" fonts={systemSans} current={fontFamily} onSelect={selectFont} />
                    )}
                    {systemSerif.length > 0 && (
                      <SystemFontGroup label="System — Serif" fonts={systemSerif} current={fontFamily} onSelect={selectFont} />
                    )}
                    {systemMono.length > 0 && (
                      <SystemFontGroup label="System — Mono" fonts={systemMono} current={fontFamily} onSelect={selectFont} />
                    )}
                    {systemOther.length > 0 && (
                      <SystemFontGroup label="System — Other" fonts={systemOther} current={fontFamily} onSelect={selectFont} />
                    )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* Font Size */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Size</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{fontSize}px</span>
          </div>
          <Slider
            value={[fontSize]}
            min={12}
            max={24}
            step={1}
            onValueChange={([v]) => setFontSize(v)}
            onValueCommit={() => save()}
          />
        </div>

        {/* Line Height */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Line height</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{lineHeight.toFixed(1)}</span>
          </div>
          <Slider
            value={[lineHeight]}
            min={1.2}
            max={2.2}
            step={0.1}
            onValueChange={([v]) => setLineHeight(Math.round(v * 10) / 10)}
            onValueCommit={() => save()}
          />
        </div>

        {/* Paragraph Spacing */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Paragraph spacing</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{paragraphSpacing.toFixed(2)}em</span>
          </div>
          <Slider
            value={[paragraphSpacing]}
            min={0.25}
            max={1.5}
            step={0.05}
            onValueChange={([v]) => setParagraphSpacing(Math.round(v * 100) / 100)}
            onValueCommit={() => save()}
          />
        </div>

        {/* Reset */}
        {!isDefault && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-xs text-muted-foreground"
            onClick={() => {
              resetToDefaults();
              save();
            }}
          >
            <RotateCcw className="size-3 mr-1.5" strokeWidth={1.5} />
            Reset to defaults
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Render a group of preset fonts, filtered by search query. */
function PresetGroup({
  label,
  fonts,
  current,
  onSelect,
  search,
}: {
  label: string;
  fonts: typeof FONT_PRESETS;
  current: string;
  onSelect: (value: string) => void;
  search: string;
}) {
  const query = search.toLowerCase();
  const filtered = query ? fonts.filter((f) => f.label.toLowerCase().includes(query)) : fonts;
  if (filtered.length === 0) return null;

  return (
    <CommandGroup heading={label}>
      {filtered.map((f) => (
        <CommandItem
          key={f.value}
          value={f.value}
          onSelect={() => onSelect(f.value)}
          className="text-xs flex items-center gap-2 py-1.5"
        >
          <Check className={cn("size-3 shrink-0 self-start mt-0.5", current === f.value ? "opacity-100" : "opacity-0")} strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <span className="block truncate" style={{ fontFamily: f.css }}>{f.label}</span>
            <span className="block truncate text-[10px] text-muted-foreground/60" style={{ fontFamily: f.css }}>
              The quick brown fox jumps over the lazy dog
            </span>
          </div>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

/** Render a group of system fonts. */
function SystemFontGroup({
  label,
  fonts,
  current,
  onSelect,
}: {
  label: string;
  fonts: SystemFont[];
  current: string;
  onSelect: (value: string) => void;
}) {
  return (
    <CommandGroup heading={label}>
      {fonts.map((f) => (
        <CommandItem
          key={f.family}
          value={f.family}
          onSelect={() => onSelect(f.family)}
          className="text-xs flex items-center gap-2 py-1.5"
        >
          <Check className={cn("size-3 shrink-0 self-start mt-0.5", current === f.family ? "opacity-100" : "opacity-0")} strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <span className="block truncate" style={{ fontFamily: `"${f.family}"` }}>{f.family}</span>
            <span className="block truncate text-[10px] text-muted-foreground/60" style={{ fontFamily: `"${f.family}"` }}>
              The quick brown fox jumps over the lazy dog
            </span>
          </div>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
