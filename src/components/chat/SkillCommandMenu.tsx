import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Blocks } from 'lucide-react';
import { useSkillStore, type SkillEntry } from '@/stores/skill-store';
import { cn } from '@/lib/utils';

export interface SkillCommandMenuHandle {
  /** Handle a keydown event. Returns true if the event was consumed. */
  handleKeyDown(e: React.KeyboardEvent): boolean;
}

interface SkillCommandMenuProps {
  query: string;
  onSelect: (skill: SkillEntry) => void;
  onClose: () => void;
}

export const SkillCommandMenu = forwardRef<SkillCommandMenuHandle, SkillCommandMenuProps>(
  function SkillCommandMenu({ query, onSelect, onClose }, ref) {
    const skills = useSkillStore((s) => s.skills);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const filtered = skills.filter((s) => {
      if (s.user_invocable === false) return false;
      if (s.disable_model_invocation === true) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    });

    useEffect(() => {
      setSelectedIndex(0);
    }, [query]);

    useEffect(() => {
      if (!listRef.current) return;
      const items = listRef.current.querySelectorAll('[data-skill-item]');
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
          <p className="text-xs text-muted-foreground">No skills available</p>
        </div>
      );
    }

    return (
      <div
        ref={listRef}
        className="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-border bg-popover shadow-md max-h-48 overflow-y-auto thin-scrollbar z-50"
      >
        {filtered.map((skill, i) => (
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
      </div>
    );
  },
);
