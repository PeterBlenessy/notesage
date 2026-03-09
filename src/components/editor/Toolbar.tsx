import { useCallback, useEffect, useRef } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "disabled:opacity-30 active:scale-90",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground"
      )}
    >
      {children}
    </Button>
  );
}

function ToolbarSeparator() {
  return <Separator orientation="vertical" className="h-4 mx-0.5" />;
}

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
      <TooltipProvider delayDuration={300}>
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
      </TooltipProvider>
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
    <TooltipProvider delayDuration={300}>
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
    </TooltipProvider>
  );
}

export function Toolbar({ editor, onImageInsert, viewMode = "wysiwyg", onToggleViewMode, sourceWordWrap, onToggleWordWrap }: ToolbarProps) {
  const isSource = viewMode === "source";

  const insertTable = () => {
    editor
      ?.chain()
      .focus()
      .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
      .run();
  };

  return (
    <div
      className="h-9 px-2 flex items-center gap-0.5 overflow-x-auto overflow-y-hidden flex-1 min-w-0"
    >
      {!isSource && editor && (
        <>
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

          <ToolbarButton
            onClick={insertTable}
            active={editor.isActive("table")}
            title="Insert Table"
          >
            <Table className="size-4" strokeWidth={1.5} />
          </ToolbarButton>

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
        <TooltipProvider delayDuration={300}>
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
        </TooltipProvider>
      )}

      {/* Spacer pushes toggle to the right */}
      <span className="flex-1" />

      {/* View mode toggle */}
      {onToggleViewMode && (
        <TooltipProvider delayDuration={300}>
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
        </TooltipProvider>
      )}
    </div>
  );
}
