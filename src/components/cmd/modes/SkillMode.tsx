import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSkillStore, type SkillEntry } from '@/stores/skill-store';

/**
 * SkillMode — picker dropdown for the `/skill-name` prefix mode in the
 * FloatingCommandBar (PRD `2026-04-21-ui-refresh`, Phase 1, task #14).
 *
 * Pure presentation: parent (FloatingCommandBar) wires dispatch in a
 * follow-up commit after all 6 mode pickers (#14–#19) land.
 *
 * Behaviour:
 *   - Reads available skills via `useSkillStore.getActiveSkills()`.
 *   - Filters by `filter` prop (case-insensitive substring on name; falls
 *     back to description match if the name doesn't hit).
 *   - Renders up to 8 results in a vertical list.
 *   - Auto-highlights the first result so Enter on the first keystroke fires
 *     `onPick` without needing arrow keys.
 *   - Keyboard nav: ArrowDown / ArrowUp move the highlight, Enter fires
 *     `onPick(name)`. Click also fires `onPick`.
 *   - Empty results show "No skills match" muted text.
 *   - Esc handling lives on the parent — this component does not own dismiss.
 */

const MAX_RESULTS = 8;

export interface SkillModeProps {
  /** Text typed after the / prefix (e.g. "web" for /web). */
  filter: string;
  /**
   * Called when the user picks a skill. The parent appends `/skill-name `
   * (with trailing space) at the cursor or replaces the active prefix token.
   */
  onPick: (skillName: string) => void;
  /**
   * Called when the picker should close without selecting (Esc handled by
   * parent). Optional — parent owns the dismiss logic.
   */
  onDismiss?: () => void;
  /**
   * DOM id used as the listbox's `id` attribute and as the prefix for option
   * ids. Enables the parent `FloatingCommandBar` to wire `aria-controls` and
   * `aria-activedescendant` on its combobox input. Optional — defaults to
   * a stable fallback so standalone use stays ARIA-valid.
   */
  listboxId?: string;
  /**
   * Fires whenever the active option / result count changes. Lets the parent
   * FloatingCommandBar keep `aria-activedescendant` in sync without the
   * picker moving DOM focus away from the input.
   */
  onActiveOptionChange?: (info: {
    listboxId: string;
    activeOptionId: string | null;
    count: number;
  }) => void;
}

function filterSkills(skills: SkillEntry[], filter: string): SkillEntry[] {
  const trimmed = filter.trim().toLowerCase();
  if (!trimmed) return skills.slice(0, MAX_RESULTS);

  // Two-pass match: name first, then fall back to description hits the name
  // pass missed. Preserves source order within each bucket.
  const nameHits: SkillEntry[] = [];
  const descHits: SkillEntry[] = [];
  for (const s of skills) {
    if (s.name.toLowerCase().includes(trimmed)) {
      nameHits.push(s);
    } else if (s.description.toLowerCase().includes(trimmed)) {
      descHits.push(s);
    }
  }
  return [...nameHits, ...descHits].slice(0, MAX_RESULTS);
}

function SkillMode({
  filter,
  onPick,
  onDismiss,
  listboxId = 'cmd-skill-listbox',
  onActiveOptionChange,
}: SkillModeProps) {
  const allSkills = useSkillStore((state) => state.getActiveSkills());
  const results = useMemo(() => filterSkills(allSkills, filter), [allSkills, filter]);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Reset highlight to the top whenever the filter or result count shifts so
  // the first row is always the candidate Enter would pick.
  useEffect(() => {
    setActiveIndex(0);
  }, [filter, results.length]);

  // Take focus on mount so keyboard nav works without a click.
  useEffect(() => {
    listRef.current?.focus();
  }, []);

  // Report active option state upward so the parent can mirror it on its
  // combobox input via aria-activedescendant.
  useEffect(() => {
    if (!onActiveOptionChange) return;
    const activeOptionId =
      results.length > 0 ? `${listboxId}-opt-${activeIndex}` : null;
    onActiveOptionChange({
      listboxId,
      activeOptionId,
      count: results.length,
    });
  }, [onActiveOptionChange, listboxId, activeIndex, results.length]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (results.length === 0) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss?.();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = results[activeIndex];
      if (picked) onPick(picked.name);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss?.();
    }
  };

  if (results.length === 0) {
    return (
      <div
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label="Skill picker"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="rounded-md border border-border bg-popover p-3 text-sm text-muted-foreground shadow-md outline-none"
      >
        No skills match
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      id={listboxId}
      role="listbox"
      aria-label="Skill picker"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="overflow-hidden rounded-md border border-border bg-popover shadow-md outline-none"
    >
      {results.map((skill, i) => {
        const active = i === activeIndex;
        return (
          <button
            type="button"
            key={skill.path}
            id={`${listboxId}-opt-${i}`}
            role="option"
            aria-selected={active}
            data-active={active ? 'true' : 'false'}
            onClick={() => onPick(skill.name)}
            onMouseEnter={() => setActiveIndex(i)}
            className={cn(
              'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors duration-150',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-foreground hover:bg-muted',
            )}
          >
            <Sparkles
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              strokeWidth={1.5}
              aria-hidden
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{skill.name}</span>
              {skill.description ? (
                <span className="truncate text-xs text-muted-foreground">
                  {skill.description}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default SkillMode;
