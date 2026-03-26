// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import {
  renderWithProviders,
  screen,
  registerDefaultHandlers,
} from '@/test/component-harness';
import { Layout, type LayoutProps } from '@/components/Layout';

// ---------------------------------------------------------------------------
// Mock all heavy child components
// ---------------------------------------------------------------------------

vi.mock('@/components/tabs/TabBar', () => ({
  TabBar: () => <div data-testid="tabbar">TabBar</div>,
}));

vi.mock('@/components/editor/Editor', () => ({
  Editor: () => <div data-testid="editor">Editor</div>,
}));

vi.mock('@/components/chat/ChatPanel', () => ({
  ChatPanel: () => <div data-testid="chat-panel">ChatPanel</div>,
}));

vi.mock('@/components/activity/ActivityStrip', () => ({
  ActivityRail: () => <div data-testid="activity-rail">ActivityRail</div>,
  ActivityPanel: () => <div data-testid="activity-panel">ActivityPanel</div>,
}));

vi.mock('@/components/TitleBar', () => ({
  TitleBar: () => <div data-testid="titlebar">TitleBar</div>,
}));

vi.mock('@/components/SidebarPanel', () => ({
  SidebarPanel: () => <div data-testid="sidebar-panel">SidebarPanel</div>,
}));

vi.mock('@/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="panel-group">{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResizableHandle: () => <div data-testid="resize-handle" />,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProps(overrides: Partial<LayoutProps> = {}): LayoutProps {
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

describe('Layout', () => {
  beforeEach(() => {
    registerDefaultHandlers();
  });

  it('mounts without crash', () => {
    const { container } = renderWithProviders(<Layout {...defaultProps()} />);
    expect(container).toBeTruthy();
  });

  it('renders editor area', () => {
    renderWithProviders(<Layout {...defaultProps()} />);
    expect(screen.getByTestId('editor')).toBeTruthy();
  });

  it('renders tabbar when not in focus mode', () => {
    renderWithProviders(<Layout {...defaultProps()} />);
    expect(screen.getByTestId('tabbar')).toBeTruthy();
  });

  it('renders sidebar when not in focus mode', () => {
    renderWithProviders(<Layout {...defaultProps()} />);
    expect(screen.getByTestId('sidebar-panel')).toBeTruthy();
  });

  it('does not render sidebar in focus mode', () => {
    renderWithProviders(<Layout {...defaultProps({ focusMode: true })} />);
    expect(screen.queryByTestId('sidebar-panel')).toBeNull();
  });

  it('does not render titlebar in focus mode', () => {
    renderWithProviders(<Layout {...defaultProps({ focusMode: true })} />);
    expect(screen.queryByTestId('titlebar')).toBeNull();
  });
});
