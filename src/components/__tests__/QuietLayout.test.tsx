// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  registerDefaultHandlers,
} from '@/test/component-harness';
import { QuietLayout, type QuietLayoutProps } from '@/components/QuietLayout';

// ---------------------------------------------------------------------------
// Mock TitleBar — heavy dependency tree, not relevant to placeholder shell
// ---------------------------------------------------------------------------

vi.mock('@/components/TitleBar', () => ({
  TitleBar: () => <div data-testid="titlebar">TitleBar</div>,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProps(overrides: Partial<QuietLayoutProps> = {}): QuietLayoutProps {
  return {
    focusMode: false,
    stripExpanded: false,
    onNewNote: vi.fn(),
    onNewProject: vi.fn(),
    onOpenFolder: vi.fn(),
    onOpenProject: vi.fn(),
    onOpenFile: vi.fn(),
    exportOpen: false,
    onExportOpenChange: vi.fn(),
    outlineOpen: false,
    onOutlineOpenChange: vi.fn(),
    updateAvailable: false,
    updateVersion: null,
    onUpdateClick: vi.fn(),
    onShortcutsOpen: vi.fn(),
    onOpenActions: vi.fn(),
    onOpenSettings: vi.fn(),
    onBrowseForProject: vi.fn(),
    onOpenProjectSettings: vi.fn(),
    onMakeProject: vi.fn(),
    onExportFile: vi.fn(),
    onCancelTask: vi.fn(async () => {}),
    onClickTask: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuietLayout (placeholder)', () => {
  beforeEach(() => {
    registerDefaultHandlers();
  });

  it('renders without crashing', () => {
    const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
    expect(container).toBeTruthy();
  });

  it('renders the placeholder wrapper with data-quiet-layout-placeholder', () => {
    const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
    expect(container.querySelector('[data-quiet-layout-placeholder]')).toBeTruthy();
  });

  it('renders the title bar at the top', () => {
    renderWithProviders(<QuietLayout {...defaultProps()} />);
    expect(screen.getByTestId('titlebar')).toBeTruthy();
  });

  it('renders three labelled placeholder zones (sidebar, document, reserved)', () => {
    renderWithProviders(<QuietLayout {...defaultProps()} />);
    // Each zone has a centered placeholder label
    expect(screen.getByText(/Sidebar \(placeholder\)/i)).toBeTruthy();
    expect(screen.getByText(/Document area \(placeholder\)/i)).toBeTruthy();
    expect(screen.getByText(/Reserved \(placeholder\)/i)).toBeTruthy();
  });
});
