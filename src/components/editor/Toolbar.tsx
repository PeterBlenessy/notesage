import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  CodeSquare,
  Minus,
  Table,
  Image as ImageIcon,
  Undo,
  Redo,
  FileCode,
  FileText,
  WrapText,
  Type,
  RotateCcw,
  Mic,
  MicOff,
  AlignLeft,
  AlignCenter,
  AlignRight,
  IndentIncrease,
  IndentDecrease,
  ChevronDown,
  Baseline,
  Highlighter,
  X,
  Settings2,
} from "lucide-react";
import { TableToolbarContent } from "./TableToolbar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useEditorStylesStore, EDITOR_STYLES_DEFAULTS, FONT_PRESETS, fontFamilyCSS, type EditorFontFamily } from "@/stores/editor-styles-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { ViewMode } from "@/lib/file-utils";

interface ToolbarProps {
  editor: Editor | null;
  onImageInsert?: () => void;
  viewMode?: ViewMode;
  onToggleViewMode?: () => void;
  sourceWordWrap?: boolean;
  onToggleWordWrap?: () => void;
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClick}
          disabled={disabled}
          className={cn(
            "disabled:opacity-30 active:scale-90",
            active
              ? "bg-accent text-foreground"
              : "text-muted-foreground"
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {title}
      </TooltipContent>
    </Tooltip>
  );
}

function ToolbarSeparator() {
  return <Separator orientation="vertical" className="h-4 mx-0.5" />;
}

// --- Heading Level Picker (Task #1) ---

const HEADING_OPTIONS = [
  { label: "Paragraph", level: 0 },
  { label: "Heading 1", level: 1 },
  { label: "Heading 2", level: 2 },
  { label: "Heading 3", level: 3 },
  { label: "Heading 4", level: 4 },
  { label: "Heading 5", level: 5 },
  { label: "Heading 6", level: 6 },
] as const;

const HEADING_STYLES: Record<number, string> = {
  0: "text-xs",
  1: "text-base font-bold",
  2: "text-sm font-semibold",
  3: "text-[13px] font-semibold",
  4: "text-xs font-semibold",
  5: "text-[11px] font-medium uppercase tracking-wider",
  6: "text-[10px] font-medium uppercase tracking-wider",
};

