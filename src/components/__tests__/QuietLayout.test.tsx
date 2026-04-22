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

// Stub FloatingCommandBar so we can assert it's mounted without pulling in
// its real implementation (portal, hooks, etc.).
vi.mock('@/components/cmd/FloatingCommandBar', () => ({
  default: () => <div data-testid="cmd-bar-stub" />,
}));

// Stub AgentOrb (#29) so we can assert it's mounted without pulling its
// real implementation (it has its own dedicated test file).
vi.mock('@/components/activity/AgentOrb', () => ({
  AgentOrb: () => <div data-testid="agent-orb-stub" />,
}));

// ---------------------------------------------------------------------------
// Mock settings-store so QuietLayout can read `cmdBarPinned` to decide
// whether to apply right-padding to the document area.
// ---------------------------------------------------------------------------

let mockCmdBarPinned = false;

vi.mock('@/stores/settings-store', () => {
  const state = {
    get cmdBarPinned() { return mockCmdBarPinned; },
  };
  return {
    useSettingsStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
  };
});

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
    mockCmdBarPinned = false;
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

  it('mounts the FloatingCommandBar', () => {
    renderWithProviders(<QuietLayout {...defaultProps()} />);
    expect(screen.getByTestId('cmd-bar-stub')).toBeTruthy();
  });

  it('mounts the AgentOrb (#29)', () => {
    renderWithProviders(<QuietLayout {...defaultProps()} />);
    expect(screen.getByTestId('agent-orb-stub')).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Pinned-panel padding (#28)
  // -------------------------------------------------------------------------

  describe('pinned-panel padding (#28)', () => {
    it('does NOT apply padding-right to the document area when not pinned', () => {
      mockCmdBarPinned = false;
      const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
      const docArea = container.querySelector(
        '[data-quiet-layout-document-area]',
      ) as HTMLElement;
      expect(docArea).toBeTruthy();
      // No padding-right inline style applied.
      expect(docArea.style.paddingRight).toBe('');
    });

    it('applies padding-right via the CSS variable when pinned', () => {
      mockCmdBarPinned = true;
      const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
      const docArea = container.querySelector(
        '[data-quiet-layout-document-area]',
      ) as HTMLElement;
      expect(docArea).toBeTruthy();
      // Inline style references the CSS variable with a 400px fallback.
      expect(docArea.style.paddingRight).toContain('--cmd-bar-pinned-width');
    });

    it('marks the wrapper with data-cmd-bar-pinned when pinned', () => {
      mockCmdBarPinned = true;
      const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);
      const wrapper = container.querySelector(
        '[data-quiet-layout-placeholder]',
      ) as HTMLElement;
      expect(wrapper.getAttribute('data-cmd-bar-pinned')).toBe('true');
    });
  });
});
