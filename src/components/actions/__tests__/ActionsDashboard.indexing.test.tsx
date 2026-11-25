// @vitest-environment jsdom

/**
 * Tasks and goals are read from the document index, and the action scan
 * waits for it. While the library is being indexed, "No open actions" may
 * only mean "not yet", so the empty state says so.
 */

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { renderWithProviders, screen } from '@/test/component-harness';
import { ActionsDashboard } from '../ActionsDashboard';
import { useActionStore, type ActionItem } from '@/stores/action-store';
import { showIndexingForTests } from '@/stores/index-progress-store';

const NOTE = 'Still indexing: results may be incomplete';

describe('ActionsDashboard while the library is being indexed', () => {
  beforeEach(() => {
    useActionStore.setState({ actions: [], isScanning: false });
    showIndexingForTests(null);
  });

  afterEach(() => showIndexingForTests(null));

  it('shows the plain empty state when nothing is being indexed', () => {
    renderWithProviders(<ActionsDashboard />);
    expect(screen.getByText('No open actions')).toBeTruthy();
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('adds the note to the empty state while indexing, and drops it when indexing ends', () => {
    showIndexingForTests({});
    renderWithProviders(<ActionsDashboard />);
    expect(screen.getByText('No open actions')).toBeTruthy();
    expect(screen.getByText(NOTE)).toBeTruthy();

    act(() => showIndexingForTests(null));
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(screen.getByText('No open actions')).toBeTruthy();
  });

  it('has no empty state, and so no note, once there are actions', () => {
    showIndexingForTests({});
    useActionStore.setState({
      actions: [
        {
          id: 'a1',
          source_type: 'task',
          status: 'open',
          text: 'Write the report',
          file_path: '/lib/Work/todo.md',
          project_root: '/lib/Work',
          project_name: 'Work',
        } as unknown as ActionItem,
      ],
    });
    renderWithProviders(<ActionsDashboard />);
    expect(screen.queryByText('No open actions')).toBeNull();
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});
