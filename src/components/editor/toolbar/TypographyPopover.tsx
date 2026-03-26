import { useCallback } from "react";
import { RotateCcw, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { useEditorStylesStore, EDITOR_STYLES_DEFAULTS, FONT_PRESETS, fontFamilyCSS, type EditorFontFamily } from "@/stores/editor-styles-store";
import { useSettingsStore } from "@/stores/settings-store";

const SANS_FONTS = FONT_PRESETS.filter((f) => f.category === "sans");
const SERIF_FONTS = FONT_PRESETS.filter((f) => f.category === "serif");
const MONO_FONTS = FONT_PRESETS.filter((f) => f.category === "mono");

export function TypographyPopover() {
  const { fontFamily, fontSize, lineHeight, paragraphSpacing, setFontFamily, setFontSize, setLineHeight, setParagraphSpacing, resetToDefaults, saveSettings } = useEditorStylesStore();
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);

  const save = useCallback(() => {
    if (notesRootPath && !notesRootPath.startsWith("~")) {
      saveSettings(notesRootPath);
    }
  }, [notesRootPath, saveSettings]);

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
      <PopoverContent side="bottom" align="start" className="w-64 p-3 space-y-4">
        {/* Font Family */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Font</Label>
          <Select
            value={fontFamily}
            onValueChange={(value: EditorFontFamily) => {
              setFontFamily(value);
              save();
            }}
          >
            <SelectTrigger className="w-full h-8 text-xs">
              <SelectValue>
                <span style={{ fontFamily: fontFamilyCSS(fontFamily) }}>
                  {FONT_PRESETS.find((f) => f.value === fontFamily)?.label ?? fontFamily}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Sans-serif</SelectLabel>
                {SANS_FONTS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">
                    <span style={{ fontFamily: f.css }}>{f.label}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Serif</SelectLabel>
                {SERIF_FONTS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">
                    <span style={{ fontFamily: f.css }}>{f.label}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Monospace</SelectLabel>
                {MONO_FONTS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">
                    <span style={{ fontFamily: f.css }}>{f.label}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
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