function HeadingPicker({ editor }: { editor: Editor }) {
  const getCurrentLevel = (): number => {
    for (let i = 1; i <= 6; i++) {
      if (editor.isActive("heading", { level: i })) return i;
    }
    return 0;
  };

  const current = getCurrentLevel();
  const currentLabel = HEADING_OPTIONS.find((h) => h.level === current)?.label ?? "Paragraph";

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground gap-0.5 font-medium min-w-[80px] justify-between"
            >
              <span className="truncate">{currentLabel}</span>
              <ChevronDown className="size-3 shrink-0 opacity-50" strokeWidth={1.5} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Block type
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-44">
        {HEADING_OPTIONS.map(({ label, level }) => (
          <DropdownMenuItem
            key={level}
            className={cn(
              "cursor-pointer",
              HEADING_STYLES[level],
              current === level && "bg-accent"
            )}
            onClick={() => {
              if (level === 0) {
                editor.chain().focus().setParagraph().run();
              } else {
                editor.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 }).run();
              }
            }}
          >
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// --- Text Color & Highlight Popovers (Task #7) ---

const TEXT_COLORS = [
  { label: "Default", value: null },
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Yellow", value: "#eab308" },
  { label: "Green", value: "#22c55e" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Purple", value: "#a855f7" },
  { label: "Grey", value: "#6b7280" },
] as const;

const HIGHLIGHT_COLORS = [
  { label: "None", light: null, dark: null },
  { label: "Yellow", light: "#fef08a", dark: "#854d0e" },
  { label: "Green", light: "#bbf7d0", dark: "#166534" },
  { label: "Blue", light: "#bfdbfe", dark: "#1e40af" },
  { label: "Pink", light: "#fbcfe8", dark: "#9d174d" },
  { label: "Orange", light: "#fed7aa", dark: "#9a3412" },
  { label: "Grey", light: "#e5e7eb", dark: "#374151" },
] as const;

function TextColorPopover({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);

  // Get current text color from editor
  const currentColor = editor.getAttributes("textStyle")?.color as string | undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground relative"
            >
              <Baseline className="size-4" strokeWidth={1.5} />
              <span
                className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-0.5 w-3 rounded-full"
                style={{ backgroundColor: currentColor || "currentColor" }}
              />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Text color
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="start" className="w-[180px] p-2">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
          Text Color
        </p>
        <div className="grid grid-cols-8 gap-1">
          {TEXT_COLORS.map(({ label, value }) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    "size-5 rounded-full border border-border transition-transform hover:scale-125 focus:outline-none focus:ring-1 focus:ring-ring",
                    !value && "flex items-center justify-center",
                    currentColor === value && "ring-1 ring-foreground ring-offset-1 ring-offset-background"
                  )}
                  style={value ? { backgroundColor: value } : undefined}
                  onClick={() => {
                    if (value) {
                      editor.chain().focus().setColor(value).run();
                    } else {
                      editor.chain().focus().unsetColor().run();
                    }
                    setOpen(false);
                  }}
                >
                  {!value && <X className="size-3 text-muted-foreground" strokeWidth={1.5} />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function HighlightPopover({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const isDark = document.documentElement.classList.contains("dark");

  const currentHighlight = editor.getAttributes("highlight")?.color as string | undefined;

  // Check if current highlight matches either light or dark variant of a color
  const isActiveColor = (light: string | null, dark: string | null) =>
    currentHighlight === light || currentHighlight === dark;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                "text-muted-foreground relative",
                currentHighlight && "text-foreground"
              )}
            >
              <Highlighter className="size-4" strokeWidth={1.5} />
              {currentHighlight && (
                <span
                  className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-0.5 w-3 rounded-full"
                  style={{ backgroundColor: currentHighlight }}
                />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Highlight
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="start" className="w-[180px] p-2">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
          Highlight
        </p>
        <div className="grid grid-cols-7 gap-1">
          {HIGHLIGHT_COLORS.map(({ label, light, dark }) => {
            const swatchColor = isDark ? dark : light;
            const applyColor = isDark ? dark : light;
            return (
              <Tooltip key={label}>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      "size-5 rounded border border-border transition-transform hover:scale-125 focus:outline-none focus:ring-1 focus:ring-ring",
                      !swatchColor && "flex items-center justify-center",
                      isActiveColor(light, dark) && "ring-1 ring-foreground ring-offset-1 ring-offset-background"
                    )}
                    style={swatchColor ? { backgroundColor: swatchColor } : undefined}
                    onClick={() => {
                      if (applyColor) {
                        editor.chain().focus().toggleHighlight({ color: applyColor }).run();
                      } else {
                        editor.chain().focus().unsetHighlight().run();
                      }
                      setOpen(false);
                    }}
                  >
                    {!swatchColor && <X className="size-3 text-muted-foreground" strokeWidth={1.5} />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --- Typography Popover ---

const SANS_FONTS = FONT_PRESETS.filter((f) => f.category === "sans");
const SERIF_FONTS = FONT_PRESETS.filter((f) => f.category === "serif");
const MONO_FONTS = FONT_PRESETS.filter((f) => f.category === "mono");

function TypographyPopover() {
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

// --- Mic Button ---

function MicButton({ editor }: { editor: Editor | null }) {
  const { startDictation, stopDictation, isDictating, finalText } = useSpeechRecognition();
  const prevFinalTextRef = useRef(finalText);

  // Insert final dictation text at cursor
  useEffect(() => {
    if (finalText && finalText !== prevFinalTextRef.current && editor) {
      editor.chain().focus().insertContent(finalText).run();
    }
    prevFinalTextRef.current = finalText;
  }, [finalText, editor]);

  const handleToggle = useCallback(async () => {
    if (isDictating) {
      await stopDictation();
    } else {
      await startDictation();
    }
  }, [isDictating, startDictation, stopDictation]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleToggle}
          disabled={!editor}
          className={cn(
            "active:scale-90",
            isDictating
              ? "text-red-500 animate-pulse"
              : "text-muted-foreground"
          )}
        >
          {isDictating ? (
            <MicOff className="size-4" strokeWidth={1.5} />
          ) : (
            <Mic className="size-4" strokeWidth={1.5} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {isDictating ? "Stop dictation" : "Start dictation"}
      </TooltipContent>
    </Tooltip>
  );
}

// --- Table Tools Popover (appears next to Insert Table when cursor is in a table) ---

function TableToolsPopover({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                "text-muted-foreground",
                open && "bg-accent text-foreground"
              )}
            >
              <Settings2 className="size-3.5" strokeWidth={1.5} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Table tools
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-auto p-0 rounded-lg border border-border bg-popover shadow-lg backdrop-blur-sm"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <TableToolbarContent editor={editor} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

// --- Main Toolbar ---

export function Toolbar({ editor, onImageInsert, viewMode = "wysiwyg", onToggleViewMode, sourceWordWrap, onToggleWordWrap }: ToolbarProps) {
  const isSource = viewMode === "source";

  const insertTable = () => {
    editor
      ?.chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  };

  const isInList = editor
    ? editor.isActive("bulletList") || editor.isActive("orderedList") || editor.isActive("taskList")
    : false;

  return (
    <TooltipProvider delayDuration={300}>
    <div
      className="h-9 px-2 flex items-center gap-0.5 overflow-x-auto overflow-y-hidden flex-1 min-w-0"
    >
      {!isSource && editor && (
        <>
          {/* Heading Level Picker */}
          <HeadingPicker editor={editor} />

          <ToolbarSeparator />

          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="Undo (Cmd+Z)"
          >
            <Undo className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="Redo (Cmd+Shift+Z)"
          >
            <Redo className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive("bold")}
            title="Bold (Cmd+B)"
          >
            <Bold className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive("italic")}
            title="Italic (Cmd+I)"
          >
            <Italic className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive("underline")}
            title="Underline (Cmd+U)"
          >
            <Underline className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive("strike")}
            title="Strikethrough (Cmd+Shift+X)"
          >
            <Strikethrough className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCode().run()}
            active={editor.isActive("code")}
            title="Code (Cmd+E)"
          >
            <Code className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          {/* Text Color & Highlight */}
          <TextColorPopover editor={editor} />
          <HighlightPopover editor={editor} />

          <ToolbarSeparator />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive("bulletList")}
            title="Bullet List"
          >
            <List className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive("orderedList")}
            title="Numbered List"
          >
            <ListOrdered className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            active={editor.isActive("taskList")}
            title="Task List"
          >
            <ListChecks className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          {/* Indent / Outdent */}
          <ToolbarButton
            onClick={() => {
              if (editor.isActive("taskList")) {
                editor.chain().focus().sinkListItem("taskItem").run();
              } else {
                editor.chain().focus().sinkListItem("listItem").run();
              }
            }}
            disabled={!isInList}
            title="Indent (Tab)"
          >
            <IndentIncrease className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => {
              if (editor.isActive("taskList")) {
                editor.chain().focus().liftListItem("taskItem").run();
              } else {
                editor.chain().focus().liftListItem("listItem").run();
              }
            }}
            disabled={!isInList}
            title="Outdent (Shift+Tab)"
          >
            <IndentDecrease className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive("blockquote")}
            title="Blockquote"
          >
            <Quote className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            active={editor.isActive("codeBlock")}
            title="Code Block"
          >
            <CodeSquare className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title="Horizontal Rule"
          >
            <Minus className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarSeparator />

          {/* Alignment */}
          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
            active={editor.isActive({ textAlign: "left" })}
            title="Align left"
          >
            <AlignLeft className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
            active={editor.isActive({ textAlign: "center" })}
            title="Align center"
          >
            <AlignCenter className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
            active={editor.isActive({ textAlign: "right" })}
            title="Align right"
          >
            <AlignRight className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            onClick={insertTable}
            active={editor.isActive("table")}
            title="Insert Table"
          >
            <Table className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          {/* Table editing tools — only visible when cursor is inside a table */}
          {editor.isActive("table") && (
            <TableToolsPopover editor={editor} />
          )}

          <ToolbarButton
            onClick={() => onImageInsert?.()}
            title="Insert Image"
          >
            <ImageIcon className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

          <ToolbarSeparator />

          <TypographyPopover />

          <ToolbarSeparator />

          <MicButton editor={editor} />
        </>
      )}
      {isSource && onToggleWordWrap && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onToggleWordWrap}
              className={cn(
                sourceWordWrap
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground"
              )}
            >
              <WrapText className="size-4" strokeWidth={1.5} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Word Wrap (Alt+Z)
          </TooltipContent>
        </Tooltip>
      )}

      {/* Spacer pushes toggle to the right */}
      <span className="flex-1" />

      {/* View mode toggle */}
      {onToggleViewMode && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onToggleViewMode}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                isSource && "bg-accent text-foreground"
              )}
            >
              {isSource ? (
                <FileText className="size-4" strokeWidth={1.5} />
              ) : (
                <FileCode className="size-4" strokeWidth={1.5} />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {isSource ? "Switch to Rich text (Cmd+Shift+/)" : "Switch to Raw (Cmd+Shift+/)"}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
    </TooltipProvider>
  );
}
