// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { UpdateDialog } from '@/components/UpdateDialog';
import type { UpdateInfo } from '@/hooks/useAutoUpdate';

// Force releases to be empty so the notes fallback path is always taken
vi.mock('@/hooks/useChangelog', () => ({
  useChangelog: () => ({
    changelog: null,
    loading: false,
    getChangesBetween: () => [],
  }),
}));

// Stub Tauri opener so openUrl does not throw in jsdom
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

// Stub plugin-http used by useChangelog internally
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(() => Promise.reject(new Error('not in jsdom'))),
}));

const BASE_INFO: UpdateInfo = {
  version: '1.0.0',
  currentVersion: '0.9.0',
  notes: null,
  date: null,
};

// Radix Dialog renders into a portal (document.body), so query document.body
function renderDialog(notes: string | null, extra: Partial<UpdateInfo> = {}) {
  return render(
    <TooltipProvider>
      <UpdateDialog
        open={true}
        onOpenChange={vi.fn()}
        updateInfo={{ ...BASE_INFO, notes, ...extra }}
        status="available"
        progress={null}
        onInstall={vi.fn()}
        onRestartNow={vi.fn()}
        onDismiss={vi.fn()}
      />
    </TooltipProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('UpdateDialog — notes markdown rendering', () => {
  it('renders **bold** notes as <strong>, not raw markdown syntax', () => {
    renderDialog('Release with **bold** change');
    const strong = document.body.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('bold');
    expect(document.body.textContent).not.toContain('**');
  });

  it('renders _italic_ notes as <em>, not raw markdown syntax', () => {
    renderDialog('Release with _italic_ change');
    const em = document.body.querySelector('em');
    expect(em).not.toBeNull();
    expect(em?.textContent).toBe('italic');
    expect(document.body.textContent).not.toContain('_italic_');
  });

  it('renders bullet list notes as <li> elements', () => {
    renderDialog('- First item\n- Second item');
    const items = document.body.querySelectorAll('li');
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0].textContent).toContain('First item');
  });

  it('renders `inline code` notes as <code> elements', () => {
    renderDialog('Use `start()` to begin');
    const code = document.body.querySelector('code');
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain('start()');
  });

  it('renders [link](url) notes as <a> anchor elements', () => {
    renderDialog('See [release notes](https://example.com)');
    const link = document.body.querySelector('a[href="https://example.com"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('release notes');
  });

  it('renders formatted notes in the Switch back to Stable? dialog (isLeaveAlphaDowngrade)', () => {
    renderDialog(
      '- **important fix** for stable users',
      { isLeaveAlphaDowngrade: true }
    );
    // The isLeaveAlphaDowngrade info box has a <strong> for the version number.
    // After the fix, a second <strong> should exist for the notes markdown.
    const strongs = document.body.querySelectorAll('strong');
    const notesBold = Array.from(strongs).find((el) => el.textContent === 'important fix');
    expect(notesBold).not.toBeNull();
    expect(document.body.textContent).not.toContain('**important fix**');
  });

  it('shows fallback text when notes is null', () => {
    renderDialog(null);
    expect(document.body.textContent).toContain('A new version is available.');
  });
});
