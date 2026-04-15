import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from 'react';
import { Blocks, Terminal } from 'lucide-react';
import { useSkillStore, type SkillEntry } from '@/stores/skill-store';
import { getSessionInfo, subscribeSessionInfo, type AcpAgentCommand } from '@/lib/ai/acp-agent-state';
import { cn } from '@/lib/utils';

export interface SkillCommandMenuHandle {
  /** Handle a keydown event. Returns true if the event was consumed. */
  handleKeyDown(e: React.KeyboardEvent): boolean;
}

interface SkillCommandMenuProps {
  query: string;
  onSelect: (skill: SkillEntry) => void;
  /** Called when user selects an agent command (inserts /command into input) */
  onSelectAgentCommand?: (command: AcpAgentCommand) => void;
  onClose: () => void;
}

type CombinedItem =
  | { type: 'skill'; skill: SkillEntry }
  | { type: 'agent_command'; command: AcpAgentCommand };

export const SkillCommandMenu = forwardRef<SkillCommandMenuHandle, SkillCommandMenuProps>(
  function SkillCommandMenu({ query, onSelect, onSelectAgentCommand, onClose }, ref) {
    const skills = useSkillStore((s) => s.skills);
    const sessionInfo = useSyncExternalStore(subscribeSessionInfo, getSessionInfo);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const filteredSkills = skills.filter((s) => {
      if (s.user_invocable === false) return false;
      if (s.disable_model_invocation === true) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    });

    const filteredCommands = (sessionInfo.commands ?? []).filter((cmd) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return cmd.name.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q);
    });

    // Combined list: skills first, then agent commands
    const items: CombinedItem[] = [
      ...filteredSkills.map((s): CombinedItem => ({ type: 'skill', skill: s })),
      ...filteredCommands.map((c): CombinedItem => ({ type: 'agent_command', command: c })),
    ];
    // items combines both lists for unified keyboard navigation

    useEffect(() => {
      setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
      if (!listRef.current) return;
      const items = listRef.current.querySelectorAll('[data-skill-item]');
      items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    const selectCurrent = () => {
      const item = items[selectedIndex];
      if (!item) return;
      if (item.type === 'skill') onSelect(item.skill);
      else if (item.type === 'agent_command') onSelectAgentCommand?.(item.command);
    };

    useImperativeHandle(ref, () => ({
      handleKeyDown(e: React.KeyboardEvent): boolean {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
          return true;
        }
        if (items.length === 0) return false;
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
          return true;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          return true;
        }
        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          selectCurrent();
          return true;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          selectCurrent();
          return true;
        }
        return false;
      },
    }), [items, selectedIndex, onSelect, onSelectAgentCommand, onClose]);

    if (items.length === 0) {
      return (
        <div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-border bg-popover shadow-md z-50 px-3 py-3 text-center">
          <p className="text-xs text-muted-foreground">No commands available</p>
        </div>
      );
    }

    return (
      <div
        ref={listRef}
        className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-border bg-popover shadow-md max-h-48 overflow-y-auto thin-scrollbar z-50"
      >
        {filteredSkills.length > 0 && filteredCommands.length > 0 && (
          <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Skills</div>
        )}
        {filteredSkills.map((skill, i) => (
          <button
            key={skill.path}
            data-skill-item
            type="button"
            className={cn(
              'w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors',
              i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
            )}
            onMouseEnter={() => setSelectedIndex(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(skill);
            }}
          >
            <Blocks className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">/{skill.name}</div>
              {skill.description && (
                <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{skill.description}</div>
              )}
            </div>
          </button>
        ))}
        {filteredCommands.length > 0 && (
          <>
            {filteredSkills.length > 0 && (
              <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Agent Commands</div>
            )}
            {filteredCommands.map((cmd, ci) => {
              const itemIdx = filteredSkills.length + ci;
              return (
                <button
                  key={cmd.name}
                  data-skill-item
                  type="button"
                  className={cn(
                    'w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors',
                    itemIdx === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                  )}
                  onMouseEnter={() => setSelectedIndex(itemIdx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelectAgentCommand?.(cmd);
                  }}
                >
                  <Terminal className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">/{cmd.name}</div>
                    {cmd.description && (
                      <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{cmd.description}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </>
        )}
      </div>
    );
  },
);
