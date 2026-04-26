// @vitest-environment jsdom

// Radix Slider uses ResizeObserver (via @radix-ui/react-use-size).
// EditorSettings now mounts typography sliders.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  registerDefaultHandlers,
  setMockInvokeHandler,
} from '@/test/component-harness';
import {
  EditorSettings,
  SkillsSettings,
  ProjectsSettings,
  SystemSettings,
} from '@/components/settings/v2';

// Register default + extra handlers that the deeper legacy components reach
// for on mount. Panel smoke tests only need these to keep invoke() calls from
// throwing — the tests assert that each panel renders a known label, not
// that every internal feature works.
beforeEach(() => {
  registerDefaultHandlers();
  setMockInvokeHandler('git_check_available', () => false);
  setMockInvokeHandler('get_log_path', () => null);
  setMockInvokeHandler('get_log_size', () => 0);
  setMockInvokeHandler('set_log_level', () => undefined);
  setMockInvokeHandler('list_skills', () => []);
  setMockInvokeHandler('list_agents', () => []);
  setMockInvokeHandler('list_agent_instructions', () => []);
  setMockInvokeHandler('list_mcp_servers', () => []);
  setMockInvokeHandler('get_notesage_home', () => '/tmp/notesage-test');
  setMockInvokeHandler('get_sync_settings', () => ({
    enabled: false,
    syncedProjects: [],
  }));
  setMockInvokeHandler('icloud_is_available', () => false);
});

describe('v2 settings panels', () => {
  it('SystemSettings mounts and renders the consolidated groups', () => {
    renderWithProviders(<SystemSettings />);
    // "Notesage" is the version-info group header.
    expect(screen.getAllByText('Notesage').length).toBeGreaterThan(0);
    expect(screen.getByText('Updates')).toBeTruthy();
    expect(screen.getByText('System Tray')).toBeTruthy();
    expect(screen.getByText('Notifications')).toBeTruthy();
    expect(screen.getByText('Diagnostics')).toBeTruthy();
    expect(screen.getByText('Show Hidden Files')).toBeTruthy();
    expect(screen.getByText('Automatically Check for Updates')).toBeTruthy();
  });

  it('SystemSettings renders "View Update" button when an update is available', () => {
    renderWithProviders(
      <SystemSettings
        updateState={{
          status: 'idle',
          updateInfo: {
            version: '0.99.0',
            currentVersion: '0.36.0',
            date: '2026-04-23',
            notes: null,
          },
          progress: null,
          error: null,
        }}
        onCheckForUpdate={async () => {}}
        onOpenUpdateDialog={() => {}}
      />,
    );
    expect(screen.getByText(/View Update/)).toBeTruthy();
  });

  it('EditorSettings (Writing) mounts and renders typography, preview, editor + page layout groups', () => {
    renderWithProviders(<EditorSettings />);
    expect(screen.getByText('Typography')).toBeTruthy();
    expect(screen.getByText('Preview')).toBeTruthy();
    expect(screen.getByText('Editor Options')).toBeTruthy();
    expect(screen.getByText('Page Layout')).toBeTruthy();
    expect(screen.getByText('Top Toolbar')).toBeTruthy();
    expect(screen.getByText('Page Margins')).toBeTruthy();
  });

  it('EditorSettings preview card reflects current editor font settings', async () => {
    const { useEditorStylesStore } = await import('@/stores/editor-styles-store');
    useEditorStylesStore.setState({
      fontFamily: 'inter',
      fontSize: 19,
      lineHeight: 1.85,
      paragraphSpacing: 0.75,
    });
    renderWithProviders(<EditorSettings />);
    const preview = screen.getByTestId('appearance-preview');
    const sample = preview.querySelector('div[style]') as HTMLElement | null;
    expect(sample).not.toBeNull();
    const style = sample!.getAttribute('style') ?? '';
    expect(style).toMatch(/font-size:\s*19px/);
    expect(style).toMatch(/line-height:\s*1\.85/);
    expect(style.toLowerCase()).toContain('inter');
    const stat = preview.querySelector('div.text-\\[11px\\]');
    expect(stat?.textContent ?? '').toMatch(/19\s*px/);
    expect(stat?.textContent ?? '').toMatch(/1\.85/);
  });

  it('SkillsSettings mounts and renders prompts + management + skills groups', () => {
    renderWithProviders(<SkillsSettings />);
    // Each label appears once in the v2 group header and again inside the
    // legacy inner component — assert on presence, not uniqueness.
    expect(screen.getAllByText('Custom Prompts').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Skills & Agents').length).toBeGreaterThan(0);
    expect(screen.getByText('Skill & Agent Management')).toBeTruthy();
  });

  it('ProjectsSettings mounts and renders version control + iCloud groups', () => {
    renderWithProviders(<ProjectsSettings />);
    expect(screen.getByText('Version Control')).toBeTruthy();
    expect(screen.getByText('Enable Git')).toBeTruthy();
    expect(screen.getAllByText('iCloud Sync').length).toBeGreaterThan(0);
  });
});
