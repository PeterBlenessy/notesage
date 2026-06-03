import SkillMode from '@/components/cmd/modes/SkillMode';
import ReferenceMode from '@/components/cmd/modes/ReferenceMode';
import TagMode, { type TagPickAction } from '@/components/cmd/modes/TagMode';
import TaskMode, { type TaskAction } from '@/components/cmd/modes/TaskMode';
import ResearchMode from '@/components/cmd/modes/ResearchMode';
import PaletteMode from '@/components/cmd/modes/PaletteMode';
import type { ActivePrefix } from '@/components/cmd/prefix-modes';
import type { AttachmentChip } from '@/components/cmd/AttachmentChips';

export type { TagPickAction, TaskAction };

export interface ActiveOptionInfo {
  listboxId: string;
  activeOptionId: string | null;
  count: number;
}

interface ModePickerDispatchProps {
  activePrefix: ActivePrefix;
  isComposing: boolean;
  onActiveOptionChange: (info: ActiveOptionInfo) => void;
  onPickSkill: (name: string) => void;
  onPickReference: (chip: AttachmentChip) => void;
  onPickReferenceOccurrence: (action: {
    filePath: string;
    fileName: string;
    symbol: string;
    occurrenceInFile: number;
  }) => void;
  onPickTag: (action: TagPickAction) => void;
  initialTagDrilldown?: string | null;
  initialPersonDrilldown?: string | null;
  onPickTask: (action: TaskAction) => void;
  onPickResearch: (chip: AttachmentChip) => void;
  onPickPalette: (commandId: string) => void;
}

/**
 * Stable per-mode listbox ids — used by the input's `aria-controls` and as
 * the option-id prefix every picker emits (`${listboxId}-opt-${i}`). Keeping
 * one fixed id per mode means tests and DOM queries can target a known id
 * without race conditions on `useId()` regeneration across renders.
 */
export const MODE_LISTBOX_IDS: Record<string, string> = {
  skill: 'cmd-skill-listbox',
  reference: 'cmd-reference-listbox',
  tag: 'cmd-tag-listbox',
  task: 'cmd-task-listbox',
  research: 'cmd-research-listbox',
  palette: 'cmd-palette-listbox',
};

/**
 * Picker dispatcher — selects the mode-specific picker based on the active
 * prefix's mode id. Each picker is a standalone component; the dispatcher is
 * just the route table. Forwards the stable listbox id and the active-option
 * callback so the parent can mirror highlight state on the combobox input via
 * `aria-activedescendant`.
 */
export function ModePickerDispatch({
  activePrefix,
  isComposing,
  onActiveOptionChange,
  onPickSkill,
  onPickReference,
  onPickReferenceOccurrence,
  onPickTag,
  initialTagDrilldown,
  initialPersonDrilldown,
  onPickTask,
  onPickResearch,
  onPickPalette,
}: ModePickerDispatchProps) {
  const filter = activePrefix.filter;
  const listboxId = MODE_LISTBOX_IDS[activePrefix.mode.id];
  switch (activePrefix.mode.id) {
    case 'skill':
      return (
        <SkillMode
          filter={filter}
          onPick={onPickSkill}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
        />
      );
    case 'reference':
      return (
        <ReferenceMode
          filter={filter}
          onPick={onPickReference}
          onPickOccurrence={onPickReferenceOccurrence}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
          initialPersonDrilldown={initialPersonDrilldown ?? null}
        />
      );
    case 'tag':
      return (
        <TagMode
          filter={filter}
          onPick={onPickTag}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
          initialDrilldown={initialTagDrilldown ?? null}
        />
      );
    case 'task':
      return (
        <TaskMode
          filter={filter}
          onPick={onPickTask}
          isComposing={isComposing}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
        />
      );
    case 'research':
      return (
        <ResearchMode
          filter={filter}
          onPick={onPickResearch}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
        />
      );
    case 'palette':
      return (
        <PaletteMode
          filter={filter}
          onPick={onPickPalette}
          listboxId={listboxId}
          onActiveOptionChange={onActiveOptionChange}
        />
      );
  }
}
