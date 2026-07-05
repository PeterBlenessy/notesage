import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Small wrapper that adds a consistent React Tooltip (300 ms delay,
 * top-aligned, neutral styling) to a message-action icon button.
 * Mirrors the FloatingCommandBar / CommandBarContext / IconButton
 * pattern so every chrome button in the chat surface looks the same.
 */
export function ActionIconButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className={className}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[220px]">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
