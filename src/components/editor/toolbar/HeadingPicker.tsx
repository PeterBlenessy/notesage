import type { Editor } from "@tiptap/react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

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

export function HeadingPicker({ editor }: { editor: Editor }) {
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
