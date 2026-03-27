// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  registerDefaultHandlers,
} from '@/test/component-harness';
import { Sidebar } from '@/components/sidebar/Sidebar';

// ---------------------------------------------------------------------------
// Mock sub-section components to isolate Sidebar composition logic
// ---------------------------------------------------------------------------

vi.mock('@/components/sidebar/QuickNotesSection', () => ({
  QuickNotesSection: (props: Record<string, unknown>) => (
    <div
      data-testid="quick-notes-section"
      data-panel-collapsed={String(props.panelCollapsed ?? '')}
    >
      Quick Notes Section
    </div>
  ),
}));

vi.mock('@/components/sidebar/ProjectsSection', () => ({
  ProjectsSection: (props: Record<string, unknown>) => (
    <div
      data-testid="projects-section"
      data-panel-collapsed={String(props.panelCollapsed ?? '')}
    >
      Projects Section
    </div>
  ),
}));

vi.mock('@/components/sidebar/FoldersSection', () => ({
  FoldersSection: (props: Record<string, unknown>) => (
    <div
      data-testid="folders-section"
      data-panel-collapsed={String(props.panelCollapsed ?? '')}
    >
      Folders Section
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Mock useFileOperations — Sidebar calls openFile from this hook
// ---------------------------------------------------------------------------

const mockOpenFile = vi.fn();

vi.mock('@/hooks/useFileOperations', () => ({
  useFileOperations: vi.fn(() => ({
    openFile: mockOpenFile,
    saveFile: vi.fn(),
    createFile: vi.fn(),
    createFolder: vi.fn(),
    renamePath: vi.fn(),
    deletePath: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Sidebar', () => {
  beforeEach(() => {
    registerDefaultHandlers();
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = renderWithProviders(<Sidebar />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders all three sections', () => {
    renderWithProviders(<Sidebar />);

    expect(screen.getByTestId('quick-notes-section')).toBeTruthy();
    expect(screen.getByTestId('projects-section')).toBeTruthy();
    expect(screen.getByTestId('folders-section')).toBeTruthy();
  });

  it('passes panelCollapsed prop to all sections', () => {
    renderWithProviders(<Sidebar panelCollapsed={true} />);

    expect(
      screen.getByTestId('quick-notes-section').getAttribute('data-panel-collapsed'),
    ).toBe('true');
    expect(
      screen.getByTestId('projects-section').getAttribute('data-panel-collapsed'),
    ).toBe('true');
    expect(
      screen.getByTestId('folders-section').getAttribute('data-panel-collapsed'),
    ).toBe('true');
  });

  it('passes panelCollapsed=false to all sections', () => {
    renderWithProviders(<Sidebar panelCollapsed={false} />);

    expect(
      screen.getByTestId('quick-notes-section').getAttribute('data-panel-collapsed'),
    ).toBe('false');
    expect(
      screen.getByTestId('projects-section').getAttribute('data-panel-collapsed'),
    ).toBe('false');
    expect(
      screen.getByTestId('folders-section').getAttribute('data-panel-collapsed'),
    ).toBe('false');
  });

  it('renders with all optional callback props provided', () => {
    const props = {
      onNewNote: vi.fn(),
      onNewProject: vi.fn(),
      onOpenExistingProject: vi.fn(),
      onOpenProjectSettings: vi.fn(),
      onMakeProject: vi.fn(),
      onExportFile: vi.fn(),
      panelCollapsed: false,
    };

    const { container } = renderWithProviders(<Sidebar {...props} />);
    expect(container.firstChild).toBeTruthy();
    expect(screen.getByTestId('quick-notes-section')).toBeTruthy();
    expect(screen.getByTestId('projects-section')).toBeTruthy();
    expect(screen.getByTestId('folders-section')).toBeTruthy();
  });

  it('renders with no optional callback props (all undefined)', () => {
    const { container } = renderWithProviders(<Sidebar />);
    expect(container.firstChild).toBeTruthy();
    expect(screen.getByTestId('quick-notes-section')).toBeTruthy();
    expect(screen.getByTestId('projects-section')).toBeTruthy();
    expect(screen.getByTestId('folders-section')).toBeTruthy();
  });
});
