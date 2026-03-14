import { useState, useMemo, useCallback, useRef } from 'react';
import { RefreshCw, ChevronDown, ChevronRight, CheckSquare2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useActionStore, type ActionItem } from '@/stores/action-store';
import { ActionItemRow } from './ActionItemRow';
import { ActionFilterBar } from './ActionFilterBar';

interface ActionsDashboardProps {
  onActionClick?: (action: ActionItem) => void;
  onToggleAction?: (action: ActionItem) => void;
  embedded?: boolean;
}

function defaultToggle(action: ActionItem) {
  useActionStore.getState().toggleTaskDone(action);
}

export function ActionsDashboard({
  onActionClick,
  onToggleAction,
  embedded = false,
}: ActionsDashboardProps) {
  const isScanning = useActionStore((s) => s.isScanning);
  const fullScan = useActionStore((s) => s.fullScan);
  const actions = useActionStore((s) => s.actions);
  const filter = useActionStore((s) => s.filter);
  const getFilteredActions = useActionStore((s) => s.getFilteredActions);

  const handleToggle = onToggleAction ?? defaultToggle;
  const [completedOpen, setCompletedOpen] = useState(false);

  // Minimum spin duration so the refresh button always visibly animates
  const [spinning, setSpinning] = useState(false);
  const spinTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleRefresh = useCallback(() => {
    setSpinning(true);
    clearTimeout(spinTimer.current);
    fullScan().finally(() => {
      // Keep spinning for at least 600ms total
      spinTimer.current = setTimeout(() => setSpinning(false), 600);
    });
  }, [fullScan]);

  const filtered = useMemo(() => getFilteredActions(), [getFilteredActions, actions, filter]);

  // Split into open and completed
  const openActions = useMemo(
    () => filtered.filter((a) => a.status !== 'done' && a.status !== 'completed'),
    [filtered]
  );
  const completedActions = useMemo(
    () => filtered.filter((a) => a.status === 'done' || a.status === 'completed'),
    [filtered]
  );

  // Group open actions by project
  const groupedOpen = useMemo(() => {
    const map = new Map<string, ActionItem[]>();
    for (const item of openActions) {
      const key = item.project_root ?? 'ungrouped';
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [openActions]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className={`mx-auto w-full ${embedded ? '' : 'max-w-3xl'} flex flex-col h-full`}>
        {/* Fixed header + filters */}
        <div className="shrink-0 px-4 pt-6 pb-3 space-y-3">
          {/* Header */}
          <h2 className="text-lg font-semibold text-foreground">Actions</h2>

          {/* Filter bar + refresh */}
          <ActionFilterBar>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 shrink-0"
              onClick={handleRefresh}
              disabled={isScanning || spinning}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isScanning || spinning ? 'animate-spin' : ''}`} strokeWidth={1.5} />
            </Button>
          </ActionFilterBar>
        </div>

        {/* Scrollable action items */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-4 pb-6">
            {/* Empty state */}
            {openActions.length === 0 && completedActions.length === 0 && (
              <div className="text-center py-12">
                <CheckSquare2 className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" strokeWidth={1} />
                <p className="text-sm text-muted-foreground">No open actions</p>
                <p className="text-xs text-muted-foreground/60 mt-1 max-w-sm mx-auto">
                  Create tasks with &ldquo;- [ ] Task text&rdquo; in any markdown file, or delegate comments to agents.
                </p>
              </div>
            )}

            {/* Open actions grouped by project */}
            {Array.from(groupedOpen.entries()).map(([projectRoot, items]) => {
              const projectName = items[0]?.project_name ?? projectRoot.split('/').pop() ?? 'Files';
              const label = projectRoot === 'ungrouped' ? 'Quick Notes' : projectName;

              return (
                <div key={projectRoot} className="mb-4">
                  <div className="flex items-center gap-2 mb-1 px-1">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {label}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50">
                      ({items.length} open)
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <div className="space-y-0.5">
                    {items.map((action) => (
                      <ActionItemRow
                        key={action.id}
                        action={action}
                        projectRoot={projectRoot !== 'ungrouped' ? projectRoot : undefined}
                        onClick={onActionClick}
                        onToggle={handleToggle}
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Completed section */}
            {completedActions.length > 0 && (
              <Collapsible open={completedOpen} onOpenChange={setCompletedOpen}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-2 w-full px-1 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    {completedOpen ? (
                      <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
                    ) : (
                      <ChevronRight className="h-3 w-3" strokeWidth={1.5} />
                    )}
                    <span className="font-medium uppercase tracking-wider">
                      Completed ({completedActions.length})
                    </span>
                    <div className="flex-1 h-px bg-border" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-0.5">
                    {completedActions.map((action) => (
                      <ActionItemRow
                        key={action.id}
                        action={action}
                        projectRoot={action.project_root ?? undefined}
                        onClick={onActionClick}
                        onToggle={handleToggle}
                      />
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
}
