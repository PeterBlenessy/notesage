import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Sparkles, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSkillStore, type SkillEntry } from '@/stores/skill-store';
import { getSessionInfo, subscribeSessionInfo } from '@/lib/ai/acp-agent-state';
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";

/**
 * SkillMode — picker dropdown for the `/skill-name` prefix mode in the
 * FloatingCommandBar (PRD `2026-04-21-ui-refresh`, Phase 1, task #14).
 *
 * Pure presentation: parent (FloatingCommandBar) wires dispatch in a
 * follow-up commit after all 6 mode pickers (#14–#19) land.
 *
 * Behaviour:
 *   - Reads available skills via `useSkillStore.getActiveSkills()`, and the
 *     connected ACP agent's own commands from session state. Agent commands
 *     were already captured from `available_commands_update` but had no
 *     reader, so nothing the agent offered was reachable — including the only
 *     compaction control an ACP agent has, since it owns its own context.
 *   - `/` (empty filter) lists EVERY skill, alphabetically. `/s` lists every
 *     skill whose name starts with "s", alphabetically. No cap — the parent
 *     picker tray (`flex-1 min-h-0 overflow-y-auto`) scrolls, and the parent's
 *     `onActiveOptionChange` → scrollIntoView keeps the highlight visible.
 *   - Auto-highlights the first result so Enter on the first keystroke fires
 *     `onPick` without needing arrow keys.
 *   - Keyboard nav: ArrowDown / ArrowUp move the highlight, Enter fires
 *     `onPick(name)`. Click also fires `onPick`.
 *   - Empty results show "No skills match" muted text.
 *   - Esc handling lives on the parent — this component does not own dismiss.
 */

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
  // `/` → all skills; `/s` → skills whose name starts with "s".
  const matched = trimmed
    ? skills.filter((s) => s.name.toLowerCase().startsWith(trimmed))
    : skills;
  // Alphabetical by name. The store's source order (global ∪ project merge) is
  // otherwise arbitrary — which made the list look random and, with the old
  // 8-item cap, hid skills that only surfaced once a filter narrowed the set.
  // Copy before sorting; never mutate the store array.
  return [...matched].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A row in the picker: either a Notesage skill or a command the connected ACP
 * agent advertises (`/compact`, `/clear`, …).
 *
 * Agent commands arrive over `available_commands_update` and were already being
 * stored in session state — they simply had no reader, so nothing the agent
 * offered was ever reachable. Notably that includes the only compaction control
 * available for an ACP agent, since the agent owns its own context window and
 * the protocol exposes no other way to ask it to compact.
 */
type PickerRow =
  | { kind: 'skill'; key: string; name: string; description?: string }
  | { kind: 'agent'; key: string; name: string; description?: string };

function filterAgentCommands(
  commands: { name: string; description: string }[],
  filter: string,
): PickerRow[] {
  const trimmed = filter.trim().toLowerCase();
  const matched = trimmed
    ? commands.filter((c) => c.name.toLowerCase().startsWith(trimmed))
    : commands;
  return [...matched]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({
      kind: 'agent' as const,
      key: `agent:${c.name}`,
      name: c.name,
      description: c.description || undefined,
    }));
}

