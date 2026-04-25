import type { Editor } from "@tiptap/react";
import { Info, Lightbulb, TriangleAlert, CircleAlert, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { CalloutType } from "@/components/editor/extensions/callout";

const CALLOUT_OPTIONS: { type: CalloutType; label: string; icon: typeof Info }[] = [
  { type: "note", label: "Note", icon: Info },
  { type: "tip", label: "Tip", icon: Lightbulb },
  { type: "warning", label: "Warning", icon: TriangleAlert },
  { type: "important", label: "Important", icon: CircleAlert },
];

export function CalloutPicker({ editor }: { editor: Editor }) {
  const isActive = editor.isActive("callout");

  const getCurrentType = (): CalloutType | null => {
    for (const { type } of CALLOUT_OPTIONS) {
      if (editor.isActive("callout", { type })) return type;
    }
    return isActive ? "note" : null;
  };

  const currentType = getCurrentType();

  const handleSelect = (type: CalloutType) => {
    if (isActive) {
      editor.chain().focus().updateCalloutType(type).run();
    } else {
      editor.chain().focus().setCallout({ type }).run();
    }
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                "gap-0",
                isActive
                  ? "bg-[var(--color-accent-primary)]/12 text-foreground"
                  : "text-muted-foreground"
              )}
            >
              <Info className="size-4" strokeWidth={1.5} />
              <ChevronDown className="size-2.5 opacity-50" strokeWidth={1.5} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Callout
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-40">
        {CALLOUT_OPTIONS.map(({ type, label, icon: Icon }) => (
          <DropdownMenuItem
            key={type}
            className={cn(
              "cursor-pointer gap-2 text-xs",
              currentType === type && "bg-[var(--color-accent-primary)]/12"
            )}
            onClick={() => handleSelect(type)}
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.5} />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
