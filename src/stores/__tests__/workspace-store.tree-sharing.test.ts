// @vitest-environment jsdom

/**
 * Structural sharing on tree refresh (perf review F-1).
 *
 * A refresh relists a whole root, so the listing is all-new objects even when
 * nothing changed. These tests pin which identities survive a tree update:
 * all of them for an identical listing, everything off the path to the change
 * otherwise.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@/test/tauri-mock';
import { useWorkspaceStore, shareFileTree } from '../workspace-store';
import type { FileEntry } from '@/lib/tauri';

function file(path: string): FileEntry {
  return { name: path.split('/').pop() as string, path, is_directory: false, hidden: false };
}

function dir(path: string, children: FileEntry[]): FileEntry {
  return { name: path.split('/').pop() as string, path, is_directory: true, hidden: false, children };
}

/** A listing as the backend returns it: all-new objects on every call. */
function listing(extraFile?: string): FileEntry[] {
  const deepFiles = [file('/p/notes/deep/x.md')];
  if (extraFile) deepFiles.push(file(extraFile));
  return [
    dir('/p/archive', [file('/p/archive/old.md')]),
    dir('/p/notes', [dir('/p/notes/deep', deepFiles), file('/p/notes/a.md')]),
    file('/p/readme.md'),
  ];
}

function children(entry: FileEntry): FileEntry[] {
  return entry.children ?? [];
}

describe('tree updates share structure with the tree already in the store', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      projects: [
        { path: '/other', fileTree: [file('/other/o.md')] },
        { path: '/p', fileTree: listing() },
      ],
      explorerFolders: [{ path: '/p', fileTree: listing() }],
      notesTree: listing(),
    });
  });

  it('updateProjectTree with an identical listing keeps every reference and notifies nobody', () => {
    const before = useWorkspaceStore.getState().projects;
    const notified = vi.fn();
    const unsubscribe = useWorkspaceStore.subscribe(notified);

    useWorkspaceStore.getState().updateProjectTree('/p', listing());

    unsubscribe();
    const after = useWorkspaceStore.getState().projects;
    expect(after).toBe(before);
    expect(after[1]).toBe(before[1]);
    expect(after[1].fileTree).toBe(before[1].fileTree);
    expect(notified).toHaveBeenCalledTimes(0);
  });

  it('with one new file, only the path to that file gets new identities', () => {
    const before = useWorkspaceStore.getState().projects;
    const [archive, notes, readme] = before[1].fileTree;
    const [deep, a] = children(notes);

    useWorkspaceStore.getState().updateProjectTree('/p', listing('/p/notes/deep/new.md'));

    const after = useWorkspaceStore.getState().projects;
    // On the path: the array, the project, `notes`, `deep`.
    expect(after).not.toBe(before);
    expect(after[1]).not.toBe(before[1]);
    const [archive2, notes2, readme2] = after[1].fileTree;
    const [deep2, a2] = children(notes2);
    expect(notes2).not.toBe(notes);
    expect(deep2).not.toBe(deep);
    expect(children(deep2).map((e) => e.path)).toEqual([
      '/p/notes/deep/x.md',
      '/p/notes/deep/new.md',
    ]);
    // Off the path: the other project, the sibling folder and its children,
    // the sibling files, and the file that was already in the changed folder.
    expect(after[0]).toBe(before[0]);
    expect(archive2).toBe(archive);
    expect(archive2.children).toBe(archive.children);
    expect(readme2).toBe(readme);
    expect(a2).toBe(a);
    expect(children(deep2)[0]).toBe(children(deep)[0]);
  });

  it('a removed file changes only its ancestors, and a reordered listing still matches by path', () => {
    const before = useWorkspaceStore.getState().projects[1].fileTree;
    const next = listing();
    children(next[1]).pop(); // drop /p/notes/a.md
    next.reverse();

    useWorkspaceStore.getState().updateProjectTree('/p', next);

    const after = useWorkspaceStore.getState().projects[1].fileTree;
    expect(after.map((e) => e.path)).toEqual(['/p/readme.md', '/p/notes', '/p/archive']);
    expect(after[0]).toBe(before[2]);
    expect(after[2]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(children(after[1])[0]).toBe(children(before[1])[0]);
  });

  it('a changed flag on an entry replaces that entry but keeps what is below it', () => {
    const before = useWorkspaceStore.getState().projects[1].fileTree;
    const next = listing();
    next[0] = { ...next[0], unreadable: true };

    useWorkspaceStore.getState().updateProjectTree('/p', next);

    const after = useWorkspaceStore.getState().projects[1].fileTree;
    expect(after[0]).not.toBe(before[0]);
    expect(after[0].unreadable).toBe(true);
    expect(after[0].children).toBe(before[0].children);
    expect(after[1]).toBe(before[1]);
  });

  it('a folder that became unreadable (flag set, children gone) is not mistaken for unchanged', () => {
    const next = listing();
    next[1] = { ...next[1], unreadable: true, children: [] };

    useWorkspaceStore.getState().updateProjectTree('/p', next);

    const notes = useWorkspaceStore.getState().projects[1].fileTree[1];
    expect(notes.unreadable).toBe(true);
    expect(notes.children).toEqual([]);
  });

  it('updateExplorerTree and setNotesTree share the same way', () => {
    const folders = useWorkspaceStore.getState().explorerFolders;
    const notes = useWorkspaceStore.getState().notesTree;

    useWorkspaceStore.getState().updateExplorerTree('/p', listing());
    useWorkspaceStore.getState().setNotesTree(listing());

    expect(useWorkspaceStore.getState().explorerFolders).toBe(folders);
    expect(useWorkspaceStore.getState().notesTree).toBe(notes);

    useWorkspaceStore.getState().updateExplorerTree('/p', listing('/p/notes/deep/new.md'));
    const after = useWorkspaceStore.getState().explorerFolders;
    expect(after).not.toBe(folders);
    expect(after[0].fileTree[0]).toBe(folders[0].fileTree[0]);
  });

  it('shareFileTree compares each entry a constant number of times (linear in the tree)', () => {
    const wide = (count: number): FileEntry[] =>
      Array.from({ length: count }, (_, i) => file(`/big/f${i}.md`));
    const prev = wide(3000);
    // Reads of `path` on the fresh listing count the comparisons made.
    let reads = 0;
    const counted = (entries: FileEntry[]): FileEntry[] =>
      entries.map(
        (entry) =>
          new Proxy(entry, {
            get(target, key, receiver) {
              if (key === 'path') reads += 1;
              return Reflect.get(target, key, receiver);
            },
          }),
      );

    expect(shareFileTree(prev, counted(wide(3000)))).toBe(prev);
    expect(reads).toBeLessThanOrEqual(3000 * 3);

    // Worst case for matching by position: the listing is reversed.
    reads = 0;
    const reversed = counted(wide(3000).reverse());
    const shared = shareFileTree(prev, reversed);
    expect(shared[0]).toBe(prev[2999]);
    expect(reads).toBeLessThanOrEqual(3000 * 4);
  });
});
