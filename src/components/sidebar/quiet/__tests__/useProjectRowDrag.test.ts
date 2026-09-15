/**
 * Red test — verifies that `useProjectRowDrag` lives in its own dedicated
 * file (`../useProjectRowDrag`) and returns correct drag props.  This test
 * will FAIL before the extraction refactor because `../useProjectRowDrag`
 * does not yet exist.
 */

import { describe, it, expect, vi } from 'vitest';
import { FOLDER_DRAG_MIME } from '../file-drag';
import { useProjectRowDrag } from '../useProjectRowDrag';
import type { FileEntry } from '@/lib/tauri';

function makeFile(name: string, path: string): FileEntry {
  return { name, path, is_directory: false, hidden: false };
}

function makeDir(name: string, path: string): FileEntry {
  return { name, path, is_directory: true, hidden: false, children: [] };
}

// useProjectRowDrag is a pure helper (no React hooks inside), so we call it
// directly without renderHook.
describe('useProjectRowDrag', () => {
  it('returns draggable=true for a file entry when not renaming', () => {
    const { draggable } = useProjectRowDrag(makeFile('note.md', '/p/note.md'), false);
    expect(draggable).toBe(true);
  });

  it('a directory is draggable too, and carries the FOLDER payload', () => {
    // It was not, which left the sidebar asymmetric in a way nobody could
    // explain: a folder could receive a file but could not be moved itself.
    // The separate payload is what keeps Pinned refusing it — that section
    // renders every row as a file.
    const { draggable, onDragStart } = useProjectRowDrag(makeDir('docs', '/p/docs'), false);
    expect(draggable).toBe(true);
    const setData = vi.fn();
    onDragStart?.({ dataTransfer: { setData, effectAllowed: '' } } as never);
    expect(setData).toHaveBeenCalledWith(FOLDER_DRAG_MIME, '/p/docs');
  });

  it('returns draggable=false when isRenaming is true', () => {
    const { draggable } = useProjectRowDrag(makeFile('note.md', '/p/note.md'), true);
    expect(draggable).toBe(false);
  });

  it('returns onDragStart=undefined when draggable=false', () => {
    // A renaming row, now that directories are draggable — the input would be
    // lost under the drag.
    const { onDragStart } = useProjectRowDrag(makeDir('docs', '/p/docs'), true);
    expect(onDragStart).toBeUndefined();
  });

  it('returns a function for onDragStart when draggable=true', () => {
    const { onDragStart } = useProjectRowDrag(makeFile('note.md', '/p/note.md'), false);
    expect(typeof onDragStart).toBe('function');
  });
});
