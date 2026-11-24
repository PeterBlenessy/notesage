// @vitest-environment jsdom

/**
 * Perf review F-1: a row's indicators must not re-render because `projects`
 * was replaced. Every visible row mounts one, and `projects` is replaced on
 * every tree change.
 */

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import { Profiler } from 'react';
import { act } from '@testing-library/react';
import { renderWithProviders, screen } from '@/test/component-harness';
import { SidebarRowIndicators } from '../SidebarRowIndicators';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useGitStore } from '@/stores/git-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { FileEntry } from '@/lib/tauri';

const OUTER = '/lib/Work';
const INNER = '/lib/Work/vendor/tool';
const FILE = `${INNER}/src/main.ts`;

function tree(root: string, names: string[]): FileEntry[] {
  return names.map((name) => ({ name, path: `${root}/${name}`, is_directory: false, hidden: false }));
}

let commits = 0;

function mount() {
  commits = 0;
  return renderWithProviders(
    <Profiler id="indicators" onRender={() => { commits += 1; }}>
      <SidebarRowIndicators path={FILE} kind="file" />
    </Profiler>,
  );
}

beforeEach(() => {
  useSettingsStore.setState({ gitEnabled: true });
  useWorkspaceStore.setState({
    projects: [
      { path: OUTER, fileTree: tree(OUTER, ['a.md']) },
      { path: '/lib/Home', fileTree: [] },
    ],
    explorerFolders: [],
  });
  useGitStore.setState({ repos: {} });
});

describe('SidebarRowIndicators — render cost', () => {
  it('does not re-render when a tree changes or `projects` is replaced with the same roots', () => {
    mount();
    const before = commits;

    act(() => {
      useWorkspaceStore.getState().updateProjectTree(OUTER, tree(OUTER, ['a.md', 'b.md']));
    });
    act(() => {
      useWorkspaceStore.setState({ projects: [...useWorkspaceStore.getState().projects] });
    });
    act(() => {
      useWorkspaceStore.getState().addProject('/lib/Unrelated', []);
    });

    expect(commits - before).toBe(0);
  });

  it('still follows the owning project: the longest matching root wins, and a new nested root takes over', () => {
    const git = useGitStore.getState();
    git.setIsGitRepo(OUTER, true);
    git.setFileStatuses(OUTER, [{ path: `${OUTER}/other.md`, status: 'modified', staged: false }]);
    git.setIsGitRepo(INNER, true);
    git.setFileStatuses(INNER, [{ path: FILE, status: 'modified', staged: false }]);

    mount();
    // Owned by OUTER, whose status list has nothing for this file.
    expect(screen.queryByRole('status', { name: /git:/i })).toBeNull();

    act(() => {
      useWorkspaceStore.getState().addProject(INNER, []);
    });
    // Now owned by the nested project, which reports it modified.
    expect(screen.getByRole('status', { name: /git:/i })).toBeTruthy();
  });
});
