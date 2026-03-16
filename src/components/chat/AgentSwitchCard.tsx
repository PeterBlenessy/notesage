import { ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useChatStore } from '@/stores/chat-store';

interface AgentSwitchCardProps {
  newAgent: string;
  previousAgent: string;
  resolved?: { historyIncluded: boolean };
}

export function AgentSwitchCard({ newAgent, previousAgent, resolved }: AgentSwitchCardProps) {
  const resolveAgentSwitch = useChatStore((s) => s.resolveAgentSwitch);

  if (resolved) {
    return (
      <div className="mx-4 my-2 px-3 py-2 rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
          <span>
            Switched to <span className="font-medium text-foreground">{newAgent}</span>
            {resolved.historyIncluded && ' (history included)'}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 my-3 p-3 rounded-lg border border-border bg-muted/30">
      <div className="flex items-start gap-2.5">
        <ArrowRightLeft className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" strokeWidth={1.5} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            Provider changed to {newAgent}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Different provider — previous messages won't be shared unless you choose to include history.
          </p>
          {previousAgent && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Previous: {previousAgent}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => resolveAgentSwitch(true)}
            >
              Include history
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => resolveAgentSwitch(false)}
            >
              Start fresh
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
