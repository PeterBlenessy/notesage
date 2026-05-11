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
    // The merged About group (Notesage version + Changelog + Updates).
    expect(screen.getByText('About')).toBeTruthy();
    expect(screen.getByText('Notesage version')).toBeTruthy();
    expect(screen.getByText('Changelog')).toBeTruthy();
    expect(screen.getByText('Check for updates')).toBeTruthy();
    expect(screen.getByText('Automatically check for updates')).toBeTruthy();
    expect(screen.getByText('System Tray')).toBeTruthy();
    expect(screen.getByText('Notifications')).toBeTruthy();
    expect(screen.getByText('Diagnostics')).toBeTruthy();
    expect(screen.getByText('Show hidden files')).toBeTruthy();
  });

  it('SystemSettings renders HTML viewer group with Allow form submissions toggle', () => {
    renderWithProviders(<SystemSettings />);
    expect(screen.getByText('HTML viewer')).toBeTruthy();
    expect(screen.getByText('Allow form submissions')).toBeTruthy();
  });

  it('SystemSettings renders HTML viewer group with Allow scripts (unsafe) toggle', () => {
    renderWithProviders(<SystemSettings />);
    expect(screen.getByText('HTML viewer')).toBeTruthy();
    expect(screen.getByText('Allow scripts (unsafe)')).toBeTruthy();
  });

  it('SystemSettings renders HTML viewer group with Block external resources toggle', () => {
    renderWithProviders(<SystemSettings />);
    expect(screen.getByText('HTML viewer')).toBeTruthy();
    expect(screen.getByText('Block external resources')).toBeTruthy();
  });

  it('SystemSettings renders "View update" affordance when an update is available', () => {
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
    // The check-for-updates button is icon-only now; the action is
    // identified by its aria-label, which switches to "View update" when
    // an update is available.
    expect(
      screen.getByRole('button', { name: /View update/i }),
    ).toBeTruthy();
    expect(
      screen.getByText(/Update available: v0\.99\.0/i),
    ).toBeTruthy();
  });

  it('EditorSettings (Writing) mounts and renders typography, preview, editor + page layout groups', () => {
    renderWithProviders(<EditorSettings />);
    expect(screen.getByText('Typography')).toBeTruthy();
    expect(screen.getByText('Preview')).toBeTruthy();
    expect(screen.getByText('Editor Options')).toBeTruthy();
    expect(screen.getByText('Page Layout')).toBeTruthy();
    expect(screen.getByText('Top toolbar')).toBeTruthy();
    expect(screen.getByText('Page margins')).toBeTruthy();
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

  it('SkillsSettings mounts and renders management + skills + prompts groups', () => {
    renderWithProviders(<SkillsSettings />);
    // The legacy `<SkillsSettings>` component renders its own internal
    // "Skills" + "Agents" sub-headers, so the outer wrapper for that
    // legacy mount is unlabeled (the panel itself is named "Skills &
    // Agents"). We assert the management toggle and the prompts/skills
    // sub-sections render.
    expect(screen.getByText('Skill & agent management')).toBeTruthy();
    expect(screen.getAllByText('Custom Prompts').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Skills').length).toBeGreaterThan(0);
  });

  it('ProjectsSettings mounts and renders the Version Control group', () => {
    // The legacy global iCloud Sync group was removed when sync state
    // became a pure derivation from the project path. Per-project sync
    // (move-to/move-from iCloud) lives inside each ProjectCard now.
    renderWithProviders(<ProjectsSettings />);
    expect(screen.getByText('Version Control')).toBeTruthy();
    expect(screen.getByText('Enable git')).toBeTruthy();
  });
});
