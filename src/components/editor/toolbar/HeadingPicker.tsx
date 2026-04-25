import type { Editor } from "@tiptap/react";
import { ChevronDown, ArrowUp, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useEditorStylesStore, type BlockType, type BlockTypeStyle } from "@/stores/editor-styles-store";
import { useSettingsStore } from "@/stores/settings-store";

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

// ---------------------------------------------------------------------------
// Local override detection helpers
// ---------------------------------------------------------------------------

const OVERRIDE_ATTRS = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "color"] as const;

function hasLocalOverrides(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  const node = $from.parent;
  if (node.type.name !== "heading" && node.type.name !== "paragraph") return false;
  return OVERRIDE_ATTRS.some((attr) => node.attrs[attr] != null);
}

function getBlockTypeName(editor: Editor): string {
  const { $from } = editor.state.selection;
  const node = $from.parent;
  if (node.type.name === "heading") return `Heading ${node.attrs.level}`;
  if (node.type.name === "paragraph") return "Paragraph";
  return "Block";
}

function getBlockTypeKey(editor: Editor): BlockType | null {
  const { $from } = editor.state.selection;
  const node = $from.parent;
  if (node.type.name === "heading") return `heading${node.attrs.level}` as BlockType;
  if (node.type.name === "paragraph") return "paragraph";
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HeadingPicker({ editor }: { editor: Editor }) {
  const getCurrentLevel = (): number => {
    for (let i = 1; i <= 6; i++) {
      if (editor.isActive("heading", { level: i })) return i;
    }
    return 0;
  };

  const current = getCurrentLevel();
  const currentLabel = HEADING_OPTIONS.find((h) => h.level === current)?.label ?? "Paragraph";
  const overrides = hasLocalOverrides(editor);

  const handleUpdateToMatch = () => {
    const blockType = getBlockTypeKey(editor);
    if (!blockType) return;

    const { $from } = editor.state.selection;
    const node = $from.parent;
    const store = useEditorStylesStore.getState();
    const preset = store.getEffectiveStyle(blockType);

    // Collect effective values: local override if present, otherwise preset value
    const effective: Partial<BlockTypeStyle> = {};
    for (const attr of OVERRIDE_ATTRS) {
      const val = node.attrs[attr];
      effective[attr as keyof BlockTypeStyle] = val ?? (preset as unknown as Record<string, unknown>)[attr];
    }

    // Save as the new preset for this block type
    store.updatePreset(blockType, effective);

    // Clear local overrides on the current node
    editor.commands.clearTypographyOverrides();

    // Persist to disk
    const notesRoot = useSettingsStore.getState().notesRootPath;
    if (notesRoot) {
      store.saveTypography(notesRoot);
    }
  };

  const handleReset = () => {
    editor.commands.clearTypographyOverrides();
  };

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
              {overrides && (
                <span className="ml-0.5 size-1.5 rounded-full bg-foreground/50 shrink-0" />
              )}
              <ChevronDown className="size-3 shrink-0 opacity-50" strokeWidth={1.5} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Block type
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-52">
        {HEADING_OPTIONS.map(({ label, level }) => (
          <DropdownMenuItem
            key={level}
            className={cn(
              "cursor-pointer",
              HEADING_STYLES[level],
              current === level && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]"
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

        {overrides && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-xs gap-2"
              onClick={handleUpdateToMatch}
            >
              <ArrowUp className="size-3.5 shrink-0" strokeWidth={1.5} />
              <span>
                Update &lsquo;{getBlockTypeName(editor)}&rsquo; to match
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer text-xs gap-2"
              onClick={handleReset}
            >
              <RotateCcw className="size-3.5 shrink-0" strokeWidth={1.5} />
              <span>
                Reset to &lsquo;{getBlockTypeName(editor)}&rsquo; style
              </span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
