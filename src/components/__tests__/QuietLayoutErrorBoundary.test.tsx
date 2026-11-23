// @vitest-environment jsdom

/**
 * QuietLayout — sidebar ErrorBoundary (error-UX finding #7).
 *
 * A render error inside QuietSidebar must NOT white-screen the app: the
 * boundary catches it, a width-preserving fallback appears in the sidebar
 * column, and the rest of the layout (editor area, command bar, orb) keeps
 * rendering. Mock setup mirrors `QuietLayout.test.tsx`, with QuietSidebar
 * replaced by a component that throws.
 */

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  fireEvent,
  registerDefaultHandlers,
} from '@/test/component-harness';
import { QuietLayout, type QuietLayoutProps } from '@/components/QuietLayout';

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock('@/components/TitleBar', () => ({
  TitleBar: () => (
    <div data-testid="titlebar" data-titlebar-mode="quiet">
      TitleBar
    </div>
  ),
}));

vi.mock('@/components/cmd/FloatingCommandBar', () => ({
  default: () => <div data-testid="cmd-bar-stub" />,
}));

vi.mock('@/components/activity/AgentOrb', () => ({
  AgentOrb: () => <div data-testid="agent-orb-stub" />,
}));

vi.mock('@/components/editor/Editor', () => ({
  Editor: () => <div data-testid="editor-stub" />,
}));

// The unit under test: a sidebar whose render throws — until `healed` is set,
// which stands in for whatever transient state made it throw going away.
const sidebarState = vi.hoisted(() => ({ healed: false }));
vi.mock('@/components/sidebar/quiet/QuietSidebar', () => ({
  QuietSidebar: () => {
    if (!sidebarState.healed) throw new Error('sidebar exploded');
    return <div data-testid="sidebar-stub" />;
  },
}));

vi.mock('@/stores/settings-store', () => {
  const state = {
    cmdBarPinned: false,
    sidebarPinned: true,
    quietChromeTransparent: false,
    showTitleBar: true,
    sidebarWidth: 252,
    setSidebarWidth: () => {},
    quietChromePreset: 'default' as const,
    quietChromeOverrides: {
      toolbar: true,
      status: true,
      docHead: true,
      sidebar: false,
      orb: false,
      titlebar: false,
      cmdbar: false,
    },
  };
  return {
    useSettingsStore: Object.assign(
      vi.fn((sel: (s: typeof state) => unknown) => sel(state)),
      { getState: () => state },
    ),
    SIDEBAR_MIN_WIDTH: 200,
    SIDEBAR_MAX_WIDTH: 500,
    SIDEBAR_DEFAULT_WIDTH: 252,
  };
});

function defaultProps(): QuietLayoutProps {
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
    onShortcutsOpen: vi.fn(),
    onOpenActions: vi.fn(),
    onOpenSettings: vi.fn(),
    onBrowseForProject: vi.fn(),
    onOpenProjectSettings: vi.fn(),
    onMakeProject: vi.fn(),
    onExportFile: vi.fn(),
    onCancelTask: vi.fn(async () => {}),
    onClickTask: vi.fn(),
  };
}

describe('QuietLayout — sidebar ErrorBoundary (#7)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sidebarState.healed = false;
    registerDefaultHandlers();
    // React + the boundary both log the caught error — keep test output clean.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('a throwing sidebar shows the fallback while the rest of the layout keeps rendering', () => {
    const { container } = renderWithProviders(<QuietLayout {...defaultProps()} />);

    // The boundary caught the error — fallback visible in the sidebar slot.
    const fallback = screen.getByTestId('sidebar-error-fallback');
    expect(fallback).toBeTruthy();
    expect(screen.getByText(/Something went wrong in the sidebar/i)).toBeTruthy();

    // The fallback preserves the sidebar column's width so the flex-row
    // layout (and the document column's centerline) stays intact.
    expect(fallback.style.width).toContain('--quiet-sidebar-width');
    expect(fallback.className).toContain('shrink-0');

    // The rest of the layout survived: editor area, title bar, command bar,
    // orb, and the layout root itself all still render.
    expect(screen.getByTestId('editor-stub')).toBeTruthy();
    expect(screen.getByTestId('titlebar')).toBeTruthy();
    expect(screen.getByTestId('cmd-bar-stub')).toBeTruthy();
    expect(screen.getByTestId('agent-orb-stub')).toBeTruthy();
    expect(container.querySelector('[data-quiet-layout-root]')).toBeTruthy();

    // The boundary reported the error under its name.
    expect(
      consoleErrorSpy.mock.calls.some((call: unknown[]) =>
        String(call[0]).includes('[ErrorBoundary:Sidebar]'),
      ),
    ).toBe(true);
  });

  it('the fallback shows the error and "Reload sidebar" brings the sidebar back', () => {
    renderWithProviders(<QuietLayout {...defaultProps()} />);

    // Without the error text the user cannot tell what broke or report it.
    expect(screen.getByText('sidebar exploded')).toBeTruthy();
    const reload = screen.getByRole('button', { name: 'Reload sidebar' });

    // Still broken: reloading lands back on the fallback, not a white screen.
    fireEvent.click(reload);
    expect(screen.getByTestId('sidebar-error-fallback')).toBeTruthy();
    expect(screen.queryByTestId('sidebar-stub')).toBeNull();

    // Recoverable: once the cause is gone, the same button restores the sidebar.
    sidebarState.healed = true;
    fireEvent.click(screen.getByRole('button', { name: 'Reload sidebar' }));
    expect(screen.queryByTestId('sidebar-error-fallback')).toBeNull();
    expect(screen.getByTestId('sidebar-stub')).toBeTruthy();
  });
});
