import { useConnectionsStore } from '@/stores/connections-store';
import { useRoutingStore } from '@/stores/routing-store';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronRight } from 'lucide-react';
import type { AICapability } from '@/lib/ai/connections';
import { ROUTING_SLOT_LABELS } from '@/lib/ai/connections';

const USE_CASES: AICapability[] = ['interactive', 'agent_tasks', 'inline_completion'];

/** Sentinel value for the "Not configured" select option */
const NONE = '__none__';

export function UseCaseRoutingSettings() {
  const connections = useConnectionsStore((s) => s.connections);
  const routing = useRoutingStore((s) => s.routing);
  const setRouting = useRoutingStore((s) => s.setRouting);

  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-2 w-full text-left py-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors duration-150">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" strokeWidth={1.5} />
        Advanced Routing
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pt-2 pb-1 space-y-2">
          <p className="text-xs text-muted-foreground mb-3">
            Override which connection handles each use case. By default,
            connections are auto-assigned when added.
          </p>
          {USE_CASES.map((useCase) => {
            const meta = ROUTING_SLOT_LABELS[useCase];
            const currentId = routing[useCase];
            const compatible = connections.filter((c) =>
              c.capabilities.includes(useCase)
            );

            return (
              <div
                key={useCase}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border hover:border-muted-foreground/50 transition-colors duration-150"
              >
                <div className="min-w-0">
                  <span className="text-sm font-medium">{meta.label}</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {meta.description}
                  </p>
                </div>

                <Select
                  value={currentId ?? NONE}
                  onValueChange={(val) =>
                    setRouting(useCase, val === NONE ? null : val)
                  }
                >
                  <SelectTrigger className="w-48 shrink-0 text-left">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>
                      <span className="text-muted-foreground">Not configured</span>
                    </SelectItem>
                    {compatible.map((conn) => (
                      <SelectItem key={conn.id} value={conn.id}>
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                              conn.status === 'connected'
                                ? 'bg-green-500'
                                : conn.status === 'error'
                                  ? 'bg-destructive'
                                  : 'bg-muted-foreground'
                            }`}
                          />
                          {conn.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
