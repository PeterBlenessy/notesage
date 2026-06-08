/**
 * Red test — verifies that `useProjectRowDrag` lives in its own dedicated
 * file (`../useProjectRowDrag`) and returns correct drag props.  This test
 * will FAIL before the extraction refactor because `../useProjectRowDrag`
 * does not yet exist.
 */

import { describe, it, expect } from 'vitest';
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

  it('returns draggable=false for a directory entry', () => {
    const { draggable } = useProjectRowDrag(makeDir('docs', '/p/docs'), false);
    expect(draggable).toBe(false);
  });

  it('returns draggable=false when isRenaming is true', () => {
    const { draggable } = useProjectRowDrag(makeFile('note.md', '/p/note.md'), true);
    expect(draggable).toBe(false);
  });

  it('returns onDragStart=undefined when draggable=false', () => {
    const { onDragStart } = useProjectRowDrag(makeDir('docs', '/p/docs'), false);
    expect(onDragStart).toBeUndefined();
  });

  it('returns a function for onDragStart when draggable=true', () => {
    const { onDragStart } = useProjectRowDrag(makeFile('note.md', '/p/note.md'), false);
    expect(typeof onDragStart).toBe('function');
  });
});
