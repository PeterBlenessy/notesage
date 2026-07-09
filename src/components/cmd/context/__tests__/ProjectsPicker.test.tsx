// @vitest-environment jsdom

import '@/test/tauri-mock';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import { ProjectsPicker } from '../ProjectsPicker';
import type { WorkspaceProject } from '@/stores/workspace-store';
import type { ProjectMetadata } from '@/stores/project-metadata-store';

// Render Radix dropdown content inline and picker rows as plain buttons so the
// popover items are queryable without driving Radix pointer events in jsdom.
vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: ({ children }: { children?: React.ReactNode; asChild?: boolean }) => <>{children}</>,
    DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="dropdown-content">{children}</div>
    ),
  };
});

vi.mock('@/components/ui/picker-item', () => ({
  PickerCheckboxItem: ({
    label,
    checked,
    onCheckedChange,
    trailing,
  }: {
    label: string;
    checked?: boolean;
    onCheckedChange?: (v: boolean) => void;
    trailing?: React.ReactNode;
  }) => (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={!!checked}
      aria-label={label}
      onClick={() => onCheckedChange?.(!checked)}
    >
      <span>{label}</span>
      {trailing}
    </button>
  ),
}));

function project(path: string): WorkspaceProject {
  return { path, fileTree: [] };
}

function meta(name: string, locked = false): ProjectMetadata {
  return {
    version: 1,
    name,
    description: '',
    ai: { provider: null, agentName: null, projectContext: '' },
    ...(locked
      ? { aiLock: { connectionId: 'conn-x', lockedAt: 1 } }
      : {}),
  };
}

const noop = () => {};

function renderPicker(overrides: Partial<React.ComponentProps<typeof ProjectsPicker>> = {}) {
  const props: React.ComponentProps<typeof ProjectsPicker> = {
    projectPaths: [],
    workspaceProjects: [],
    metadataMap: {},
    onToggle: noop,
    onRemove: noop,
    onExplainLock: noop,
    ...overrides,
  };
  return renderWithProviders(<ProjectsPicker {...props} />);
}

describe('ProjectsPicker — trigger label', () => {
  it('shows the placeholder label when nothing is selected', () => {
    renderPicker();
    // "Projects" appears twice (trigger label + popover header) — assert via aria.
    expect(screen.getByRole('button', { name: 'Pick projects' })).toBeTruthy();
  });

  it('shows the single project name when one is selected', () => {
    renderPicker({
      projectPaths: ['/w/alpha'],
      workspaceProjects: [project('/w/alpha'), project('/w/beta')],
      metadataMap: { '/w/alpha': meta('Alpha') },
    });
    expect(screen.getByRole('button', { name: /1 project selected — Alpha/ })).toBeTruthy();
  });

  it('shows "All projects" when every workspace project is selected', () => {
    renderPicker({
      projectPaths: ['/w/alpha', '/w/beta'],
      workspaceProjects: [project('/w/alpha'), project('/w/beta')],
      metadataMap: { '/w/alpha': meta('Alpha'), '/w/beta': meta('Beta') },
    });
    expect(screen.getByRole('button', { name: /All projects/ })).toBeTruthy();
  });

  it('shows "<name> +N" when several (but not all) are selected', () => {
    renderPicker({
      projectPaths: ['/w/alpha', '/w/beta'],
      workspaceProjects: [project('/w/alpha'), project('/w/beta'), project('/w/gamma')],
      metadataMap: { '/w/alpha': meta('Alpha'), '/w/beta': meta('Beta') },
    });
    expect(screen.getByText('Alpha +1')).toBeTruthy();
  });
});

describe('ProjectsPicker — multi-select', () => {
  it('calls onToggle when an unselected project row is clicked', () => {
    const onToggle = vi.fn();
    renderPicker({
      projectPaths: [],
      workspaceProjects: [project('/w/alpha'), project('/w/beta')],
      metadataMap: { '/w/alpha': meta('Alpha'), '/w/beta': meta('Beta') },
      onToggle,
    });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Beta' }));
    expect(onToggle).toHaveBeenCalledWith('/w/beta');
  });

  it('calls onRemove when an already-selected project row is clicked', () => {
    const onRemove = vi.fn();
    renderPicker({
      projectPaths: ['/w/alpha'],
      workspaceProjects: [project('/w/alpha'), project('/w/beta')],
      metadataMap: { '/w/alpha': meta('Alpha'), '/w/beta': meta('Beta') },
      onRemove,
    });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Alpha' }));
    expect(onRemove).toHaveBeenCalledWith('/w/alpha');
  });

  it('offers a "Select all" row that toggles every unselected project on', () => {
    const onToggle = vi.fn();
    renderPicker({
      projectPaths: [],
      workspaceProjects: [project('/w/alpha'), project('/w/beta')],
      metadataMap: { '/w/alpha': meta('Alpha'), '/w/beta': meta('Beta') },
      onToggle,
    });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Select all' }));
    expect(onToggle).toHaveBeenCalledWith('/w/alpha');
    expect(onToggle).toHaveBeenCalledWith('/w/beta');
  });

  it('offers "Deselect all" that removes every selected project when all are on', () => {
    const onRemove = vi.fn();
    renderPicker({
      projectPaths: ['/w/alpha', '/w/beta'],
      workspaceProjects: [project('/w/alpha'), project('/w/beta')],
      metadataMap: { '/w/alpha': meta('Alpha'), '/w/beta': meta('Beta') },
      onRemove,
    });
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Deselect all' }));
    expect(onRemove).toHaveBeenCalledWith('/w/alpha');
    expect(onRemove).toHaveBeenCalledWith('/w/beta');
  });

  it('renders "No projects open" when the workspace has none', () => {
    renderPicker({ workspaceProjects: [], projectPaths: [] });
    expect(screen.getByText('No projects open')).toBeTruthy();
  });
});

describe('ProjectsPicker — lock affordance', () => {
  it('exposes a lock button on a locked project row that opens the explain dialog', () => {
    const onExplainLock = vi.fn();
    renderPicker({
      projectPaths: ['/w/alpha'],
      workspaceProjects: [project('/w/alpha')],
      metadataMap: { '/w/alpha': meta('Alpha', true) },
      onExplainLock,
    });
    const lockBtn = screen.getByRole('button', { name: 'Alpha is locked to a provider' });
    fireEvent.click(lockBtn);
    expect(onExplainLock).toHaveBeenCalledWith('/w/alpha');
  });
});