function SkillMode({
  filter,
  onPick,
  onDismiss,
  listboxId = 'cmd-skill-listbox',
  onActiveOptionChange,
}: SkillModeProps) {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  // Subscribe to the RAW state fields (`skills`, `enabledOverrides`) so
  // Zustand's snapshot comparison sees stable references. Calling
  // `state.getActiveSkills()` inside the selector would compute a new array
  // on every render → "getSnapshot should be cached" / infinite-loop crash
  // under React 19 (same root cause as the 2026-04-24 TaskMode fix).
  // We invoke `getActiveSkills` imperatively from a useMemo whose deps are
  // the raw state, which ensures re-computation only when the underlying
  // data actually changes.
  const skills = useSkillStore((state) => state.skills);
  const enabledOverrides = useSkillStore((state) => state.enabledOverrides);
  const allSkills = useMemo(
    () => useSkillStore.getState().getActiveSkills(),
    [skills, enabledOverrides],
  );
  // Commands advertised by the connected ACP agent. `getSessionInfo` returns a
  // stable reference until the session actually changes, so it is safe as a
  // `useSyncExternalStore` snapshot (same pattern as AcpSessionControls).
  const sessionInfo = useSyncExternalStore(subscribeSessionInfo, getSessionInfo);
  const agentCommands = sessionInfo.commands;

  const results = useMemo<PickerRow[]>(() => {
    const skillRows: PickerRow[] = filterSkills(allSkills, filter).map((s) => ({
      kind: 'skill' as const,
      key: s.path,
      name: s.name,
      description: s.description,
    }));
    // Skills first, agent commands after. Grouping rather than interleaving
    // keeps the first-Enter target predictable: with no agent connected the
    // list is byte-for-byte what it was, and an agent command can never
    // displace the skill a user was reaching for.
    return [...skillRows, ...filterAgentCommands(agentCommands, filter)];
  }, [allSkills, agentCommands, filter]);
  const [activeIndex, setActiveIndex] = useState(0);

  // Reset highlight to the top whenever the filter or result count shifts so
  // the first row is always the candidate Enter would pick.
  useEffect(() => {
    setActiveIndex(0);
  }, [filter, results.length]);

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

  // #138 fix — keyboard nav is bound to the document, NOT the listbox. The
  // host bar's combobox input keeps DOM focus; an earlier version focused
  // `listRef` on mount and bound the handler locally, which stole focus from
  // the input (the user couldn't keep typing after the picker opened) AND
  // detached focus when the picker unmounted on Esc (later keystrokes landed
  // nowhere). Mirrors the TagMode/ReferenceMode/ResearchMode pattern.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (results.length === 0) {
        if (event.key === 'Escape') {
          event.preventDefault();
          onDismiss?.();
        }
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % results.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + results.length) % results.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const picked = results[activeIndex];
        if (picked) onPick(picked.name);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [results, activeIndex, onPick, onDismiss]);

  if (results.length === 0) {
    return (
      <div
        id={listboxId}
        role="listbox"
        aria-label={t("cmd.skillPicker")}
        className="rounded-md border border-border bg-popover p-3 text-sm text-muted-foreground shadow-md outline-none"
      >
        {/* Only mention agent commands when an agent is actually offering
            some — otherwise the message names a category that does not exist
            for this user. */}
        {agentCommands.length > 0 ? 'No skills or agent commands match' : 'No skills match'}
      </div>
    );
  }

  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label={t("cmd.skillPicker")}
      className="overflow-hidden rounded-md border border-border bg-popover shadow-md outline-none"
    >
      {results.map((row, i) => {
        const active = i === activeIndex;
        // Terminal for an agent command, Sparkles for a skill — the two run in
        // different places (the agent's own process vs Notesage), so which one
        // will act on the command should be visible before pressing Enter.
        const Icon = row.kind === 'agent' ? Terminal : Sparkles;
        return (
          <button
            type="button"
            key={row.key}
            id={`${listboxId}-opt-${i}`}
            role="option"
            aria-selected={active}
            data-active={active ? 'true' : 'false'}
            data-kind={row.kind}
            onClick={() => onPick(row.name)}
            onMouseEnter={() => setActiveIndex(i)}
            className={cn(
              // Density (live-test 2026-04-26).
              'flex w-full items-start gap-2 px-3 py-1.5 text-left text-[13px] transition-colors duration-150',
              active
                ? 'bg-muted/80 text-foreground'
                : 'text-foreground hover:bg-muted/60',
            )}
          >
            <Icon
              className={cn(
                'mt-[3px] size-3 shrink-0',
                'text-muted-foreground',
              )}
              strokeWidth={1.5}
              aria-hidden
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{row.name}</span>
              {row.description ? (
                <span
                  className="truncate text-xs text-muted-foreground"
                >
                  {row.description}
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
