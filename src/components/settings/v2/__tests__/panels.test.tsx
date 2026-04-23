// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderWithProviders,
  screen,
  registerDefaultHandlers,
  setMockInvokeHandler,
} from '@/test/component-harness';
import {
  GeneralSettings,
  EditorSettings,
  SkillsSettings,
  ProjectsSettings,
  PrivacySettings,
  AdvancedSettings,
  AboutSettings,
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
  it('GeneralSettings mounts and renders tray + notifications groups', () => {
    renderWithProviders(<GeneralSettings />);
    expect(screen.getByText('System Tray')).toBeTruthy();
    expect(screen.getByText('Notifications')).toBeTruthy();
    expect(screen.getByText('Show in menu bar')).toBeTruthy();
    expect(screen.getByText('Agent task completion')).toBeTruthy();
  });

  it('EditorSettings mounts and renders editor + page layout groups', () => {
    renderWithProviders(<EditorSettings />);
    expect(screen.getByText('Editor Options')).toBeTruthy();
    expect(screen.getByText('Page Layout')).toBeTruthy();
    expect(screen.getByText('Top Toolbar')).toBeTruthy();
    expect(screen.getByText('Page Margins')).toBeTruthy();
  });

  it('SkillsSettings mounts and renders both group wrappers', () => {
    renderWithProviders(<SkillsSettings />);
    // Each label appears once in the v2 group header and again inside the
    // legacy inner component — assert on presence, not uniqueness.
    expect(screen.getAllByText('Custom Prompts').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Skills & Agents').length).toBeGreaterThan(0);
  });

  it('ProjectsSettings mounts and renders version control + iCloud groups', () => {
    renderWithProviders(<ProjectsSettings />);
    expect(screen.getByText('Version Control')).toBeTruthy();
    expect(screen.getByText('Enable Git')).toBeTruthy();
    expect(screen.getAllByText('iCloud Sync').length).toBeGreaterThan(0);
  });

  it('PrivacySettings mounts and renders approvals group', () => {
    renderWithProviders(<PrivacySettings />);
    // "Approvals" appears in both the v2 group header AND inside the legacy
    // ApprovalsSettings component — getAllByText is fine here, we just want
    // to assert the panel mounted without crashing.
    expect(screen.getAllByText('Approvals').length).toBeGreaterThan(0);
  });

  it('AdvancedSettings mounts and renders all three clusters', () => {
    renderWithProviders(<AdvancedSettings />);
    expect(screen.getByText('Diagnostics')).toBeTruthy();
    expect(screen.getByText('Scope')).toBeTruthy();
    expect(screen.getByText('Experimental')).toBeTruthy();
    expect(screen.getByText('Cross-Project Mode')).toBeTruthy();
  });

  it('AboutSettings mounts without props', () => {
    renderWithProviders(<AboutSettings />);
    // "Notesage" appears as the group label
    expect(screen.getAllByText('Notesage').length).toBeGreaterThan(0);
    expect(screen.getByText('Updates')).toBeTruthy();
    expect(screen.getByText('Automatically Check for Updates')).toBeTruthy();
  });

  it('AboutSettings renders "View Update" button when an update is available', () => {
    renderWithProviders(
      <AboutSettings
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
});
