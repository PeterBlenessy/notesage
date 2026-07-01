import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConnectionsStore } from '@/stores/connections-store';
import { useLocalAIStore } from '@/stores/local-ai-store';

/**
 * Empty-state entry point for the Local Agent setup flow (task #18). Renders a
 * single quiet link only while NO AI connection exists; opens the setup dialog
 * (#17). Disappears the moment any connection is added.
 */
export function LocalAgentSetupPrompt() {
  const hasConnections = useConnectionsStore((s) => s.connections.length > 0);
  const openSetup = useLocalAIStore((s) => s.setLocalAgentSetupDialogOpen);
  if (hasConnections) return null;
  return (
    <Button
      variant="link"
      size="sm"
      onClick={() => openSetup(true)}
      className="mt-3 h-auto gap-1 p-0 text-xs font-medium text-[var(--color-accent-primary)]"
    >
      Set up a private, on-device agent
      <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
    </Button>
  );
}
