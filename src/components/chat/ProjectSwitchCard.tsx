import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/stores/chat-store';
const basename = (p: string) => p.split('/').pop() || p;

interface ProjectSwitchCardProps {
  newPaths: string[];
  previousPaths: string[];
  resolved?: { historyIncluded: boolean };
}

export function ProjectSwitchCard({ newPaths, previousPaths, resolved }: ProjectSwitchCardProps) {
  const resolveProjectSwitch = useChatStore((s) => s.resolveProjectSwitch);

  const newNames = newPaths.map((p) => basename(p));
  const prevNames = previousPaths.map((p) => basename(p));

  const label = newNames.length === 1
    ? newNames[0]
    : `${newNames.length} projects`;

  if (resolved) {
    // Already resolved — show read-only summary
    return (
      <div className="mx-4 my-2 px-3 py-2 rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span>
            Context switched to <span className="font-medium text-foreground">{label}</span>
            {resolved.historyIncluded && ' (history included)'}
          </span>
        </div>
      </div>
    );
  }

  // Pending — show prompt with buttons
  return (
    <div className="mx-4 my-3 p-3 rounded-lg border border-border bg-muted/30">
      <div className="flex items-start gap-2.5">
        <FolderOpen className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.5} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            Project changed to {label}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Previous messages won't be shared with the agent.
          </p>
          {prevNames.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Previous: {prevNames.join(', ')}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => resolveProjectSwitch(true)}
            >
              Include history
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => resolveProjectSwitch(false)}
            >
              Start fresh
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
