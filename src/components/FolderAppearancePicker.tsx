/**
 * FolderAppearancePicker.tsx — Grid-based icon + color picker for folder customization.
 *
 * Issue #140: Per-folder icon and color customization.
 *
 * Renders a grid of 44 curated lucide icons and 8 palette color swatches.
 * Users can select one icon and/or one color independently. Changes apply
 * immediately to the sidebar — no save button. A "Reset" button clears the
 * custom appearance and restores the structural default.
 *
 * Callers supply `folderPath` + `folderType` to determine storage strategy:
 *   - Notesage project folders: persisted in project-metadata-store
 *   - External/explorer folders: persisted in folder-appearance-store
 *
 * Use inside a shadcn `Popover` or `Dialog` triggered by the "Customize…"
 * context menu item.
 */

import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  CURATED_FOLDER_ICONS,
  FOLDER_TAG_COLORS,
  type FolderAppearance,
  type FolderType,
} from '@/lib/folder-icon';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { useFolderAppearanceStore } from '@/stores/folder-appearance-store';

export interface FolderAppearancePickerProps {
  /** Absolute path of the folder being customized. */
  folderPath: string;
  /**
   * Structural type of the folder. Only `standard` folders may have custom
   * appearance. Locked and external structural types are not offered a picker —
   * their icons convey security/permission state and cannot be overridden.
   * Callers should not render this component for non-standard folder types.
   */
  folderType?: FolderType;
  /**
   * Whether this folder is a Notesage project (uses project-metadata-store).
   * Non-project folders use the global folder-appearance-store instead.
   */
  isProject?: boolean;
  /** Called when the user closes/dismisses the picker. */
  onClose?: () => void;
}

export function FolderAppearancePicker({
  folderPath,
  folderType = 'standard',
  isProject = false,
  onClose,
}: FolderAppearancePickerProps) {
  // Read from the appropriate store based on folder type.
  const projectAppearance = useProjectMetadataStore(
    (s) => s.getMetadata(folderPath)?.appearance,
  );
  const globalAppearance = useFolderAppearanceStore(
    (s) => s.getAppearance(folderPath),
  );

  const currentAppearance: FolderAppearance | undefined = isProject
    ? projectAppearance
    : globalAppearance;

  const selectedIconName = currentAppearance?.iconName ?? null;
  const selectedColorIndex = currentAppearance?.colorIndex ?? null;

  // Write to the appropriate store.
  const setProjectAppearance = useProjectMetadataStore((s) => s.setAppearance);
  const clearProjectAppearance = useProjectMetadataStore((s) => s.clearAppearance);
  const setGlobalAppearance = useFolderAppearanceStore((s) => s.setAppearance);
  const clearGlobalAppearance = useFolderAppearanceStore((s) => s.clearAppearance);

  const applyAppearance = useCallback(
    (next: FolderAppearance) => {
      if (isProject) {
        setProjectAppearance(folderPath, next);
      } else {
        setGlobalAppearance(folderPath, next);
      }
    },
    [isProject, folderPath, setProjectAppearance, setGlobalAppearance],
  );

  const handleIconSelect = useCallback(
    (iconName: string) => {
      const next: FolderAppearance = {
        iconName: iconName === selectedIconName ? null : iconName,
        colorIndex: selectedColorIndex,
      };
      applyAppearance(next);
    },
    [selectedIconName, selectedColorIndex, applyAppearance],
  );

  const handleColorSelect = useCallback(
    (colorIndex: number) => {
      const next: FolderAppearance = {
        iconName: selectedIconName,
        colorIndex: colorIndex === selectedColorIndex ? null : colorIndex,
      };
      applyAppearance(next);
    },
    [selectedIconName, selectedColorIndex, applyAppearance],
  );

  const handleReset = useCallback(() => {
    if (isProject) {
      clearProjectAppearance(folderPath);
    } else {
      clearGlobalAppearance(folderPath);
    }
  }, [isProject, folderPath, clearProjectAppearance, clearGlobalAppearance]);

  // Locked/external folders show a brief informational note instead of the
  // picker, since their structural icons cannot be overridden.
  if (folderType === 'locked' || folderType === 'external') {
    return (
      <div className="p-3 text-sm text-muted-foreground max-w-[260px]">
        Locked and external folders use fixed structural icons that convey
        security or permission state and cannot be customized.
      </div>
    );
  }

  const hasCustomAppearance =
    selectedIconName !== null || selectedColorIndex !== null;

  return (
    <div className="p-3 space-y-3 w-[260px]">
      {/* Color swatches — 8 colors in a row */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
          Color
        </p>
        <div className="flex gap-1.5 flex-wrap">
          {FOLDER_TAG_COLORS.map((color, idx) => (
            <button
              key={color.cssVar}
              aria-label={color.label}
              aria-pressed={idx === selectedColorIndex}
              title={color.label}
              onClick={() => handleColorSelect(idx)}
              className={cn(
                'w-6 h-6 rounded-full transition-all duration-100',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                'hover:scale-110 active:scale-95',
                idx === selectedColorIndex &&
                  'ring-2 ring-offset-1 ring-foreground scale-110',
              )}
              style={{ backgroundColor: `var(${color.cssVar})` }}
            />
          ))}
        </div>
      </div>

      {/* Icon grid — 44 icons in 8 columns */}
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
          Icon
        </p>
        <div className="grid grid-cols-8 gap-1">
          {CURATED_FOLDER_ICONS.map(({ name, icon: Icon }) => (
            <button
              key={name}
              aria-label={name}
              aria-pressed={name === selectedIconName}
              title={name}
              onClick={() => handleIconSelect(name)}
              className={cn(
                'flex items-center justify-center w-7 h-7 rounded transition-all duration-100',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                'hover:bg-muted active:scale-90',
                name === selectedIconName
                  ? 'bg-muted ring-1 ring-foreground/30'
                  : 'text-muted-foreground',
              )}
            >
              <Icon
                className="w-4 h-4"
                strokeWidth={1.5}
                aria-hidden="true"
                style={
                  name === selectedIconName && selectedColorIndex !== null
                    ? { color: `var(${FOLDER_TAG_COLORS[selectedColorIndex]?.cssVar})` }
                    : undefined
                }
              />
            </button>
          ))}
        </div>
      </div>

      {/* Reset + Done */}
      <div className="flex items-center justify-between pt-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={!hasCustomAppearance}
          onClick={handleReset}
          className="text-xs h-7 px-2 text-muted-foreground"
        >
          Reset
        </Button>
        {onClose && (
          <Button
            size="sm"
            onClick={onClose}
            className="text-xs h-7 px-3"
          >
            Done
          </Button>
        )}
      </div>
    </div>
  );
}
