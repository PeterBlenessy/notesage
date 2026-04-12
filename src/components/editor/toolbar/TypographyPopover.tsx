import { useCallback, useMemo, useState } from "react";
import { Check, FileDown, RotateCcw, Type } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  useEditorStylesStore,
  FONT_PRESETS,
  fontFamilyCSS,
  type EditorFontFamily,
  type SystemFont,
  type BlockTypeStyle,
  type TypographyPresets,
} from "@/stores/editor-styles-store";
import { useEditorStore } from "@/stores/editor-store";
import { presetsToDocumentStyle } from "@/lib/frontmatter";
import { type FullBlockType } from "@/lib/typography-presets";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SANS_PRESETS = FONT_PRESETS.filter((f) => f.category === "sans");
const SERIF_PRESETS = FONT_PRESETS.filter((f) => f.category === "serif");
const MONO_PRESETS = FONT_PRESETS.filter((f) => f.category === "mono");

/** Set of preset font family names (lowercased) to avoid duplicates in system fonts list. */
const PRESET_FAMILY_SET = new Set(
  FONT_PRESETS.flatMap((f) => [f.label.toLowerCase(), ...f.css.split(",").map((s) => s.trim().replace(/"/g, "").toLowerCase())])
);

const MAX_SYSTEM_FONTS = 50;

/** Human-readable labels for block types. */
const BLOCK_TYPE_LABELS: Record<string, string> = {
  paragraph: "Paragraph",
  heading1: "Heading 1",
  heading2: "Heading 2",
  heading3: "Heading 3",
  heading4: "Heading 4",
  heading5: "Heading 5",
  heading6: "Heading 6",
};

/** Font weight options. */
const FONT_WEIGHTS = [
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
] as const;

function isPresetFont(family: string): boolean {
  return PRESET_FAMILY_SET.has(family.toLowerCase());
}

// ---------------------------------------------------------------------------
// Block type & effective style helpers
// ---------------------------------------------------------------------------

/** Determine the current block type from the editor selection. */
function getCurrentBlockType(editor: Editor | null): FullBlockType | null {
  if (!editor) return null;
  const { $from } = editor.state.selection;
  const node = $from.parent;
  if (node.type.name === "heading") {
    const level = node.attrs.level as number;
    return `heading${level}` as FullBlockType;
  }
  if (node.type.name === "paragraph") {
    return "paragraph";
  }
  return null;
}

/** Get the effective style for the current block (preset + local overrides). */
function getEffectiveStyle(
  editor: Editor | null,
  presets: TypographyPresets,
): BlockTypeStyle | null {
  if (!editor) return null;
  const { $from } = editor.state.selection;
  const node = $from.parent;
  const blockType = getCurrentBlockType(editor);
  if (!blockType) return null;

  const preset = presets[blockType as keyof TypographyPresets];
  const baseStyle: BlockTypeStyle = {
    fontFamily: preset.fontFamily,
    fontSize: preset.fontSize,
    fontWeight: "fontWeight" in preset ? (preset as BlockTypeStyle).fontWeight : 400,
    lineHeight: "lineHeight" in preset ? (preset as BlockTypeStyle).lineHeight : 1.7,
    spacingBefore: "spacingBefore" in preset ? (preset as BlockTypeStyle).spacingBefore : 0,
    spacingAfter: "spacingAfter" in preset ? (preset as BlockTypeStyle).spacingAfter : 0,
  };

  // Overlay local overrides from node attrs
  return {
    ...baseStyle,
    ...(node.attrs.fontFamily != null ? { fontFamily: node.attrs.fontFamily as string } : {}),
    ...(node.attrs.fontSize != null ? { fontSize: node.attrs.fontSize as number } : {}),
    ...(node.attrs.fontWeight != null ? { fontWeight: node.attrs.fontWeight as number } : {}),
    ...(node.attrs.lineHeight != null ? { lineHeight: node.attrs.lineHeight as number } : {}),
  };
}

/** Apply a local override to the current node via ProseMirror transaction.
 *  When `skipHistory` is true, the change is excluded from undo history
 *  (used for intermediate slider drags — the final value is committed separately). */
function setOverride(editor: Editor, attr: string, value: unknown, skipHistory = false): void {
  const { state } = editor.view;
  const { $from } = state.selection;
  const node = $from.parent;
  if (node.type.name !== "heading" && node.type.name !== "paragraph") return;
  const pos = $from.before($from.depth);
  let tr = state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: value });
  if (skipHistory) tr = tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

/** Commit the current override value to history (call on slider release). */
function commitOverride(editor: Editor, attr: string, value: unknown): void {
  setOverride(editor, attr, value, false);
}

/** Get appropriate font size range based on block type. */
function getFontSizeRange(blockType: FullBlockType | null): { min: number; max: number } {
  if (!blockType) return { min: 10, max: 24 };
  if (blockType === "paragraph") return { min: 10, max: 24 };
  // Headings get larger max range
  if (blockType === "heading1") return { min: 10, max: 48 };
  if (blockType === "heading2") return { min: 10, max: 40 };
  if (blockType === "heading3") return { min: 10, max: 36 };
  return { min: 10, max: 32 };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TypographyPopoverProps {
  editor: Editor | null;
}

export function TypographyPopover({ editor }: TypographyPopoverProps) {
  const { systemFonts, presets } = useEditorStylesStore();
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const [fontSearch, setFontSearch] = useState("");

  // Derive block type and effective style from editor selection
  const blockType = editor ? getCurrentBlockType(editor) : null;
  const effectiveStyle = editor ? getEffectiveStyle(editor, presets) : null;
  const blockLabel = blockType ? BLOCK_TYPE_LABELS[blockType] ?? blockType : null;
  const fontSizeRange = getFontSizeRange(blockType);

  // Font picker callbacks
  const selectFont = useCallback((value: EditorFontFamily) => {
    if (!editor) return;
    setOverride(editor, "fontFamily", value);
    setFontPickerOpen(false);
    setFontSearch("");
  }, [editor]);

  // Group system fonts by category, filtering out presets and limiting results
  const filteredSystemFonts = useMemo(() => {
    const unique = (systemFonts ?? []).filter((f) => !isPresetFont(f.family));
    if (!fontSearch) return unique.slice(0, MAX_SYSTEM_FONTS);
    const query = fontSearch.toLowerCase();
    return unique.filter((f) => f.family.toLowerCase().includes(query)).slice(0, MAX_SYSTEM_FONTS);
  }, [systemFonts, fontSearch]);

  const systemSans = useMemo(() => filteredSystemFonts.filter((f) => f.category === "sans"), [filteredSystemFonts]);
  const systemSerif = useMemo(() => filteredSystemFonts.filter((f) => f.category === "serif"), [filteredSystemFonts]);
  const systemMono = useMemo(() => filteredSystemFonts.filter((f) => f.category === "mono"), [filteredSystemFonts]);
  const systemOther = useMemo(() => filteredSystemFonts.filter((f) => f.category === "other"), [filteredSystemFonts]);

  const currentFontFamily = effectiveStyle?.fontFamily ?? "system";
  const currentFontLabel = FONT_PRESETS.find((f) => f.value === currentFontFamily)?.label ?? currentFontFamily;

  // Check if current block has any local overrides
  const hasOverrides = useMemo(() => {
    if (!editor || !blockType) return false;
    const { $from } = editor.state.selection;
    const node = $from.parent;
    return (
      node.attrs.fontFamily != null ||
      node.attrs.fontSize != null ||
      node.attrs.fontWeight != null ||
      node.attrs.lineHeight != null ||
      node.attrs.color != null
    );
  }, [editor, blockType]);

  // Reset local overrides on the current block
  const resetOverrides = useCallback(() => {
    if (!editor) return;
    editor.commands.clearTypographyOverrides();
  }, [editor]);

  // If no editor or unsupported block type, show a disabled state
  const isDisabled = !editor || !blockType || !effectiveStyle;

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
      <PopoverContent side="bottom" align="start" className="w-72 p-3 space-y-3">
        {isDisabled ? (
          <p className="text-xs text-muted-foreground text-center py-2">
            Place cursor in a paragraph or heading to edit typography.
          </p>
        ) : (
          <>
            {/* Block type label */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">{blockLabel}</span>
              {hasOverrides && (
                <span className="text-[10px] text-muted-foreground/70">Modified</span>
              )}
            </div>

            <Separator />

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
                    <span className="truncate" style={{ fontFamily: fontFamilyCSS(currentFontFamily) }}>
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
                      <PresetGroup label="Sans-serif" fonts={SANS_PRESETS} current={currentFontFamily} onSelect={selectFont} search={fontSearch} />
                      <PresetGroup label="Serif" fonts={SERIF_PRESETS} current={currentFontFamily} onSelect={selectFont} search={fontSearch} />
                      <PresetGroup label="Monospace" fonts={MONO_PRESETS} current={currentFontFamily} onSelect={selectFont} search={fontSearch} />

                      {/* System fonts */}
                      {systemSans.length > 0 && (
                        <SystemFontGroup label="System — Sans" fonts={systemSans} current={currentFontFamily} onSelect={selectFont} />
                      )}
                      {systemSerif.length > 0 && (
                        <SystemFontGroup label="System — Serif" fonts={systemSerif} current={currentFontFamily} onSelect={selectFont} />
                      )}
                      {systemMono.length > 0 && (
                        <SystemFontGroup label="System — Mono" fonts={systemMono} current={currentFontFamily} onSelect={selectFont} />
                      )}
                      {systemOther.length > 0 && (
                        <SystemFontGroup label="System — Other" fonts={systemOther} current={currentFontFamily} onSelect={selectFont} />
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
                <span className="text-xs tabular-nums text-muted-foreground">
                  {effectiveStyle.fontSize}px
                </span>
              </div>
              <Slider
                value={[effectiveStyle.fontSize]}
                min={fontSizeRange.min}
                max={fontSizeRange.max}
                step={1}
                onValueChange={([v]) => setOverride(editor, "fontSize", v, true)}
                onValueCommit={([v]) => commitOverride(editor, "fontSize", v)}
              />
            </div>

            {/* Font Weight */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Weight</Label>
              <Select
                value={String(effectiveStyle.fontWeight)}
                onValueChange={(v) => setOverride(editor, "fontWeight", Number(v))}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_WEIGHTS.map((w) => (
                    <SelectItem key={w.value} value={w.value} className="text-xs">
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Line Height */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Line height</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {effectiveStyle.lineHeight.toFixed(1)}
                </span>
              </div>
              <Slider
                value={[effectiveStyle.lineHeight]}
                min={1.0}
                max={3.0}
                step={0.1}
                onValueChange={([v]) => setOverride(editor, "lineHeight", Math.round(v * 10) / 10, true)}
                onValueCommit={([v]) => commitOverride(editor, "lineHeight", Math.round(v * 10) / 10)}
              />
            </div>

            {/* Reset local overrides */}
            {hasOverrides && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full h-7 text-xs text-muted-foreground"
                onClick={resetOverrides}
              >
                <RotateCcw className="size-3 mr-1.5" strokeWidth={1.5} />
                Reset to {blockLabel} style
              </Button>
            )}

            {/* Document style actions */}
            <DocumentStyleActions />
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Document style actions
// ---------------------------------------------------------------------------

/** Save current presets to document frontmatter or reset to global style. */
function DocumentStyleActions() {
  const presets = useEditorStylesStore((s) => s.presets);
  const setDocumentPresets = useEditorStylesStore((s) => s.setDocumentPresets);

  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const activeTab = activeTabId ? tabs.find((t) => t.id === activeTabId) : null;

  // Only show for markdown files that have a tab
  const isMarkdown = activeTab?.filePath?.endsWith(".md");
  if (!activeTab || !isMarkdown) return null;

  const hasDocumentStyle = activeTab.frontmatter?.style != null;

  const handleSave = () => {
    const style = presetsToDocumentStyle(presets);
    useEditorStore.getState().updateFrontmatter(activeTab.id, { style });
    toast.success("Style saved to document");
  };

  const handleReset = () => {
    if (!activeTab.frontmatter) return;
    const updated = { ...activeTab.frontmatter };
    delete updated.style;
    // If frontmatter is now empty, set to null; otherwise set the cleaned object
    const hasKeys = Object.keys(updated).length > 0;
    useEditorStore.getState().setFrontmatter(activeTab.id, hasKeys ? updated : null);
    setDocumentPresets(null);
    toast.success("Reset to global style");
  };

  return (
    <>
      <Separator />
      <div className="space-y-1">
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-7 text-xs text-muted-foreground justify-start"
          onClick={handleSave}
        >
          <FileDown className="size-3 mr-1.5" strokeWidth={1.5} />
          Save as document style
        </Button>
        {hasDocumentStyle && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-xs text-muted-foreground justify-start"
            onClick={handleReset}
          >
            <RotateCcw className="size-3 mr-1.5" strokeWidth={1.5} />
            Reset to global style
          </Button>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

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
