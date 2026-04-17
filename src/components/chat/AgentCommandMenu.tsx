import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useSkillStore, type AgentEntry } from '@/stores/skill-store';
import { AgentIcon } from '@/components/AgentIcon';
import { cn } from '@/lib/utils';

/** Map agent source to a short display label. */
function getSourceLabel(source: string): string | null {
  switch (source) {
    case 'claude': return 'claude';
    case 'github': return 'github';
    case 'gemini': return 'gemini';
    case 'codex': return 'codex';
    case 'copilot': return 'copilot';
    case 'notesage-project': return 'project';
    case 'notesage-global': return 'global';
    default: return null;
  }
}

function AgentSourceBadge({ source }: { source: string }) {
  const label = getSourceLabel(source);
  if (!label) return null;
  return (
    <span className="text-[10px] text-muted-foreground/60 font-normal shrink-0">{label}</span>
  );
}

export interface AgentCommandMenuHandle {
  /** Handle a keydown event. Returns true if the event was consumed. */
  handleKeyDown(e: React.KeyboardEvent): boolean;
}

interface AgentCommandMenuProps {
  query: string;
  onSelect: (agent: AgentEntry) => void;
  onClose: () => void;
}

export const AgentCommandMenu = forwardRef<AgentCommandMenuHandle, AgentCommandMenuProps>(
  function AgentCommandMenu({ query, onSelect, onClose }, ref) {
    const getUserInvocableAgents = useSkillStore((s) => s.getUserInvocableAgents);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const agents = getUserInvocableAgents();
    const filtered = agents.filter((a) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q);
    });

    useEffect(() => {
      setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
      if (!listRef.current) return;
      const items = listRef.current.querySelectorAll('[data-agent-item]');
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    useImperativeHandle(ref, () => ({
      handleKeyDown(e: React.KeyboardEvent): boolean {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
          return true;
        }
        if (filtered.length === 0) return false;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
          return true;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return true;
        }
        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          if (filtered[selectedIndex]) {
            onSelect(filtered[selectedIndex]);
          }
          return true;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          if (filtered[selectedIndex]) {
            onSelect(filtered[selectedIndex]);
          }
          return true;
        }
        return false;
      },
    }), [filtered, selectedIndex, onSelect, onClose]);

    if (filtered.length === 0) {
      return (
        <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-border bg-popover shadow-md z-50 px-3 py-3 text-center">
          <p className="text-xs text-muted-foreground">No agents available</p>
        </div>
      );
    }

    return (
      <div
        ref={listRef}
        className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-border bg-popover shadow-md max-h-48 overflow-y-auto thin-scrollbar z-50"
      >
        {filtered.map((agent, i) => (
          <button
            key={agent.path}
            data-agent-item
            type="button"
            className={cn(
              'w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors',
              i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
            )}
            onMouseEnter={() => setSelectedIndex(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(agent);
            }}
          >
            <AgentIcon icon={agent.icon} size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium truncate">@{agent.name}</span>
                <AgentSourceBadge source={agent.source} />
              </div>
              {agent.description && (
                <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{agent.description}</div>
              )}
            </div>
          </button>
        ))}
      </div>
    );
  },
);
